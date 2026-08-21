# Pułapki — skrót

Indeks rzeczy, które kosztowały najwięcej czasu. Każda pozycja ma rozwinięcie
w odpowiednim dokumencie. Warto przeczytać **przed** dodaniem obsługi kolejnego modelu.

## Protokół i sesja

| pułapka | objaw | gdzie |
|---|---|---|
| **`cmd=loginfo` nie jest wskaźnikiem sesji** | `_authenticated: true` przy pustych metrykach; moduł nigdy się nie loguje | [goform-api](goform-api.md#-cmdloginfo-nie-jest-wskaźnikiem-sesji) |
| **`LD` rotuje po nieudanym logowaniu** | „żaden wariant hasha nie działa" przy strzelaniu serią z jednym LD | [goform-api](goform-api.md#-ld-rotuje-po-nieudanej-próbie) |
| **Wygasła sesja wygląda jak awaria modemu** | komplet kluczy, wypełnione tylko 8 pól; branie tego za limit `multi_data` | [goform-api](goform-api.md#pola-dostępne-bez-logowania) |
| **Jedna sesja naraz** | ręczna diagnostyka wybija sesję modułu → fałszywy „regres po wdrożeniu" | [goform-api](goform-api.md#-jedna-sesja-administratora-naraz) |
| **`login_lock_time` puste bez `multi_data=1`** | pole niby nie istnieje | [goform-api](goform-api.md#semantyka-pól-logowania) |
| **`psw_fail_num_str` to pozostałe próby, nie zużyte** | odwrotna interpretacja licznika blokady | [goform-api](goform-api.md#semantyka-pól-logowania) |

## Drugi protokół (ubus, MC7510)

| pułapka | objaw | gdzie |
|---|---|---|
| **MC7510 nie ma `goform` w ogóle** | `404` na `/goform/...`; szukanie wariantu hasha zamiast innego protokołu | [ubus-api](ubus-api.md) |
| **`lte_band` to lista pasm WŁĄCZONYCH, nie pasmo nośnej** | pasmo „B1,3,8,20,38" w tabeli nośnych | [ubus-api](ubus-api.md#-lte_band-to-lista-pasm-włączonych-nie-pasmo-nośnej) |
| **`ltecasig` opisuje nośne DODATKOWE, nie wszystkie** | poziom SCC1 przypisany nośnej głównej; 3 nośne przy 2 wpisach | [ubus-api](ubus-api.md#ltecasig--poziom-na-nośną-dodatkową) |
| **`nr5g_cell_id` = `268435455`** | `0xFFFFFFF` (same jedynki) pokazane jako prawdziwy Cell ID 5G | [ubus-api](ubus-api.md#-nr5g_cell_id--268435455-to-nieznane-nie-numer) |
| **`sim_imsi` i `msisdn` są zaszyfrowane** | blok base64 z podpisem „IMSI" | [ubus-api](ubus-api.md#-sim_imsi-i-msisdn-są-zaszyfrowane) |
| **`web_api_telus_para_get` przycina IPv6 do 31 znaków** | ucięty adres, który wygląda na prawdziwy | [ubus-api](ubus-api.md#-web_api_telus_para_get-przycina-adresy-ipv6-do-31-znaków) |
| **W trybie bridge `ipv4_address` to `"0"`, nie pustka** | adres WAN „0"; `rssi`/`rscp` = 0 udające pomiar 0 dBm | [ubus-api](ubus-api.md#-w-trybie-bridge-ipv4_address-to-0-nie-pustka) |
| **Typy JSON-a są mieszane i niekonsekwentne** | `st.pin_status === '0'` przestaje trafiać, bo modem dał liczbę | [ubus-api](ubus-api.md#-typy-są-mieszane--wszystko-schodzi-do-łańcuchów) |
| **Sąsiedzi bez poziomów** | tabela sąsiadów pusta; „prawie" gorsze niż nic | [ubus-api](ubus-api.md#komórki-sąsiednie-tylko-pci-i-earfcn) |

### ucode i shell

| pułapka | objaw | gdzie |
|---|---|---|
| **`map(arr, trim)`** | ucode woła z 3 argumentami, `trim` bierze indeks za zestaw znaków → cała lista `[null, null, …]`, modem wygląda na taki bez agregacji | [ubus-api](ubus-api.md#-pułapki-samego-ucode) |
| **`v === undefined` w ucode** | `undefined` nie istnieje → **błąd wykonania**, i to opóźniony: na pustych danych warunek zwiera się wcześniej, wywala dopiero na prawdziwych | [ubus-api](ubus-api.md#-pułapki-samego-ucode) |
| **`json()` rzuca, nie zwraca `null`** | urwana odpowiedź modemu wywala mapper zamiast dać pusty wynik | [ubus-api](ubus-api.md#-pułapki-samego-ucode) |
| **`${4:-\{\}}` w shellu** | backslash zostaje dosłownie, modem dostaje zepsuty JSON i „nie odpowiada" | [ubus-api](ubus-api.md#-pułapki-samego-ucode) |

## Kodowanie wartości

| pułapka | objaw | gdzie |
|---|---|---|
| **Kodowanie jest per POLE, nie per urządzenie** | `cell_id` hex + `lte_pci` dec na tym samym modemie | [kodowanie-pol](kodowanie-pol.md) |
| **PCI czytane jako hex zamiast dec** | PCI 11 i 133 zamiast 17 i 307 | [kodowanie-pol](kodowanie-pol.md#lte_pci--_pci_base-decyzja-osobna) |
| **PCI w `lte_multi_ca_scell_info` i `ngbr_cell_info` jest dziesiętne**, a `lte_pci` szesnastkowe | niespójność w tabeli nośnych | [modele](modele.md#agregacja-nośnych-ca) |
| **Pasma i kanały są dziesiętne** | B20 odczytane jako 32 | [kodowanie-pol](kodowanie-pol.md#co-jest-dziesiętne-mimo-wszystko) |
| **`wan_active_band` kłamie** | „LTE BAND 1" przy EARFCN z B3 i B28 | [kodowanie-pol](kodowanie-pol.md#wan_active_band-potrafi-kłamać) |
| **`enodeb_id` bywa kopią `cell_id`** | numer komórki udaje numer stacji | [kodowanie-pol](kodowanie-pol.md#enodeb-liczymy-sami) |
| **`cell_id` niepełny przed rejestracją** | krótka wartość, heurystyka wybiera hex | [kodowanie-pol](kodowanie-pol.md#cell_id--_cell_base) |
| **Na ubusie identyfikatory są DZIESIĘTNE** | heurystyki hex/dec są tam zbędne — backend ustawia `dec` wprost, bo dla małych wartości zakres nie rozstrzyga | [ubus-api](ubus-api.md#-identyfikatory-są-dziesiętne) |

## Pola i modele

| pułapka | objaw | gdzie |
|---|---|---|
| **Nazwa modelu nie wyznacza rodziny** | reguła „MF = bez wyzwania" wywraca się na MF297D | [modele](modele.md#potwierdzone-urządzenia) |
| **SNR/RSSI pod alternatywnymi nazwami** | puste metryki na MF297D mimo dobrego sygnału | [modele](modele.md#metryki-radiowe) |
| **`rssi` bez znaku** | RSSI `67` zamiast `-67` | [modele](modele.md#metryki-radiowe) |
| **`lte_ca_scell_band` = `"0"`** | widmowa nośna „B0, 0.0 MHz" w tabeli | [modele](modele.md#agregacja-nośnych-ca) |
| **MC888 melduje PCell drugi raz jako SCell** | „4×CA, 50 MHz, sufit 378 Mb/s" zamiast 3×CA, 35 MHz, 265 Mb/s — i zawyżone paski na zakładce Transfer | [modele](modele.md#agregacja-nośnych-ca) |
| **`realtime_*_thrpt` skacze o 5 rzędów wielkości** | uśrednianie próbek daje wynik zależny od trafienia w szczyt, nie od łącza | [modele](modele.md#liczniki-transferu) |
| **Zakłócenia liczone z `ngbr_cell_info` nie odtwarzają `lte_snr`** | „obliczony SINR" 0,9 dB przy zmierzonym 13,4 dB — na liście siedzą sektory tego samego masztu | [modele](modele.md#-zakłócenia-policzone-z-tego-pola-nie-odtwarzają-lte_snr) |
| **IMSI tylko z `sim_imsi`** | puste IMSI na serii MC | [modele](modele.md#tożsamość-urządzenia-i-karty-sim) |
| **ICCID z końcowym `F`** | 20 znaków zamiast 19 cyfr | [modele](modele.md#tożsamość-urządzenia-i-karty-sim) |
| **Wersja panelu w dwóch różnych polach** | `web_version` pusty na MF297D | [modele](modele.md#tożsamość-urządzenia-i-karty-sim) |
| **`ipv6_wan_ipaddr` = `"::"`** | pusty wiersz zamiast braku wiersza | [modele](modele.md#tożsamość-urządzenia-i-karty-sim) |

## Środowisko

| pułapka | objaw | gdzie |
|---|---|---|
| **`which curl` nie wystarcza** | `Error relocating: curl_multi_notify_enable` przy niedopasowanym `libcurl4` | [goform-api](goform-api.md#zależności-na-routerze) |
| **Adres modemu ≠ adres routera** | konfiguracja wskazująca na sam router | — |
| **Brak `luci-compat` na LuCI 24.10** | `Map`/CBI nie działa; stąd widok w JS | [../luci-app-zte-modem-light/README.md](../luci-app-zte-modem-light/README.md) |
| **`.ipk` to NIE archiwum `ar`** | `ar t` listuje człony, wszystko wygląda dobrze, a opkg mówi tylko „Malformed package file" | [../scripts/build-pkg.sh](../scripts/build-pkg.sh) |
| **Do `.apk` wsiąka etykieta SELinuksa z kontenera** | `security.selinux=…container_file_t…` w metadanych pakietu | [../scripts/build-pkg.sh](../scripts/build-pkg.sh) |
| **`arch: all` w `.apk`** | `apk mkpkg` przyjmuje bez skargi, a przy instalacji `error: uninstallable`; apk-tools mówi na to `noarch` | [instalacja-i-diagnostyka](instalacja-i-diagnostyka.md#error-uninstallable-przy-apk-add) |
| **Obraz docker OpenWrt nie ma linii `arch` w `/etc/opkg.conf`** | `.ipk all` odbija się od `incompatible with the architectures configured` — na prawdziwym routerze tego nie ma | [../scripts/build-pkg.sh](../scripts/build-pkg.sh) |

## Metodologiczne

Trzy hipotezy, które okazały się fałszywe — warto o nich pamiętać, zanim postawi się
czwartą:

1. **„Jest limit liczby pól w `multi_data`"** — nie ma. Dwa razy pod rząd objaw pochodził
   z wygasłej sesji.
2. **„Rodzina MC ma wyzwanie, rodzina MF nie"** — MF297D obala. Rodzinę wyznacza
   zachowanie, nie nazwa.
3. **„Hasło ZTE koduje się base64 przed hashem"** — najczęstszy opis w sieci, a na
   sprawdzonych firmware'ach nieprawdziwy.
4. **„Każdy modem ZTE gada po `goform`"** — MC7510 obala. Na starym endpoincie oddaje
   `404`, bo jego firmware stoi na OpenWrt i panel rozmawia po ubusie. Objaw („nie
   loguje się") wygląda dokładnie jak nieznany wariant hasha, więc łatwo szukać
   piątego wariantu zamiast drugiego protokołu.

Wspólny mianownik: **opis z internetu i cudzy kod zawodziły, empiria na fizycznym
urządzeniu nie.** Stąd nacisk na tabele „sprawdzone na żywo" zamiast na dokumentację.
