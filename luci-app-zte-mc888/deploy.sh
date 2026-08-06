#!/usr/bin/env bash
#
# Wgrywa luci-app-zte-mc888 na router.
#
#   ./deploy.sh                 # domyslnie root@192.168.0.1
#   ./deploy.sh root@10.0.0.1   # inny cel
#   ./deploy.sh --dry-run       # pokaz co by zrobil, nic nie zmieniaj
#
# Idempotentny. NIE nadpisuje istniejacego /etc/config/zte-mc888 (jest tam haslo).

set -euo pipefail

TARGET="root@192.168.0.1"
DRY=0

for a in "$@"; do
	case "$a" in
		--dry-run) DRY=1 ;;
		-h|--help) sed -n '2,12p' "$0"; exit 0 ;;
		*)         TARGET="$a" ;;
	esac
done

SRC="$(cd "$(dirname "$0")" && pwd)/files"
[ -d "$SRC" ] || { echo "Brak katalogu $SRC" >&2; exit 1; }

SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET")

run() {
	if [ "$DRY" -eq 1 ]; then
		echo "  [dry-run] $*"
	else
		"${SSH[@]}" "$*"
	fi
}

put() { # $1 = sciezka wzgledem files/, $2 = tryb
	local rel="$1" mode="$2" dst="/$1"
	echo "  -> $dst ($mode)"
	if [ "$DRY" -eq 1 ]; then return 0; fi
	"${SSH[@]}" "mkdir -p '$(dirname "$dst")'"
	"${SSH[@]}" "cat > '$dst.new' && chmod $mode '$dst.new' && mv '$dst.new' '$dst'" < "$SRC/$rel"
}

echo "Cel: $TARGET"
[ "$DRY" -eq 1 ] && echo "(dry-run — bez zmian)"

echo "Pliki:"
put "usr/libexec/rpcd/zte-mc888"                            0755
put "usr/share/rpcd/acl.d/luci-app-zte-mc888.json"          0644
put "usr/share/luci/menu.d/luci-app-zte-mc888.json"         0644
put "www/luci-static/resources/view/zte-mc888/status.js"    0644

echo "Konfiguracja:"
if [ "$DRY" -eq 1 ]; then
	echo "  [dry-run] /etc/config/zte-mc888 (tylko gdy nie istnieje)"
elif "${SSH[@]}" "[ -f /etc/config/zte-mc888 ]"; then
	echo "  -> /etc/config/zte-mc888 JUZ ISTNIEJE — pomijam (haslo zachowane)"
else
	put "etc/config/zte-mc888" 0600
fi

echo "Przeladowanie:"
run "rm -rf /tmp/luci-modulecache /tmp/luci-indexcache*"
run "/etc/init.d/rpcd restart"

if [ "$DRY" -eq 0 ]; then
	sleep 3
	echo "Sprawdzenie:"
	if "${SSH[@]}" "ubus list | grep -q '^zte-mc888$'"; then
		echo "  OK — obiekt ubus 'zte-mc888' zarejestrowany"
	else
		echo "  UWAGA — brak obiektu ubus 'zte-mc888'; sprawdz: logread | grep rpcd" >&2
		exit 1
	fi
fi

echo "Gotowe."
