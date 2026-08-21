#!/bin/sh
#
# Testy mappera ubus -> goform (/usr/share/zte-modem/ubus-map.uc).
#
# Probki sa zdjete z zywego MC7510 (Orange PL, 3xCA B1+B3+B20, ENDC na n78) -
# tam, gdzie test sprawdza konkretna liczbe, ta liczba przyszla z modemu.
#
# Mapper jest testowany JAKO CZARNA SKRZYNKA: na wejscie JSON, na wyjscie JSON.
# Potrzebuje `ucode` i `jsonfilter`, czyli srodowiska OpenWrt - na maszynie
# deweloperskiej odpala sie go przez ssh:
#
#   sh tests/ubus-map.test.sh                  # lokalnie (jest ucode)
#   sh tests/ubus-map.test.sh --ssh root@192.168.8.1   # na routerze

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP="${MAP:-$ROOT/zte-modem-core/files/usr/share/zte-modem/ubus-map.uc}"
KEYS="nwinfo,device,common,sim,iface,traffic,limit,apn,web"

# Tryb zdalny: wysyla mapper i ten skrypt na router i tam sie wykonuje.
if [ "$1" = "--ssh" ]; then
	[ -n "$2" ] || { echo "uzycie: $0 --ssh root@adres" >&2; exit 2; }
	ssh "$2" 'cat > /tmp/zte-ubus-map.uc'      < "$MAP"  || exit 1
	ssh "$2" 'cat > /tmp/zte-ubus-map.test.sh' < "$0"    || exit 1
	exec ssh "$2" "MAP=/tmp/zte-ubus-map.uc sh /tmp/zte-ubus-map.test.sh"
fi

command -v ucode      >/dev/null || { echo "brak ucode - uzyj --ssh root@router" >&2; exit 2; }
command -v jsonfilter >/dev/null || { echo "brak jsonfilter - uzyj --ssh root@router" >&2; exit 2; }
[ -f "$MAP" ] || { echo "nie ma mappera: $MAP" >&2; exit 2; }

fails=0

_map() { # stdin = koperta, stdout = wynik mappera
	ZTE_UBUS_KEYS="$KEYS" ucode -R "$MAP"
}

_f() { # $1 = wynik, $2 = pole
	printf '%s' "$1" | jsonfilter -q -e "@.$2"
}

eq() { # $1 = nazwa, $2 = oczekiwane, $3 = otrzymane
	if [ "$2" = "$3" ]; then
		echo "  ok  $1"
	else
		fails=$((fails + 1))
		echo "FAIL  $1   (oczekiwane [$2], jest [$3])"
	fi
}

empty() { # $1 = nazwa, $2 = otrzymane
	if [ -z "$2" ]; then
		echo "  ok  $1"
	else
		fails=$((fails + 1))
		echo "FAIL  $1   (mialo byc puste, jest [$2])"
	fi
}

# --- pelna koperta z zywego MC7510 ----------------------------------------

FULL="$(cat <<'JSON'
{
 "nwinfo": {
   "net_select_mode": "auto_select", "network_type": "ENDC", "signalbar": "5",
   "simcard_roam": "Home", "wan_active_band": "LTE BAND 1", "rmcc": 260, "rmnc": 3,
   "network_provider": "Orange", "network_provider_fullname": "Orange",
   "cell_id": 35072027, "lte_pci": 259, "wan_active_channel": 75, "lac_code": 53711,
   "lte_rsrp": -80, "lte_rsrq": -9, "lte_rssi": -79, "lte_snr": "7.0",
   "rssi": 0, "rscp": 0,
   "lte_band": "1,3,8,20,38",
   "lteca": "259,1,53711,75,15.0;259,3,2,1725,15.0;307,20,2,6200,10.0;",
   "ltecasig": "-75.0, -8.0,4.0,-68.0,0,2;-70.0, -14.0,0.0,-58.0,0,2;",
   "lteca_state": 1,
   "lte_neighbor_cell": "258,75;", "nr_neighbor_cell": "464,640704;",
   "nr5g_cell_id": 268435455, "nr5g_pci": 463, "nr5g_action_channel": 640704,
   "nr5g_action_band": "n78", "nr5g_bandwidth": "100",
   "nr5g_rsrp": -91, "nr5g_rsrq": -12, "nr5g_snr": "18.0"
 },
 "device": { "imei": "864866070139083", "wa_inner_version": "BD_STDPLMC7510AV1.0.0B04" },
 "common": { "model_name": "MC7510", "device_market_name": "G51F", "GUI_version": "V1.0",
             "hardware_version": "MC7510_HW1.0", "web_red_version": "EU20.001",
             "manufacturer": "ZTE" },
 "sim":    { "sim_iccid": "8948032522760305828F", "pin_status": 0,
             "modem_main_state": "modem_init_complete", "mdm_mcc": "260", "mdm_mnc": "03",
             "sim_imsi": "5C3T4ogfD8QYfM0OrZ/F1WmtTenH+9W0qvGfjdzhFMAE8eTu05QyPIiH1w==",
             "msisdn": "SW0iRPywnHMSSh/PiKDZZvQ89uWeSIBh8fQ0Ng==" },
 "iface":  { "ipv4_address": "0", "ipv4_gateway": "0",
             "ipv6_address": "2a00:0f44:0cf1:391b:72f0:7c4b:f39f:988c",
             "connect_status": "ipv6_connected" },
 "traffic":{ "month_rx_bytes": 487567569649, "month_tx_bytes": 68797865998,
             "real_rx_bytes": 43856738771, "real_tx_bytes": 6538879337,
             "real_rx_speed": 23427, "real_tx_speed": 27859, "real_time": 129809 },
 "limit":  { "enable": 0, "type": 2, "value": 0, "ratio": 0, "overflow": 0 },
 "apn":    { "cid_table": { "apnListArray": [
             { "profilename": "Orange Internet IPv6", "wanapn": "internetipv6",
               "pdpType": 2, "isEnable": true } ] } },
 "web":    { "web_local_addr": "192.168.254.1", "login_current_user": "admin" }
}
JSON
)"

R="$(printf '%s' "$FULL" | _map)"

echo
echo "-- tozsamosc urzadzenia --"
eq "model_name z get_zwrt_common_info" "MC7510"                   "$(_f "$R" model_name)"
eq "nazwa handlowa"                    "G51F"                     "$(_f "$R" device_market_name)"
eq "firmware"                          "BD_STDPLMC7510AV1.0.0B04" "$(_f "$R" wa_inner_version)"
eq "wersja sprzetowa"                  "MC7510_HW1.0"             "$(_f "$R" hardware_version)"
eq "wersja panelu z GUI_version"       "V1.0"                     "$(_f "$R" web_version)"
eq "IMEI"                              "864866070139083"          "$(_f "$R" imei)"
eq "adres panelu modemu"               "192.168.254.1"            "$(_f "$R" lan_ipaddr)"

echo
echo "-- typy sprowadzone do lancuchow --"
# Widok porownuje wprost (st.pin_status === '0'), a ubus miesza typy:
# signalbar jest tekstem, rmcc i lte_pci liczbami.
eq "rmcc (liczba) jako tekst"    "260"  "$(_f "$R" rmcc)"
eq "rmnc (liczba) jako tekst"    "3"    "$(_f "$R" rmnc)"
eq "pin_status (liczba 0)"       "0"    "$(_f "$R" pin_status)"
eq "lte_pci"                     "259"  "$(_f "$R" lte_pci)"
eq "cell_id"                     "35072027" "$(_f "$R" cell_id)"
eq "lte_snr nie traci dziesiatych" "7.0" "$(_f "$R" lte_snr)"

echo
echo "-- agregacja nosnych z pola lteca --"
eq "pasmo nosnej glownej z lteca" "1"      "$(_f "$R" lte_ca_pcell_band)"
eq "EARFCN nosnej glownej"        "75"     "$(_f "$R" lte_ca_pcell_freq)"
eq "szerokosc nosnej glownej"     "15.0"   "$(_f "$R" lte_ca_pcell_bandwidth)"
eq "tekstowe bandwidth jako zapas" "15.0MHz" "$(_f "$R" bandwidth)"
eq "nosne dodatkowe w ukladzie goformu" \
   "1,259,0,3,1725,15.0;2,307,0,20,6200,10.0" "$(_f "$R" lte_multi_ca_scell_info)"

# Lista pasm WLACZONYCH nie moze wyjsc jako pasmo nosnej: widok robi z lte_band
# "B" + wartosc, czyli powstaloby pasmo "B1,3,8,20,38".
empty "lte_band (lista pasm wlaczonych) NIE jest przepisywane" "$(_f "$R" lte_band)"

echo
echo "-- poziom sygnalu na nosna dodatkowa --"
eq "_scell_sig: dwa wpisy, po jednym na SCC" \
   "-75.0,-8.0,4.0,-68.0;-70.0,-14.0,0.0,-58.0" "$(_f "$R" _scell_sig)"

echo
echo "-- 5G NR --"
eq "Z5g_rsrp"            "-91"    "$(_f "$R" Z5g_rsrp)"
eq "Z5g_rsrq"            "-12"    "$(_f "$R" Z5g_rsrq)"
eq "Z5g_SINR z nr5g_snr" "18.0"   "$(_f "$R" Z5g_SINR)"
eq "pasmo NR"            "n78"    "$(_f "$R" nr5g_action_band)"
eq "szerokosc NR"        "100"    "$(_f "$R" nr5g_bandwidth)"
# 268435455 = 0xFFFFFFF, same jedynki na 28 bitach = "nieznane", nie numer.
empty "wartownik nr5g_cell_id odsiany" "$(_f "$R" Z5g_CELL_ID)"

echo
echo "-- czego mapper NIE przepisuje --"
# sim_imsi na MC7510 jest zaszyfrowane i podane w base64 - to nie jest IMSI.
empty "zaszyfrowane sim_imsi nie idzie dalej" "$(_f "$R" sim_imsi)"
empty "ani jako imsi"                         "$(_f "$R" imsi)"
# MC7510 trzyma tu zero przy wypelnionym lte_rssi = -79; przepuszczone udawaloby
# pomiar rowny 0 dBm, bo widok bierze pierwsza NIEPUSTA wartosc.
empty "rssi = 0 traktowane jak brak pomiaru"  "$(_f "$R" rssi)"
# Sasiedzi bez poziomow: "PCI,EARFCN" nie da sie zamienic w goformowe
# "EARFCN,PCI,RSRQ,RSRP,RSSI", bo brakuje RSRP - a to na nim stoi cala tabela.
empty "ngbr_cell_info bez poziomow nie jest skladane" "$(_f "$R" ngbr_cell_info)"

echo
echo "-- polaczenie --"
# Modem w trybie bridge oddaje "0" zamiast pustego pola.
empty "ipv4_address = 0 to brak adresu"       "$(_f "$R" wan_ipaddr)"
# Pelny adres z get_wwaniface, a nie obciety do 31 znakow z telus_para.
eq "IPv6 w pelnej dlugosci" "2a00:0f44:0cf1:391b:72f0:7c4b:f39f:988c" \
   "$(_f "$R" ipv6_wan_ipaddr)"
eq "APN z profilu"     "internetipv6" "$(_f "$R" wan_apn)"
eq "typ PDP z pdpType" "IPv4v6"       "$(_f "$R" pdp_type)"
eq "czas trwania sesji" "129809"      "$(_f "$R" realtime_time)"

echo
echo "-- transfer --"
eq "miesieczny RX" "487567569649" "$(_f "$R" monthly_rx_bytes)"
eq "miesieczny TX" "68797865998"  "$(_f "$R" monthly_tx_bytes)"
eq "chwilowy DL"   "23427"        "$(_f "$R" realtime_rx_thrpt)"
eq "chwilowy UL"   "27859"        "$(_f "$R" realtime_tx_thrpt)"

echo
echo "-- limit transferu --"
eq "limit wylaczony"        "0"     "$(_f "$R" data_volume_limit_switch)"
eq "typ 2 = limit na dane"  "data"  "$(_f "$R" data_volume_limit_unit)"
empty "prog 0 nie jest podawany" "$(_f "$R" data_volume_limit_size)"

# type 1 = limit CZASU polaczenia; widok pomija wtedy pasek zuzycia danych.
R2="$(printf '%s' '{"limit":{"enable":1,"type":1,"value":0}}' | _map)"
eq "typ 1 = limit czasu" "time" "$(_f "$R2" data_volume_limit_unit)"

# Prog zapisujemy w goformowym kodowaniu "<liczba>_<jednostka w MB>", zeby
# limitBytes() w widoku wylozylo z tego te same bajty. 1 GiB = 1024 MiB.
R3="$(printf '%s' '{"limit":{"enable":1,"type":2,"value":1073741824}}' | _map)"
eq "prog przeliczony na kodowanie goformu" "1024_1" "$(_f "$R3" data_volume_limit_size)"

echo
echo "-- brak agregacji --"
R4="$(printf '%s' '{"nwinfo":{"lteca":"259,1,53711,75,15.0;","lteca_state":0,"ltecasig":""}}' | _map)"
eq "sama nosna glowna nadal daje pasmo" "1" "$(_f "$R4" lte_ca_pcell_band)"
empty "bez nosnych dodatkowych brak pola SCC" "$(_f "$R4" lte_multi_ca_scell_info)"
empty "bez pomiarow SCC brak _scell_sig"      "$(_f "$R4" _scell_sig)"

echo
echo "-- pusta i uszkodzona odpowiedz --"
eq "pusta koperta -> pusty obiekt" "{ }" "$(printf '%s' '{}' | _map)"
eq "smiec na wejsciu -> pusty obiekt" "{ }" "$(printf '%s' 'nie-json' | _map)"

echo
echo "-- ksztalt paczki JSON-RPC, dopasowanie po id --"
# Odpowiedzi PRZESTAWIONE: id 3 przed id 1. Przypisanie musi isc za `id`,
# a nie za pozycja w tablicy - inaczej dane common trafilyby do nwinfo.
BATCH='[
 {"jsonrpc":"2.0","id":3,"result":[0,{"model_name":"MC7510"}]},
 {"jsonrpc":"2.0","id":1,"result":[0,{"lte_rsrp":-80,"network_type":"ENDC"}]},
 {"jsonrpc":"2.0","id":2,"error":{"code":-32002,"message":"Access denied"}}
]'
R5="$(printf '%s' "$BATCH" | _map)"
eq "id 3 -> common.model_name" "MC7510" "$(_f "$R5" model_name)"
eq "id 1 -> nwinfo.lte_rsrp"   "-80"    "$(_f "$R5" lte_rsrp)"
eq "id 1 -> nwinfo.network_type" "ENDC" "$(_f "$R5" network_type)"
empty "wywolanie z bledem pomijane, nie wysypuje mappera" "$(_f "$R5" imei)"

echo
if [ "$fails" -eq 0 ]; then
	echo "wszystko przechodzi"
	exit 0
fi
echo "$fails testow nie przechodzi"
exit 1
