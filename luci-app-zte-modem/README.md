# luci-app-zte-modem — monitoring modemów ZTE (MC888, MC7010, …) w LuCI

Moduł LuCI pokazujący na żywo parametry sygnału modemu ZTE stanowiącego łącze WAN routera.

Wdrożenia:

| Router | Modem | Adres modemu |
|---|---|---|
| R2 — MikroTik RB5009, OpenWrt 24.10.2 (`192.168.0.1`) | **MC888** | `192.168.32.1` |
| Cudy WR3000S, OpenWrt 24.10.2 (`192.168.10.1`) | **MC7010** | `192.168.8.1` |

W obu przypadkach modem jest **bramą domyślną routera**. To
samodzielny CPE po Ethernecie, więc `modemdata`/`modemband`/`sms-tool` z feedu eko.one.pl
**nie mają zastosowania** (zależą od `comgt`/AT i wymagają `/dev/ttyUSB*` albo
`/dev/cdc-wdm*`, których na tych routerach nie ma). Komunikacja idzie po HTTP przez `goform`.

Zakres: **tylko odczyt**. Żadnego restartu, SMS-ów ani blokowania pasm — dzięki temu
niepotrzebny jest nagłówek `AD` i nie da się przez pomyłkę odciąć od sieci.

## Instalacja

```sh
./deploy.sh                 # domyślnie root@192.168.0.1
./deploy.sh --dry-run       # podgląd bez zmian
./deploy.sh root@10.0.0.1   # inny cel
```

Skrypt jest idempotentny i **nie nadpisuje istniejącego `/etc/config/zte-modem`** (trzyma
hasło). Po wgraniu restartuje `rpcd` i sprawdza, czy obiekt ubus się zarejestrował.

Hasło ustawia się w LuCI: **Services → Modem ZTE → Konfiguracja**. Do repozytorium
nie trafia — plik w `files/` ma pustą wartość.

## Architektura

Wzorzec jak `luci-app-apcontroller`: widok w JS + backend w `rpcd`. Świadomie **nie**
Lua/CBI — w LuCI 24.10 wymagałoby to `luci-compat`, którego na R2 nie ma.

```
files/etc/config/zte-modem                                UCI: host, hasło, interwał
files/usr/libexec/rpcd/zte-modem                          backend, obiekt ubus zte-modem
files/usr/share/rpcd/acl.d/luci-app-zte-modem.json        ACL
files/usr/share/luci/menu.d/luci-app-zte-modem.json       wpis menu (admin/services)
files/www/luci-static/resources/view/zte-modem/status.js  widok: zakładki Status i Konfiguracja
```

Strona ma trzy zakładki, zrobione wbudowanym mechanizmem `form.Map` (`m.tabbed = true`),
tak samo jak apcontroller. Przy `m.tabbed` **każda sekcja mapy staje się osobną zakładką**:
`data-tab` bierze się z `sectiontype`, a etykieta z `title` sekcji. Stąd wymóg —
**obie sekcje muszą mieć różny `sectiontype`**, inaczej `ui.tabs.initTabGroup()` skleja je
w jedną. Zakładki Status i Transfer to własne podklasy `form.NamedSection` z nadpisanym
`render()` (sectiontype `status` / `transfer`), konfiguracja siedzi w zwykłej sekcji
(sectiontype `zte-modem`).

### Prezentacja sygnału

Czterostopniowa skala z nazwanym poziomem — **Doskonały / Dobry / Średni / Skraj komórki** —
zamiast samego koloru. Pomysł zapożyczony z
[luci-app-3ginfo-lite](https://github.com/4IceG/luci-app-3ginfo-lite), implementacja własna,
bo tam progi **zachodzą na siebie** (dla RSRQ warunki `>= -10` oraz `>= -15 && <= -9` łapią
jednocześnie −10 i −9, wygrywa ostatni sprawdzony), a wyliczanie długości paska potrafi
przekroczyć 100% i jest łatane hackiem `width:33%` na kontenerze.

Tutaj `TIERS[*].steps` jest uporządkowane malejąco i wygrywa **pierwszy** pasujący próg,
więc przedziały są rozłączne z definicji:

| | Doskonały | Dobry | Średni | Skraj komórki |
|---|---|---|---|---|
| RSRP [dBm] | ≥ −80 | −90…−81 | −100…−91 | < −100 |
| RSRQ [dB] | ≥ −10 | −15…−11 | −20…−16 | < −20 |
| SINR [dB] | ≥ 20 | 13…19 | 1…12 | ≤ 0 |
| RSSI [dBm] | ≥ −65 | −75…−66 | −85…−76 | < −85 |

Pasek to natywny **`.cbi-progressbar`** z LuCI, nie własne div-y — dziedziczy wygląd
z motywu. Warto wiedzieć, że motyw renderuje atrybut `title` jako etykietę **nad** paskiem
(`.cbi-progressbar::before { content: attr(title) }`), więc wartość i ocena jakości trafiają
właśnie tam zamiast do osobnego elementu.

### Rozpoznawanie stacji bazowej (btsearch.pl)

Zakładka Status pokazuje **operatora, miejscowość, adres i współrzędne masztu**, z którego
wisi modem, plus odnośnik do mapy OpenStreetMap. Cell ID wypisany jest szesnastkowo
i dziesiętnie (`21ab417 (35304471)`), ale **bez odnośnika** — patrz niżej.

Stary link `szukaj.php?mode=std&search=` **nie działa** — btsearch.pl jest dziś SPA za
Cloudflare i każdy adres zwraca ten sam ~5,8 kB szkielet HTML. Jest za to publiczne API:

```
POST https://btsearch.pl/api/v1/search
Content-Type: application/json

{"query": "ecid: 35304471"}
```

Modem podaje Cell ID **szesnastkowo** (`21ab417`), API szuka po **dziesiętnym ECI**
(`35304471`). Odpowiedź zawiera `data[0].operator.name`, `data[0].location.{city,address,
latitude,longitude}` oraz listę komórek z `ecid` / `enbid` / `clid` / `earfcn`.

> `ecid:` i `enbid:` są prawdziwymi filtrami. Uwaga na inne nazwy — `clid:` czy `pci:`
> wyglądają na fallback do wyszukiwania tekstowego po `station_id` i zwracają przypadkowe
> stacje. Trafienie warto potwierdzić po `ecid` w zwróconych komórkach.

Backend **cache'uje odpowiedź w tmpfs pod numerem komórki** (`/tmp/zte-modem.bts.<dec>.json`)
— maszt zmienia się rzadko, więc to jedno zapytanie na zmianę komórki, nie przy każdym
odświeżeniu. Ciepły odczyt ~0,15 s, zimny ~0,46 s. Cache jest przycinany do 20 ostatnich
komórek. Nietrafione zapytanie **nie jest cache'owane** — spróbuje ponownie.

Wyłącznik: `option bts_lookup '0'` (albo pole w zakładce Konfiguracja) — wtedy Cell ID
**nie opuszcza sieci lokalnej**.

**Żadnych dodatkowych pakietów.** Na R2 nie ma `openssl` ani `base64`, więc:

| Potrzeba | Rozwiązanie |
|---|---|
| HTTP + cookies | `curl` |
| base64 | `ucode -e 'print(b64enc(getenv("ZTEPW")))'` — hasło przez **środowisko**, nie `argv` (nie widać go w `ps`) |
| SHA256 / MD5 | `sha256sum`, `md5sum` |
| JSON | `jsonfilter`, `jshn.sh` |
| Serializacja | `flock` |

## API modemu

```
GET /goform/goform_get_cmd_process?isTest=false&cmd=LD
    -> {"LD":"4AFC…1CB1"}                       64 hex => logowanie SHA256

POST /goform/goform_set_cmd_process
     isTest=false&goformId=LOGIN&password=<HASH>
    -> {"result":"0"}                           "0" = sukces

GET /goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=pole1,pole2,…
```

> ⚠️ **`cmd=loginfo` NIE służy do sprawdzania sesji.** W formie **pojedynczej** zwraca
> `{"loginfo":"ok"}` także **bez cookie** — sprawdzone na MC888. (Wewnątrz `multi_data=1`
> to samo pole zachowuje się już poprawnie, ale różnica jest zbyt subtelna, żeby na niej
> polegać.) Backend opierał na nim detekcję sesji i przez to nigdy się nie logował:
> `_authenticated: true` przy kompletnie pustych metrykach.

### Wykrywanie sesji: `user_ip_addr`

Pole, po którym backend poznaje ważną sesję. Puste bez cookie, po zalogowaniu zawiera
adres klienta rozmawiającego z modemem. Jako jedyne jest wypełnione na **wszystkich**
sprawdzonych modelach i **nie zależy od karty SIM ani od zestawionego połączenia**:

| model | bez cookie | z cookie |
|---|---|---|
| MC888 | `""` | `192.168.32.147` |
| MC7010 | `""` | `192.168.8.20` |
| MF79U (bez SIM) | `""` | `192.168.10.178` |

To istotne właśnie dla modemu bez karty: metryki radiowe (`lte_rsrp`, `cell_id`, …) są
wtedy puste z powodów niezwiązanych z sesją, więc oparta na nich heurystyka uznawała
modem za wylogowany przy każdym odpytaniu i moduł logował się w kółko — walcząc o jedyną
sesję z przeglądarką użytkownika. Pola radiowe zostają jako zapas.

⚠️ `SSID1` / `AuthMode` / `LocalDomain` też są bramkowane sesją, ale **tylko na MF79U** —
na MC888 i MC7010 są puste nawet po zalogowaniu. Nie nadają się na test uniwersalny.

Wszystkie zapytania wymagają nagłówka `Referer: http://<modem>/index.html`.

Potwierdzone na urządzeniach:

| model | `model_name` | `wa_inner_version` | `cmd=LD` | wariant logowania |
|---|---|---|---|---|
| MC888 | `MC888` | `BD_STDMC888V1.0.0B04` | 64 hex | `sha256_sha256` |
| MC7010 | `MC7010` | `PLY_PL_MC7010V1.0.0B03` | 64 hex | `sha256_sha256` |
| MF79U | `MF79U` | `BD_MF79UV1.0.0B03` | **puste** | `b64_plain` |

**Rodzina MF nie używa wyzwania.** `cmd=LD` zwraca `""`, a logowanie przechodzi samym
`base64(hasło)` — czyli wariantem `b64_plain`, który backend ma już na liście i wykrywa
sam, bez konfiguracji. Cookie sesji nazywa się `stok`.

⚠️ **Wygasła sesja wygląda jak awaria modemu, nie jak brak logowania.** Zapytanie
zwraca komplet kluczy, tyle że wypełnione są **tylko pola dostępne bez logowania**
(`model_name`, `network_type`, `network_provider`, `signalbar`, `ppp_status`,
`modem_main_state`, `wa_inner_version`, `simcard_roam`). Objaw łatwo wziąć za limit
liczby pól w `multi_data` — sprawdzone: **takiego limitu nie ma**, po ponownym
zalogowaniu to samo zapytanie o 40 pól zwraca komplet. Sesja MF79U wygasa szybko.

`cr_version` jest puste na obu. **`model_name` to wiarygodny klucz do rozpoznania modelu.**

**Bez logowania** czytają się: `signalbar`, `network_type`, `network_provider`,
`ppp_status`, `modem_main_state`, `wa_inner_version`, `simcard_roam`.
**Wymagają sesji**: wszystkie metryki sygnału (`lte_*`, `Z5g_*`, `nr5g_*`), `cell_id`,
`wan_ipaddr`, liczniki transferu.

### Warianty hashowania hasła

Firmware ZTE różnią się algorytmem, więc backend próbuje po kolei i **zapamiętuje
działający** w `zte-modem.main.hash_variant`:

| wariant | wzór | |
|---|---|---|
| `sha256_b64` | `SHA256(base64(hasło) + LD)` wielkimi literami | |
| `sha256_sha256` | `SHA256(SHA256(hasło) + LD)` wielkimi literami | ✅ **działa na MC888 i MC7010** |
| `b64_plain` | samo `base64(hasło)`, bez `LD` | ✅ **działa na MF79U** (rodzina MF) |
| `md5_plain` | `MD5(hasło + LD)` | |

Potwierdzone empirycznie 2026-08-06 przez `ubus call zte-modem probe`. Warto zauważyć, że
**hasło nie jest kodowane base64** — mimo że to najczęściej opisywany w sieci wariant dla ZTE.

Gdy zapamiętany wariant przestanie działać (np. zmiana hasła), backend automatycznie
przechodzi przez pozostałe. Ręczna diagnostyka: `ubus call zte-modem probe`.

## ⚠️ Sesje na modemie

CPE ZTE dopuszczają zwykle **jedną sesję administratora naraz**. Logowanie przy każdym
odpytaniu wyrzucałoby użytkownika z panelu modemu co kilka sekund. Dlatego backend:

- **reużywa cookie** z `/tmp/zte-modem.cookie`; loguje się dopiero gdy modem przestanie
  zwracać pola wymagające sesji (patrz ostrzeżenie o `loginfo` wyżej),
- **cache'uje odpowiedź** w `/tmp/zte-modem.json` — N otwartych kart LuCI to nadal
  **jedno** zapytanie do modemu na `refresh_interval`,
- **serializuje** równoległe wywołania przez `flock` na `/tmp/zte-modem.lock`,
- **degraduje się łagodnie**: brak sesji → pokazuje pola dostępne bez logowania plus
  czytelny komunikat; modem nieosiągalny → ostatnie znane dane oznaczone jako `_stale`.

## Diagnostyka

```sh
ubus call zte-modem status     # pełny JSON (z cache, jeśli świeży)
ubus call zte-modem probe      # wymusza logowanie, mówi który wariant zadziałał
rm -f /tmp/zte-modem.json      # wymuszenie odświeżenia
logread | grep rpcd            # gdy obiekt ubus się nie rejestruje
```

Pola `_*` w odpowiedzi to metadane modułu, nie modemu: `_host`, `_timestamp`,
`_authenticated`, `_stale`, `_variant`, `_error`.

## Dlaczego poprzednie podejście nie działało

Wcześniejsza próba (Lua/CBI, luty 2026, backup na R2 w `/root/zte-stare-20260806/`)
miała pięć niezależnych błędów:

1. `router_ip = '192.168.0.1'` — wskazywał na **sam router**, nie na modem
2. `MD5(hasło + LD)` — `LD` ma 64 znaki hex, czyli algorytm jest oparty o SHA256
3. `require("socket.http")` — `luasocket` nie jest zainstalowany
4. `Map`/CBI wymaga `luci-compat` — nie ma go na R2
5. brak pliku ACL w `/usr/share/rpcd/acl.d/`

## Powiązane

`wdrozenie-roaming-wifi-r2.md` — opis lokalizacji R2, AP Controller i topologii.

## Agregacja nośnych (CA)

`lte_ca_scell_band` / `_bandwidth` pokazuje **tylko pierwszą** nośną dodatkową, a
`lte_ca_pcell_arfcn` bywa zawsze puste. Pełna agregacja siedzi w
**`lte_multi_ca_scell_info`**, a EARFCN nośnej głównej w **`lte_ca_pcell_freq`**:

```
lte_multi_ca_scell_info = "1,334,2,7,3025,15.0;2,212,2,8,3764,5.0"
                           │  │  │ │  │    └ szerokość [MHz]
                           │  │  │ │  └────── EARFCN
                           │  │  │ └───────── pasmo
                           │  │  └─────────── ? (2 na MC888, 1 na MC7010)
                           │  └────────────── PCI (dziesiętnie!)
                           └───────────────── indeks nośnej
```

Układ nie jest zgadnięty: dla MC888 pierwsza nośna dodatkowa ma PCI 334 i EARFCN 3025,
a btsearch ma dla tej samej stacji komórkę dokładnie z `pci=334, earfcn=3025`. Zgadzają
się też zakresy EARFCN z numerami pasm (1348 → B3 1200–1949; 3050 → B7 2750–3449).
Rozbiór zweryfikowany wobec panelu MC7010, który pokazuje
`10.0MHz@800(B20) + 20.0MHz@1800(B3) + 20.0MHz@2600(B7)`.

⚠️ **Niespójność do zapamiętania:** `lte_pci` (nośna główna) jest **szesnastkowe**,
ale PCI wewnątrz `lte_multi_ca_scell_info` jest **dziesiętne**.

## Kodowanie identyfikatorów — per POLE, nie per urządzenie

To najbardziej zdradliwa część tego API. Nie ma pola, które ogłaszałoby system liczbowy.

**`cell_id` jest szesnastkowy na wszystkich sprawdzonych modelach.** Dowód dla MF79U,
który wygląda na dziesiętny: dwie kolejne próbki `0f2a16` i `0f2a1c` po odczytaniu jako
hex dają **ten sam eNodeB** (`993814 >> 8 == 993820 >> 8 == 3882`) przy różnych
sektorach (22 i 28), a ECI 993814 trafia w btsearch (ABC1234, Miasto).
Jako liczby dziesiętne nie miałyby żadnego związku — a `0f2a1c` nie jest nawet liczbą.

**Ale `lte_pci` już nie.** MF79U podaje `205`, co jako hex daje 517 — poza zakresem PCI
(0–503). Backend rozstrzyga to w `_pci_base` i ogłasza wynik widokowi:

| krok | reguła |
|---|---|
| 1 | jest litera `a-f` → **hex** |
| 2 | jako hex > 503 → to nie może być PCI → **dec** |
| 3 | `model_name` zaczyna się od `MF` → **dec** |
| 4 | inaczej → **hex** (zgodnie z serią MC) |

Krok 3 jest potrzebny, bo dla wartości typu `100` — bez liter i w zakresie obu
interpretacji — sam łańcuch nie rozstrzyga.

### eNodeB liczymy sami

`enodeb_id` **nie jest wiarygodne**: MF79U wstawia tam kopię `cell_id`, więc numer
komórki udawałby numer stacji. Widok liczy `eNB = ECI >> 8`, `sektor = ECI & 0xff` —
na MC888/MC7010 wynik zgadza się z tym, co modem podaje sam (`0x21ab417 >> 8 = 0x21ab4`).

### `wan_active_band` potrafi kłamać

MF79U raportuje `LTE BAND 1` zarówno przy EARFCN 1875 (to B3), jak i 9460 (to B28) —
a zakres B1 to 0–599, więc żadna z tych wartości nie jest B1. Dlatego pasmo nośnej
głównej wyznaczamy w kolejności: `lte_ca_pcell_band` → `lte_band` → **wyliczenie
z EARFCN** (tablica `EARFCN_BANDS` wg 3GPP TS 36.101) → dopiero na końcu
`wan_active_band`. EARFCN jest indeksem fizycznej częstotliwości, więc rozstrzyga.

### Nośna główna bez agregacji

Wiersz PCell nie może zależeć wyłącznie od `lte_ca_*` — te pola opisują agregację
i potrafią być puste, gdy jej nie ma. Dlatego widok schodzi po zapasach:

| co | kolejność źródeł |
|---|---|
| pasmo | `lte_ca_pcell_band` → `lte_band` → liczba z `wan_active_band` (`"LTE BAND 7"`) |
| szerokość | `lte_ca_pcell_bandwidth` (`"15.0"`) → liczba z `bandwidth` (`"15MHz"`) |
| EARFCN | `lte_ca_pcell_freq` → `wan_active_channel` → `lte_ca_pcell_arfcn` |

**`bandwidth` nie jest uniwersalne** — MC888 je wypełnia (`"15MHz"`), MC7010 zwraca
puste. Jeśli więc modem nie poda szerokości żadnym kanałem, tabela nośnych i tak się
renderuje (kolumna „Szerokość" = `–`), a zamiast sufitu pojawia się nota o tym, że
nie da się go policzyć. Wcześniej znikała cała sekcja, co wyglądało na usterkę modułu.

## Różnice między modelami

Zakres pól zależy od firmware'u, nie od zasięgu. Sprawdzone na żywo:

| pole | MC888 | MC7010 |
|---|---|---|
| `Z5g_rsrp`, `Z5g_SINR` | ✓ | ✓ |
| `Z5g_rsrq` | ✓ (`-11`) | **zawsze puste** |
| `bandwidth` | ✓ (`"15MHz"`) | **zawsze puste** |

MC7010 **nie raportuje RSRQ dla 5G NR** — i nie chodzi o inną nazwę pola:
`nr5g_rsrq`, `Z5g_RSRQ` i `nr_rsrq` też są puste, a w teście obciążeniowym
`Z5g_rsrp` i `Z5g_SINR` były wypełnione w 53/53 próbkach przy `Z5g_rsrq` w 0/53.

Dlatego `metric()` zwraca `null` dla pustej wartości, a `block()` odfiltrowuje takie
kafelki. Metryka, której model nie zna, po prostu nie istnieje na stronie — zamiast
pustego paska „brak danych", który sugerował awarię łącza. Nie ma tu żadnej listy
modeli: sterują tym same dane.
