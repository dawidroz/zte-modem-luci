#!/usr/bin/env bash
#
# Buduje pakiety instalacyjne z katalogow files/ - oba formaty OpenWrt.
#
#   ./scripts/build-pkg.sh                       # .ipk + .apk, oba pakiety
#   ./scripts/build-pkg.sh --format ipk          # tylko .ipk
#   ./scripts/build-pkg.sh --pkg zte-modem-core  # tylko wybrany (mozna powtarzac)
#   ./scripts/build-pkg.sh --out /tmp/pkg        # inny katalog wyjsciowy
#   ./scripts/build-pkg.sh --apk-compat 3.0.0_pre3
#
# Pakiety sa bezarchitekturowe - to sam kod w shellu i JS, nic sie nie
# kompiluje, wiec SDK OpenWrt nie jest potrzebny. UWAGA: kazdy format nazywa to
# inaczej - `.ipk` ma "Architecture: all", `.apk` ma "arch: noarch".
#
#   .ipk  budowane lokalnie (ar + tar + gzip)      -> OpenWrt <= 24.10, opkg
#   .apk  budowane przez `apk mkpkg` w kontenerze  -> OpenWrt z apk
#
# Metadane kazdego pakietu siedza w jego pliku `pkginfo`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"

OUT="$ROOT/build"
FORMAT="both"
APK_COMPAT=""
PKGS=()

while [ $# -gt 0 ]; do
	case "$1" in
		--out)        OUT="$2"; shift ;;
		--format)     FORMAT="$2"; shift ;;
		--apk-compat) APK_COMPAT="$2"; shift ;;
		--pkg)        PKGS+=("$2"); shift ;;
		-h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
		*)            echo "Nieznany argument: $1" >&2; exit 1 ;;
	esac
	shift
done

case "$FORMAT" in
	ipk|apk|both) ;;
	*) echo "--format musi byc: ipk, apk albo both" >&2; exit 1 ;;
esac

[ ${#PKGS[@]} -gt 0 ] || PKGS=(zte-modem-core luci-app-zte-modem-light)

# Silnik kontenerow - tylko dla .apk. Podman przed dockerem, bo w trybie
# rootless nie wymaga demona ani uprawnien roota.
CONTAINER=""
if [ "$FORMAT" != "ipk" ]; then
	for c in podman docker; do
		command -v "$c" >/dev/null 2>&1 && { CONTAINER="$c"; break; }
	done
	if [ -z "$CONTAINER" ]; then
		echo "Do .apk potrzebny jest podman albo docker (apk-tools 3 nie ma w Fedorze domyslnie)." >&2
		echo "Zbuduj same .ipk:  $0 --format ipk" >&2
		exit 1
	fi
fi

APK_IMAGE="${APK_IMAGE:-docker.io/library/alpine:edge}"

mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

#
# --- przygotowanie drzewa plikow -------------------------------------------
#

# Kopiuje files/ do katalogu roboczego i ustawia tryby wg sciezki DOCELOWEJ.
# Tryby w repozytorium sa nieistotne (git zapamietuje tylko bit +x), wiec
# ustawiamy je tutaj jawnie - tak samo jak robi to deploy.sh.
stage() { # $1 = katalog pakietu, $2 = katalog docelowy
	local src="$1/files" dst="$2" f rel mode

	while IFS= read -r f; do
		rel="${f#"$src"}"
		mode="$(mode_for "$rel")"
		install -D -m "$mode" "$f" "$dst$rel"
	done < <(find "$src" -type f | sort)
}

#
# --- .ipk (opkg) -----------------------------------------------------------
#
# ⚠️ .ipk OpenWrt to NIE jest archiwum `ar`. To pulapka, bo format wyglada jak
# .deb (te same trzy czlony: debian-binary, control.tar.gz, data.tar.gz) i tak
# jest opisywany w wiekszosci zrodel. Roznica siedzi w kontenerze zewnetrznym:
#
#   .deb  ->  ar
#   .ipk  ->  tar spakowany gzipem
#
# Sprawdzone na zywo: wersja z `ar` przechodzi lokalnie kazda inspekcje
# (`ar t` listuje czlony, control i data sa poprawne), a opkg na OpenWrt 24.10.2
# odrzuca ja jednym zdaniem "pkg_init_from_file: Malformed package file".
#
build_ipk() { # $1 = katalog stage
	local stagedir="$1" ctl="$WORK/control.$PKG_NAME" f
	local ver="${PKG_VERSION}-r${PKG_RELEASE}"

	rm -rf "$ctl"; mkdir -p "$ctl"

	{
		echo "Package: $PKG_NAME"
		echo "Version: $ver"
		echo "Architecture: all"
		echo "Section: $PKG_SECTION"
		echo "License: $PKG_LICENSE"
		echo "Maintainer: $PKG_MAINTAINER"
		[ -n "$PKG_URL" ] && echo "Source: $PKG_URL"
		# opkg chce liste po przecinku, apk po spacji - stad zamiana.
		[ -n "$PKG_DEPENDS" ]   && echo "Depends: $(echo "$PKG_DEPENDS"   | tr ' ' ',' | sed 's/,/, /g')"
		[ -n "$PKG_CONFLICTS" ] && echo "Conflicts: $(echo "$PKG_CONFLICTS" | tr ' ' ',' | sed 's/,/, /g')"
		echo "Description: $PKG_DESC"
	} > "$ctl/control"

	# Bez tego opkg NADPISUJE /etc/config/zte-modem przy aktualizacji, kasujac
	# haslo do modemu. Z conffiles zachowuje zmieniony plik.
	if [ -n "$PKG_CONFFILES" ]; then
		printf '%s\n' $PKG_CONFFILES > "$ctl/conffiles"
	fi

	# --owner/--group/--numeric-owner: pliki maja nalezec do roota, a nie do
	# tego, kto akurat buduje. --sort=name i --mtime: powtarzalny wynik.
	local TAROPT=(--owner=0 --group=0 --numeric-owner --sort=name
	              --mtime=@0 --format=gnu)

	tar czf "$WORK/data.tar.gz"    "${TAROPT[@]}" -C "$stagedir" .
	tar czf "$WORK/control.tar.gz" "${TAROPT[@]}" -C "$ctl" .
	echo "2.0" > "$WORK/debian-binary"

	local out="$OUT/${PKG_NAME}_${ver}_all.ipk"
	rm -f "$out"
	tar czf "$out" "${TAROPT[@]}" -C "$WORK" \
		./debian-binary ./data.tar.gz ./control.tar.gz

	echo "  .ipk  $(basename "$out")  ($(du -h "$out" | cut -f1))"
}

#
# --- .apk (apk-tools 3) ----------------------------------------------------
#
# Kopiujemy drzewo do katalogu WEWNATRZ kontenera i tam robimy chown na roota.
# Inaczej wlasciciel plikow zalezalby od silnika: rootless podman mapuje
# uzytkownika hosta na roota (dobrze), ale docker z demonem roota widzi uid
# hosta (zle) - pakiet mialby wtedy pliki nalezace do uid 1000.
#
build_apk() { # $1 = katalog stage
	local stagedir="$1"
	local ver="${PKG_VERSION}-r${PKG_RELEASE}"
	local out="${PKG_NAME}-${ver}.apk"

	local info=(
		"name:$PKG_NAME"
		"version:$ver"
		"description:$PKG_DESC"
		# ⚠️ NIE "all" - to konwencja opkg. apk-tools nazywa brak architektury
		# `noarch` i wartosci "all" nie zna, wiec pakiet przechodzi przez
		# `apk mkpkg` bez slowa skargi, a przy instalacji leci:
		#
		#   ERROR: unable to select packages:
		#     zte-modem-core-1.0.0-r1:
		#       error: uninstallable
		#       arch: all
		#
		# Komunikat nie mowi, ze chodzi o architekture - wypisuje ja tylko jako
		# jedna z linii opisu - wiec latwo wziac to za brak zaleznosci.
		# Wzorzec z pakietu zbudowanego przez samo OpenWrt:
		# `apk adbdump luci-app-acl-*.apk` -> `arch: noarch`.
		"arch:noarch"
		"license:$PKG_LICENSE"
		"origin:$PKG_NAME"
		"maintainer:$PKG_MAINTAINER"
		"url:$PKG_URL"
	)
	# W apk konflikt zapisuje sie jako zaleznosc zanegowana: "!pakiet".
	local deps="$PKG_DEPENDS"
	for c in $PKG_CONFLICTS; do deps="$deps !$c"; done
	[ -n "$deps" ] && info+=("depends:$deps")

	local args=()
	for i in "${info[@]}"; do args+=(--info "$i"); done
	[ -n "$APK_COMPAT" ] && args+=(--compat "$APK_COMPAT")

	# BEZ tego do pakietu wsiaka etykieta SELinuksa Z KONTENERA
	# (security.selinux=...container_file_t...), bo montowanie z ":z"
	# przelabelowuje staging, a `cp -a` przenosi xattry dalej. Na OpenWrt to
	# smiec, ktory apk probowalby odtworzyc przy instalacji.
	args+=(--no-xattrs)

	# --stdout zamiast montowania katalogu wyjsciowego: docker z demonem roota
	# zostawilby w build/ pliki nalezace do roota, ktorych nie da sie usunac
	# bez sudo. Tu plik tworzy powloka hosta, wiec wlasciciel jest wlasciwy.
	# Piszemy przez plik tymczasowy: przy bledzie mkpkg przekierowanie i tak
	# utworzylo by w build/ obcieta koncowke, ktora wyglada jak gotowy pakiet.
	"$CONTAINER" run --rm -i \
		-v "$stagedir:/stage:ro,z" \
		"$APK_IMAGE" \
		sh -c 'cp -a /stage /build && chown -R root:root /build && exec "$@"' _ \
		apk mkpkg "${args[@]}" --files /build --stdout > "$OUT/$out.new"
	mv "$OUT/$out.new" "$OUT/$out"

	echo "  .apk  $out  ($(du -h "$OUT/$out" | cut -f1))"
}

#
# --- przebieg --------------------------------------------------------------
#

echo "Wyjscie: $OUT"
[ "$FORMAT" != "ipk" ] && echo "Kontener: $CONTAINER ($APK_IMAGE)"

for p in "${PKGS[@]}"; do
	[ -d "$ROOT/$p/files" ]  || { echo "Pakiet '$p' nie ma katalogu files/" >&2; exit 1; }
	[ -f "$ROOT/$p/pkginfo" ] || { echo "Pakiet '$p' nie ma pliku pkginfo" >&2; exit 1; }

	# Domyslne, zeby pkginfo nie musialo powtarzac tego samego.
	PKG_NAME=""; PKG_VERSION=""; PKG_RELEASE="1"; PKG_SECTION="net"
	PKG_LICENSE="GPL-2.0-only"; PKG_URL=""; PKG_DESC=""
	PKG_DEPENDS=""; PKG_CONFLICTS=""; PKG_CONFFILES=""
	PKG_MAINTAINER="${PKG_MAINTAINER:-Ireneusz Rybicki <rybirek@gmail.com>}"

	# shellcheck disable=SC1090
	. "$ROOT/$p/pkginfo"

	[ -n "$PKG_NAME" ] && [ -n "$PKG_VERSION" ] || {
		echo "pkginfo pakietu '$p' nie ustawia PKG_NAME/PKG_VERSION" >&2; exit 1; }

	echo
	echo "Pakiet $PKG_NAME ${PKG_VERSION}-r${PKG_RELEASE}:"

	SD="$WORK/stage/$PKG_NAME"
	rm -rf "$SD"; mkdir -p "$SD"
	stage "$ROOT/$p" "$SD"

	# Siatka bezpieczenstwa: pakiet bez plikow instaluje sie "poprawnie"
	# i nie robi nic - dokladnie tak wygladal bug z pozeraniem listy w deploy.sh.
	n="$(find "$SD" -type f | wc -l)"
	e="$(find "$ROOT/$p/files" -type f | wc -l)"
	[ "$n" -eq "$e" ] || { echo "  BLAD: spakowano $n z $e plikow" >&2; exit 1; }
	echo "  plikow: $n"

	case "$FORMAT" in ipk|both) build_ipk "$SD" ;; esac
	case "$FORMAT" in apk|both) build_apk "$SD" ;; esac
done

echo
echo "Gotowe."
