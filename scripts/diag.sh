#!/bin/sh
#
# Zbiera komplet danych do zgloszenia problemu. URUCHAMIAC NA ROUTERZE.
#
#   scp scripts/diag.sh root@router:/tmp/ && ssh root@router sh /tmp/diag.sh
#   albo:  ssh root@router sh - < scripts/diag.sh
#
# POSIX sh - dziala na busyboxie, bez basha i bez dodatkowych pakietow.
#
# ZAKRES: tylko odczyt. Nic nie instaluje, nie restartuje i nie zapisuje.
#
# ⚠️ Wyjscie jest ZREDAGOWANE: IMEI, IMSI, ICCID, Cell ID, eNodeB, dane masztu
# z btsearch, adresy WAN i haslo do modemu sa zastapione przez [ukryte].
# Zostaja metryki radiowe i struktura nosnych (PCI, EARFCN, pasma), bo bez nich
# zgloszenie jest bezuzyteczne, a same nie identyfikuja abonenta.
# MIMO TO przejrzyj wynik, zanim go gdzies wkleisz.

echo "=== zte-modem: raport diagnostyczny ==="
echo "data: $(date)"
echo

echo "--- 1. system ---"
. /etc/openwrt_release 2>/dev/null
echo "OpenWrt:  ${DISTRIB_RELEASE:-?} (${DISTRIB_ARCH:-?})"
echo "opis:     ${DISTRIB_DESCRIPTION:-?}"
echo "model:    $(cat /tmp/sysinfo/model 2>/dev/null || echo '?')"
echo

echo "--- 2. menedzer pakietow ---"
if command -v apk >/dev/null 2>&1; then
	echo "apk:  $(apk --version 2>&1 | head -1)"
elif command -v opkg >/dev/null 2>&1; then
	echo "opkg: $(opkg --version 2>&1 | head -1)"
else
	echo "BRAK apk i opkg (?)"
fi
echo

echo "--- 3. zainstalowane pakiety modulu ---"
for p in zte-modem-core luci-app-zte-modem-light luci-app-zte-modem; do
	if command -v apk >/dev/null 2>&1; then
		v="$(apk list -I "$p" 2>/dev/null | head -1)"
	else
		v="$(opkg list-installed "$p" 2>/dev/null | head -1)"
	fi
	printf '  %-26s %s\n' "$p" "${v:-nie zainstalowany}"
done
echo

echo "--- 4. zaleznosci: czy naprawde DZIALAJA ---"
# Sama obecnosc pakietu nie wystarcza. Udokumentowany przypadek: curl
# niedopasowany do libcurl4 konczy sie bledem relokacji, a modul nie dostaje
# zadnych danych mimo poprawnie spelnionej zaleznosci.
printf '  curl:        '; curl --version 2>&1 | head -1
printf '  ucode:       '; ucode -e 'print("ok\n")' 2>&1 | head -1
printf '  jsonfilter:  '; echo '{"a":1}' | jsonfilter -e '@.a' 2>&1 | head -1
printf '  jshn.sh:     '; [ -f /usr/share/libubox/jshn.sh ] && echo "jest" || echo "BRAK"
printf '  flock:       '; command -v flock >/dev/null 2>&1 && echo "jest" || echo "BRAK"
printf '  sha256sum:   '; printf '' | sha256sum >/dev/null 2>&1 && echo "jest" || echo "BRAK"
echo

echo "--- 5. pliki modulu ---"
for f in /usr/libexec/rpcd/zte-modem \
         /usr/share/zte-modem/ubus-map.uc \
         /usr/share/rpcd/acl.d/luci-app-zte-modem.json \
         /usr/share/luci/menu.d/luci-app-zte-modem.json \
         /www/luci-static/resources/view/zte-modem/status.js \
         /etc/config/zte-modem; do
	if [ -e "$f" ]; then
		printf '  %s  %s\n' "$(ls -l "$f" | awk '{print $1}')" "$f"
	else
		printf '  BRAK                %s\n' "$f"
	fi
done
echo "  (backend MUSI byc wykonywalny - bez bitu +x rpcd go nie zarejestruje)"
echo

echo "--- 6. rejestracja w ubus ---"
if ubus list 2>/dev/null | grep -q '^zte-modem$'; then
	echo "  obiekt 'zte-modem': JEST"
else
	echo "  obiekt 'zte-modem': BRAK  <-- to jest przyczyna, jesli widok jest pusty"
	echo "  ostatnie linie logu rpcd:"
	logread 2>/dev/null | grep -i rpcd | tail -5 | sed 's/^/    /'
fi
echo

echo "--- 7. konfiguracja (bez hasla) ---"
uci -q show zte-modem 2>/dev/null | sed "s/password='.*'/password='[ukryte]'/" | sed 's/^/  /'
echo

echo "--- 8. lacznosc z modemem ---"
HOST="$(uci -q get zte-modem.main.host)"
echo "  adres modemu z konfiguracji: ${HOST:-NIE USTAWIONO}"
echo "  (UWAGA: to ma byc adres MODEMU, nie routera)"
if [ -n "$HOST" ]; then
	printf '  ping:  '; ping -c2 -W2 "$HOST" >/dev/null 2>&1 && echo "odpowiada" || echo "BRAK ODPOWIEDZI"
	printf '  HTTP:  '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 6 "http://$HOST/" 2>&1
	# Pytamy o OBA protokoly, bo od tego zaczyna sie diagnoza: MC7510 nie ma
	# goformu i oddaje na nim strone 404, co bez tej pary linii wyglada
	# na uszkodzony modem albo zly adres.
	printf '  goform (cmd=LD):  '
	curl -s --max-time 6 -H "Referer: http://$HOST/index.html" \
		"http://$HOST/goform/goform_get_cmd_process?isTest=false&cmd=LD" 2>/dev/null \
		| sed 's/"LD":"[0-9A-Fa-f]\{8\}[0-9A-Fa-f]*"/"LD":"[jest, 64 hex]"/' | head -c 120
	echo
	printf '  ubus (web_login_info): '
	curl -s --max-time 6 -H "Referer: http://$HOST/" \
		-H "Content-Type: application/json" -X POST "http://$HOST/ubus/" \
		--data '[{"jsonrpc":"2.0","id":1,"method":"call","params":["00000000000000000000000000000000","zwrt_web","web_login_info",{}]}]' \
		2>/dev/null \
		| sed 's/"zte_web_sault":"[0-9A-Fa-f]*"/"zte_web_sault":"[jest, 64 hex]"/' | head -c 200
	echo
	echo "  (404 na goformie + sol z ubusa = modem ubusowy, np. MC7510 - tak ma byc)"
fi
echo

echo "--- 9. odczyt przez modul (zredagowany) ---"
# Redagujemy pola, ktore identyfikuja urzadzenie, karte SIM albo lokalizacje.
# Zostaja metryki i struktura nosnych - bez nich zgloszenie nic nie wnosi.
ubus call zte-modem status 2>&1 | sed -E \
	-e 's/("(imei|imsi|sim_imsi|iccid|msisdn|wan_ipaddr|ipv6_wan_ipaddr|lan_ipaddr|cell_id|Z5g_CELL_ID|nr_cell_id|nr5g_cell_id|enodeb_id|_cell_dec|_bts_station|_bts_city|_bts_address|_bts_lat|_bts_lon)"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"[ukryte]"/g'
echo

echo "--- 10. sonda logowania ---"
ubus call zte-modem probe 2>&1 | sed -E \
	-e 's/("(ld|sault|zte_web_sault)"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"[ukryte]"/g'
echo

echo "=== koniec raportu ==="
echo "Przejrzyj powyzsze przed wyslaniem. Jesli cos jeszcze uznasz za wrazliwe - usun."
