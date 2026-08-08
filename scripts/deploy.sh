#!/usr/bin/env bash
#
# Wgrywa pakiety zte-modem na router.
#
#   ./scripts/deploy.sh                          # core + light, root@192.168.0.1
#   ./scripts/deploy.sh root@10.0.0.1            # inny cel
#   ./scripts/deploy.sh --pkg zte-modem-core     # tylko wybrany pakiet (mozna powtarzac)
#   ./scripts/deploy.sh --dry-run                # pokaz co by zrobil, nic nie zmieniaj
#
# Idempotentny. NIE nadpisuje istniejacego /etc/config/zte-modem (jest tam haslo).

set -euo pipefail

TARGET="root@192.168.0.1"
DRY=0
PKGS=()

while [ $# -gt 0 ]; do
	case "$1" in
		--dry-run) DRY=1 ;;
		--pkg)     PKGS+=("$2"); shift ;;
		-h|--help) sed -n '2,12p' "$0"; exit 0 ;;
		*)         TARGET="$1" ;;
	esac
	shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ ${#PKGS[@]} -gt 0 ] || PKGS=(zte-modem-core luci-app-zte-modem-light)

for p in "${PKGS[@]}"; do
	[ -d "$ROOT/$p/files" ] || { echo "Pakiet '$p' nie ma katalogu files/" >&2; exit 1; }
done

# -n odcina stdin. BEZ tego ssh wciaga liste plikow z `find` w petli nizej
# i wgrywa sie tylko pierwszy plik z pakietu - przy czym skrypt konczy sie
# sukcesem, wiec brak reszty wyglada jak dzialajacy deploy.
SSH=(ssh -n -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET")
# Wariant do przesylania tresci pliku - tutaj stdin jest potrzebny.
SSH_IN=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET")

run() {
	if [ "$DRY" -eq 1 ]; then
		echo "  [dry-run] $*"
	else
		"${SSH[@]}" "$*"
	fi
}

# Tryb wynika ze sciezki: backend rpcd musi byc wykonywalny, config trzyma haslo.
# Regula jest wspolna z build-pkg.sh - patrz lib.sh.
. "$ROOT/scripts/lib.sh"

put() { # $1 = plik zrodlowy, $2 = sciezka docelowa, $3 = tryb
	if [ "$DRY" -eq 1 ]; then return 0; fi
	"${SSH[@]}" "mkdir -p '$(dirname "$2")'"
	"${SSH_IN[@]}" "cat > '$2.new' && chmod $3 '$2.new' && mv '$2.new' '$2'" < "$1"
}

echo "Cel: $TARGET"
[ "$DRY" -eq 1 ] && echo "(dry-run — bez zmian)"

for p in "${PKGS[@]}"; do
	echo
	echo "Pakiet $p:"
	seen=0
	expected="$(find "$ROOT/$p/files" -type f | wc -l)"
	while IFS= read -r src; do
		seen=$((seen + 1))
		dst="${src#"$ROOT/$p/files"}"
		mode="$(mode_for "$dst")"

		# Konfiguracja z haslem: wgrywamy tylko, gdy jeszcze jej nie ma.
		if [ "$mode" = "0600" ]; then
			if [ "$DRY" -eq 1 ]; then
				echo "  -> $dst ($mode, tylko gdy nie istnieje)"
				continue
			elif "${SSH[@]}" "[ -f '$dst' ]"; then
				echo "  -> $dst JUZ ISTNIEJE — pomijam (haslo zachowane)"
				continue
			fi
		fi

		echo "  -> $dst ($mode)"
		put "$src" "$dst" "$mode"
	done < <(find "$ROOT/$p/files" -type f | sort)

	# Siatka bezpieczenstwa: gdyby cokolwiek znow zjadlo liste plikow, ma to
	# byc bledem, a nie cichym czesciowym wdrozeniem zakonczonym "Gotowe".
	if [ "$seen" -ne "$expected" ]; then
		echo "  BLAD: przetworzono $seen z $expected plikow pakietu $p" >&2
		exit 1
	fi
done

echo
echo "Przeladowanie:"
# Czysci cache SERWEROWY. Widok w JS siedzi dodatkowo w cache PRZEGLADARKI -
# LuCI podaje go ze statycznym parametrem wersji, wiec podmiana pliku na
# routerze go nie uniewaznia. Stad przypomnienie na koncu.
run "rm -rf /tmp/luci-modulecache /tmp/luci-indexcache*"
run "/etc/init.d/rpcd restart"

if [ "$DRY" -eq 0 ]; then
	sleep 3
	echo "Sprawdzenie:"
	if "${SSH[@]}" "ubus list | grep -q '^zte-modem$'"; then
		echo "  OK — obiekt ubus 'zte-modem' zarejestrowany"
	else
		echo "  UWAGA — brak obiektu ubus 'zte-modem'; sprawdz: logread | grep rpcd" >&2
		exit 1
	fi
fi

echo "Gotowe."
echo
echo "  ! W przegladarce zrob TWARDE przeladowanie (Ctrl+Shift+R)."
echo "    Bez tego LuCI pokaze stara wersje widoku z cache i bedzie to"
echo "    wygladac na nieudane wdrozenie."
