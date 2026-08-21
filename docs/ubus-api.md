# API `ubus` modemów ZTE (MC7510)

Część nowszych CPE ZTE **nie ma API `goform` w ogóle** — ich firmware stoi na OpenWrt,
a panel rozmawia z urządzeniem po **ubus JSON-RPC**. Sprawdzone na MC7510
(sprzedawanym w Orange Polska jako **G51F**).

Rozpoznanie jest jednoznaczne, bo stary endpoint zwraca **404**:

```
GET http://<modem>/goform/goform_get_cmd_process?isTest=false&cmd=LD
    -> 404  <h1>Not Found</h1>          <= nie ten protokół
```

```
POST http://<modem>/ubus/
     [{"jsonrpc":"2.0","id":1,"method":"call",
       "params":["<sesja>","<moduł>","<metoda>",{<argumenty>}]}]

     -> [{"jsonrpc":"2.0","id":1,"result":[0,{<dane>}]}]        sukces
     -> [{"jsonrpc":"2.0","id":1,"error":{"code":-32002,        brak sesji
           "message":"Access denied"}}]
```

Zero w `result[0]` to status ubusa; **dane siedzą w `result[1]`**. Sesja, której jeszcze
nie mamy, to **32 zera** — nie pusty łańcuch. Zapytania wymagają nagłówka
`Referer: http://<modem>/`.

Zakres używany przez moduł to **tylko odczyt**, tak samo jak na goformie.

## Logowanie

Jeden wariant, `sha256_salt` — zapisywany w `zte-modem.main.hash_variant` obok
wariantów goformowych, bo to nadal jest sposób hashowania hasła:

```
zwrt_web.web_login_info          -> {"zte_web_sault": "<64 hex>", "login_fail_num": 5}
                                    (odpowiada BEZ sesji)

hash = SHA256( SHA256(hasło)ᵁᴾ + sault )ᵁᴾ        oba skróty WIELKIMI literami hex

zwrt_web.web_login {"password": hash}
                                 -> {"result": 0, "ubus_rpc_session": "<32 hex>"}
```

Sól nazywa się w oryginale `zte_web_sault` (tak, przez `u`) i jest odpowiednikiem
goformowego `cmd=LD` — z tą różnicą, że **nie jest tu potrzebne pobieranie świeżej soli
przy każdej próbie**, bo wariant jest tylko jeden i nie ma czego zgadywać.

| pole | znaczenie |
|---|---|
| `ubus_rpc_session` | token sesji, 32 hex — wstawiany w `params[0]` kolejnych wywołań |
| `login_fail_num` | **pozostałe** próby, tak jak goformowe `psw_fail_num_str` |
| `login_fail_lock_lefttime` | sekundy blokady; `0` = nie zablokowany |
| `login_timeout_lefttime` | ile jeszcze żyje sesja (≈600 s od ostatniego użycia) |

Ręczna diagnostyka: `ubus call zte-modem probe` — mówi wykryty protokół, długość soli
i czy logowanie się udało.

## ⚠️ Bez sesji nie ma NICZEGO

Na goformie osiem pól (`model_name`, `network_type`, …) czyta się bez logowania, więc
wygasła sesja wygląda jak modem bez SIM-u. Tutaj jest odwrotnie i prościej: **każda
metoda bez ważnej sesji odpowiada `Access denied`**. Nie ma stanu „część pól".

Dlatego backend nie ma osobnego zapytania sprawdzającego sesję (odpowiednika
`user_ip_addr`): po prostu **wykonuje paczkę odczytów zapamiętanym tokenem**, a dopiero
odmowa dostępu uruchamia logowanie. Przy żywej sesji całe odświeżenie to **jedno
zapytanie HTTP**.

## Paczka wywołań = odpowiednik `multi_data=1`

W jednym POST-cie można wysłać **tablicę wywołań**. Bez tego każde odświeżenie to
dziewięć round-tripów do modemu.

Backend wysyła dziewięć metod i **przypisuje odpowiedzi po polu `id`**, nie po pozycji
w tablicy — kolejność odpowiedzi nie jest niczym zagwarantowana, a `id` ustawiamy sami:

| `id` | moduł | metoda | po co |
|---|---|---|---|
| 1 | `zte_nwinfo_api` | `nwinfo_get_netinfo` | sygnał, komórka, agregacja, 5G |
| 2 | `zwrt_web` | `device_info` | IMEI, firmware |
| 3 | `zwrt_zte_mdm.api` | `get_zwrt_common_info` | `model_name`, HW, nazwa handlowa |
| 4 | `zwrt_zte_mdm.api` | `get_sim_info` | ICCID, stan karty, PIN |
| 5 | `zwrt_data` | `get_wwaniface` | adresy IPv4/IPv6, DNS |
| 6 | `zwrt_data` | `get_wwandst` (`type: 4`) | liczniki transferu |
| 7 | `zwrt_data` | `get_wwandst_monthlimit` | limit transferu |
| 8 | `zwrt_apn_object` | `getCidApnList` | APN, typ PDP |
| 9 | `zwrt_web` | `web_info` | adres panelu modemu |

Metody z `zwrt_data` wymagają argumentów `{"source_module": "web", "cid": 1}`.

## Mapowanie nazw pól na `goform`

Widok zna **wyłącznie nazwy goformowe**, więc odpowiedź przechodzi przez
`/usr/share/zte-modem/ubus-map.uc`. Dalej — cache, btsearch, widok — różnicy już nie ma.

| goform | ubus | uwagi |
|---|---|---|
| `model_name` | `common.model_name` | `"MC7510"` |
| `wa_inner_version` | `device.wa_inner_version` | |
| `hardware_version` | `common.hardware_version` | |
| `web_version` | `common.GUI_version` | **nie** `web_red_version` (to wydanie regionalne) |
| `device_market_name` | `common.device_market_name` | pole własne — `"G51F"` |
| `lan_ipaddr` | `web.web_local_addr` | |
| `iccid` | `sim.sim_iccid` | |
| `pin_status`, `modem_main_state` | `sim.*` | |
| `lte_rsrp/rsrq/rssi/snr` | `nwinfo.lte_*` | te same nazwy |
| `lte_pci`, `cell_id` | `nwinfo.*` | **dziesiętnie**, patrz niżej |
| `Z5g_rsrp` / `Z5g_rsrq` / `Z5g_SINR` | `nr5g_rsrp` / `nr5g_rsrq` / `nr5g_snr` | |
| `nr5g_pci`, `nr5g_action_band/_channel` | te same nazwy | |
| `lte_ca_pcell_band/_freq/_bandwidth` | z pierwszego wpisu `lteca` | |
| `lte_multi_ca_scell_info` | z kolejnych wpisów `lteca` | przełożone na układ goformu |
| `_scell_sig` | `nwinfo.ltecasig` | pole własne, **goform tego nie ma** |
| `wan_ipaddr`, `ipv6_wan_ipaddr` | `iface.ipv4_address`, `iface.ipv6_address` | |
| `wan_apn`, `pdp_type` | `apn.cid_table.apnListArray[]` | |
| `monthly_*`, `realtime_*` | `traffic.month_*`, `traffic.real_*` | |
| `data_volume_limit_*` | `limit.enable/type/value` | |

### ⚠️ Typy są mieszane — wszystko schodzi do łańcuchów

`goform` oddaje czysty tekst, więc widok porównuje wprost (`st.pin_status === '0'`,
`st.simcard_roam === 'Home'`). ubus oddaje **typy JSON-a i to niekonsekwentnie**:

```json
"signalbar": "5",        "rmcc": 260,        "lte_pci": 259,
"lte_snr": "7.0",        "lte_rsrp": -80,    "pin_status": 0
```

Mapper sprowadza wszystko do łańcuchów. Liczby zmiennoprzecinkowe wypisuje przez
`%J`, a **nie** `%s` — `%s` obcina `"4.0"` do `"4"`, a te pola czyta się jako pomiar
z dokładnością do dziesiątych.

### ⚠️ Identyfikatory są DZIESIĘTNE

Na goformie `cell_id` i `lte_pci` są szesnastkowe i backend rozstrzyga kodowanie
zakresem (patrz [kodowanie-pol.md](kodowanie-pol.md)). Tutaj **wiadomo**, więc backend
ustawia `_cell_base` i `_pci_base` na `dec` wprost. Potwierdzenie trojakie:

| wartość | jako hex | wniosek |
|---|---|---|
| `cell_id` = `35072027` | `889438247` | > 268435455, czyli **nie** 28-bitowe ECI |
| `lte_pci` = `259` | `601` | poza zakres PCI 0–503 |
| PCI w `lteca` = `259` | — | dziesiętne i **równe** `lte_pci` |

Sprawdzone też od drugiej strony: ECI 35072027 → eNodeB 35072027/256 = **137000**,
sektor 27 — i btsearch po tym numerze znajduje stację `N37000` w Namysłowie, zgodnie
z operatorem z `network_provider`. Heurystyki z zakresu dałyby tu ten sam wynik, ale
przestają działać dla małych wartości (`PCI = "100"` jest poprawne w obu systemach) —
skoro wiemy, to nie zgadujemy.

### ⚠️⚠️ `lte_band` to LISTA PASM WŁĄCZONYCH, nie pasmo nośnej

Największa pułapka nazw. Na goformie `lte_band` jest pasmem nośnej głównej i widok robi
z niego `"B" + wartość`. Na MC7510 pod tą samą nazwą siedzą **pasma dozwolone
w ustawieniach**:

```
lte_band = "1,3,8,20,38"        ->  pasmo "B1,3,8,20,38"
```

Mapper **nie przepisuje tego pola**. Pasmo nośnej głównej bierze z `lteca`, gdzie jest
jednoznaczne. (Pasma zablokowane siedzą osobno w `lte_band_lock` jako maska hex.)

### Agregacja nośnych: `lteca`

Nośne rozdzielone `;`, każda jako **`PCI,pasmo,LAC,EARFCN,szerokość`**, pierwsza to
nośna główna:

```
lteca = "259,1,53711,75,15.0;259,3,2,1725,15.0;307,20,2,6200,10.0;"
         └ PCell: PCI 259, B1, LAC 53711, EARFCN 75, 15 MHz
```

Układ odczytany z danych i **spójny arytmetycznie**:

- PCI 259, EARFCN 75 i LAC 53711 z pierwszego wpisu zgadzają się z osobnymi polami
  `lte_pci`, `wan_active_channel` i `lac_code`;
- numery pasm zgadzają się z zakresami EARFCN wg 3GPP TS 36.101:
  75 → B1 (0–599), 1725 → B3 (1200–1949), 6200 → B20 (6150–6449).

Trzecie pole jest LAC-iem **tylko dla nośnej głównej** — dla dodatkowych stoi tam `2`
(te same `2` przy obu nośnych i przy kolejnych próbkach). Czym jest, nie wiadomo;
widok tego nie potrzebuje.

Nośne dodatkowe mapper przelicza na goformowy układ `idx,PCI,?,pasmo,EARFCN,szerokość`.
Ta sama nośna z tym samym PCI na **różnych** EARFCN-ach jest normalna (tu PCI 259 na B1
i na B3) — odsiewanie duplikatu w widoku wymaga zgodności PCI **i** EARFCN, więc nie
gubi takiego przypadku.

### `ltecasig` — poziom na nośną DODATKOWĄ

Czego goform nie podaje w ogóle (odpytane i puste na MC888 i MC7010). Wpis to
**`RSRP, RSRQ,SINR,RSSI,?,?`** — ze spacją w środku, więc pola trzeba obcinać.

⚠️ Dotyczy **nośnych dodatkowych, nie wszystkich**. Rozstrzygnięte pomiarem, nie
założeniem — cztery próbki co 4 s:

| | |
|---|---|
| `lteca` | 3 nośne (B1 + B3 + B20) |
| `ltecasig` | **2 wpisy** — tyle, ile nośnych **dodatkowych** |
| `lte_rsrp` (PCell) | −79 / −80 |
| `ltecasig[0]` | stabilnie **−75.0** |
| `ltecasig[1]` | stabilnie **−71.0** |

Gdyby wpisy zaczynały się od nośnej głównej, pierwszy musiałby iść za `lte_rsrp`. Nie
idzie — a liczba wpisów równa się liczbie nośnych dodatkowych. Stąd `ltecasig[i]`
opisuje `SCC(i+1)`, a mapper wystawia to jako `_scell_sig` w układzie
`RSRP,RSRQ,SINR,RSSI` na nośną.

Widok dokłada wtedy do tabeli nośnych kolumny **RSRP** i **SINR** — dla nośnej głównej
z jej własnych pól, dla dodatkowych z `_scell_sig`. Modemy goformowe zostają przy pięciu
kolumnach, bo dwie puste kolumny wyglądałyby na usterkę odczytu, a nie na brak wsparcia
w firmwarze.

### ⚠️ `nr5g_cell_id` = 268435455 to „nieznane", nie numer

Przy zestawionym ENDC modem oddaje `268435455` = `0xFFFFFFF`, czyli **same jedynki na
28 bitach** NR CI. W NSA nie zawsze dostaje pełną tożsamość komórki 5G. Mapper odsiewa
tę wartość — bez tego widok pokazywałby ją jako prawdziwy identyfikator.

### ⚠️⚠️ `sim_imsi` i `msisdn` są ZASZYFROWANE

Nie jest to base64 z IMSI, tylko szyfrogram w base64 — klucz panel trzyma po swojej
stronie:

```
sim_imsi = "5C3T4ogfD8QYfM0OrZ/F1WmtTenH+9W0qvGfjdzhFMAE8eTu05QyPIiH1w=="
msisdn   = "SW0iRPywnHMSSh/PiKDZZvQ89uWeSIBh8fQ0Ng=="
```

Mapper **nie przepisuje** tych pól. Wpisanie ich do `sim_imsi` wyświetliłoby blok base64
z podpisem „IMSI", czyli śmieć udający dane. PLMN widok policzy z `rmcc` / `rmnc`.

Dla kontrastu `spn_name_data` jest zwykłym **UTF-16BE hex** (`004F00720061006E00670065`
= `Orange`) — ale nazwa operatora jest już w `network_provider`, więc pole jest zbędne.

### ⚠️ `web_api_telus_para_get` PRZYCINA adresy IPv6 do 31 znaków

Skrócony status ma większość interesujących pól i jest kuszący jako jedno zapytanie,
ale kaleczy adresy:

```
telus_para.ipv6_wan_ipaddr = "2a00:0f44:0cf1:391b:72f0:7c4b:f"          31 znaków
iface.ipv6_address         = "2a00:0f44:0cf1:391b:72f0:7c4b:f39f:988c"  pełny
```

To samo dotyczy `ipv6_prefer_dns_auto` i `ipv6_standby_dns_auto`. Adresy bierzemy
**wyłącznie** z `get_wwaniface`.

### ⚠️ W trybie bridge `ipv4_address` to `"0"`, nie pustka

MC7510 w `LTE_BRIDGE` z sesją IPv6-only oddaje `"0"` w polach IPv4 (adres, maska, brama,
DNS). Mapper zamienia `"0"`, `"0.0.0.0"` i `"::"` na pustkę, żeby widok potraktował je
jak nieobsługiwane, a nie pokazał adres `0`.

Podobnie `rssi` i `rscp` w `nwinfo` stoją na **0** przy poprawnie wypełnionym
`lte_rssi = -80`. Widok bierze pierwszą **niepustą** wartość, więc przepuszczone zero
udawałoby pomiar równy 0 dBm.

### Komórki sąsiednie: tylko PCI i EARFCN

`lte_neighbor_cell` bywa wypełnione (złapane raz na cztery próbki: `"258,75;"` przy
komórce obsługującej PCI 259 na EARFCN 75) i ma układ **`PCI,EARFCN`** — ten sam, co
`nr_neighbor_cell` = `"464,640704;"` przy `nr5g_pci` 463 i `nr5g_action_channel` 640704.

Goformowe `ngbr_cell_info` to `EARFCN,PCI,RSRQ,RSRP,RSSI` — inna kolejność i, co
ważniejsze, **z poziomami**. Cała wartość tabeli sąsiadów to kolumna Δ (odstęp RSRP od
komórki obsługującej), której z PCI i EARFCN policzyć nie sposób. Mapper zostawia więc
to pole puste, a tabela sąsiadów na MC7510 się nie pokazuje — świadomie, bo „prawie"
byłoby tu gorsze niż nic.

### Limit transferu

`get_wwandst_monthlimit`: `enable` 0/1, `type` **1 = czas / 2 = dane**, `value` = próg,
`ratio` = zużycie w procentach, `overflow` = przekroczony.

⚠️ **Jednostka `value` jest niesprawdzona** — na dostępnym MC7510 limit jest wyłączony
i pole stoi na 0, więc nie ma czego skalibrować. Przyjęte: bajty, zapisywane
w goformowym kodowaniu `"<liczba>_<jednostka w MB>"` z jednostką 1 B, żeby
`limitBytes()` w widoku wyłożyło z tego te same bajty. Sekcja limitu powstaje tylko
przy włączonym limicie **na dane**, więc dopóki użytkownik go nie ustawi, nic z tego
nie wynika.

⚠️ `ratio` to **zużycie**, nie próg ostrzeżenia — nie jest tym samym co goformowe
`data_volume_alert_percent` i nie jest na nie mapowane.

## Zależności na routerze

Te same co dla goformu plus **`ucode` w roli parsera JSON-a** — nie tylko do base64.
Odpowiedź to dziewięć zagnieżdżonych obiektów w jednej tablicy JSON-RPC; składanie tego
`jsonfilter`-em oznaczałoby kilkadziesiąt wywołań na odświeżenie.

Podział jest taki: **shell robi HTTP i kryptografię** (`curl`, `sha256sum` — tak jak na
goformie), **ucode robi JSON** (jedno wywołanie na odświeżenie). Hasło i token idą
przez środowisko albo plik `0600`, nigdy przez `argv`.

### ⚠️ Pułapki samego ucode

Trzy rzeczy, na których ten mapper już się wywrócił — każda daje objaw mylący:

| pułapka | objaw |
|---|---|
| `map(arr, trim)` | ucode woła funkcję z **trzema** argumentami `(wartość, indeks, tablica)`, a `trim` przyjmuje drugim argumentem **zestaw znaków**. Dostaje indeks i zwraca `null` — cała lista wychodzi jako `[null, null, …]`, czyli modem wygląda na taki, który nie podaje agregacji. Trzeba `map(arr, function(x) { return trim(x); })`. |
| `v === undefined` | `undefined` **nie istnieje** jako nazwa globalna — odwołanie jest **błędem wykonania**, nie fałszem. Braki w ucode to `null`. Objaw jest opóźniony: dopóki wartość jest `null`, warunek `v === null` zwiera się przed błędem, więc mapper działa na pustych danych i wywala się dopiero na prawdziwych. |
| `json("śmieć")` | **rzuca** błąd składni, nie zwraca `null`. Bez `try`/`catch` urwana odpowiedź modemu wywala mapper zamiast dać pusty wynik. |

Nawiasem: domyślnej wartości argumentu **nie wolno** pisać jako `${4:-\{\}}` w shellu —
wewnątrz cudzysłowów backslash przed klamrą zostaje dosłownie, więc modem dostaje
zepsuty JSON. Osobna zmienna i `[ -n "$args" ] || args='{}'`.

## Testy

```sh
sh tests/ubus-map.test.sh --ssh root@<router>    # mapper na prawdziwych próbkach
node tests/mc7510.test.js                        # widok: tabela nośnych, _scell_sig
```

Pierwszy potrzebuje `ucode` i `jsonfilter`, więc na maszynie deweloperskiej odpala się
go przez `--ssh`. Próbki w obu plikach są zdjęte z żywego MC7510.
