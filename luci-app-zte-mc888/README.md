# luci-app-zte-mc888 — monitoring modemu ZTE MC888 w LuCI

Moduł LuCI pokazujący na żywo parametry sygnału modemu **ZTE MC888**, który stanowi łącze
WAN dla routera R2 (MikroTik RB5009 z OpenWrt 24.10.2, `192.168.0.1`).

**Modem stoi pod `192.168.32.1`** — to brama domyślna R2 na interfejsie `p8`. Jest to
samodzielny CPE po Ethernecie, więc `modemdata`/`modemband`/`sms-tool` z feedu eko.one.pl
**nie mają zastosowania** (zależą od `comgt`/AT i wymagają `/dev/ttyUSB*` albo
`/dev/cdc-wdm*`, których na R2 nie ma). Komunikacja idzie po HTTP przez `goform`.

Zakres: **tylko odczyt**. Żadnego restartu, SMS-ów ani blokowania pasm — dzięki temu
niepotrzebny jest nagłówek `AD` i nie da się przez pomyłkę odciąć od sieci.

## Instalacja

```sh
./deploy.sh                 # domyślnie root@192.168.0.1
./deploy.sh --dry-run       # podgląd bez zmian
./deploy.sh root@10.0.0.1   # inny cel
```

Skrypt jest idempotentny i **nie nadpisuje istniejącego `/etc/config/zte-mc888`** (trzyma
hasło). Po wgraniu restartuje `rpcd` i sprawdza, czy obiekt ubus się zarejestrował.

Hasło ustawia się w LuCI: **Services → Modem ZTE → Konfiguracja**. Do repozytorium
nie trafia — plik w `files/` ma pustą wartość.

## Architektura

Wzorzec jak `luci-app-apcontroller`: widok w JS + backend w `rpcd`. Świadomie **nie**
Lua/CBI — w LuCI 24.10 wymagałoby to `luci-compat`, którego na R2 nie ma.

```
files/etc/config/zte-mc888                                UCI: host, hasło, interwał
files/usr/libexec/rpcd/zte-mc888                          backend, obiekt ubus zte-mc888
files/usr/share/rpcd/acl.d/luci-app-zte-mc888.json        ACL
files/usr/share/luci/menu.d/luci-app-zte-mc888.json       wpis menu (admin/services)
files/www/luci-static/resources/view/zte-mc888/status.js  widok: zakładki Status i Konfiguracja
```

Strona ma trzy zakładki, zrobione wbudowanym mechanizmem `form.Map` (`m.tabbed = true`),
tak samo jak apcontroller. Przy `m.tabbed` **każda sekcja mapy staje się osobną zakładką**:
`data-tab` bierze się z `sectiontype`, a etykieta z `title` sekcji. Stąd wymóg —
**obie sekcje muszą mieć różny `sectiontype`**, inaczej `ui.tabs.initTabGroup()` skleja je
w jedną. Zakładki Status i Transfer to własne podklasy `form.NamedSection` z nadpisanym
`render()` (sectiontype `status` / `transfer`), konfiguracja siedzi w zwykłej sekcji
(sectiontype `zte-mc888`).

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

Backend **cache'uje odpowiedź w tmpfs pod numerem komórki** (`/tmp/zte-mc888.bts.<dec>.json`)
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

> ⚠️ **`cmd=loginfo` NIE służy do sprawdzania sesji.** Wbrew nazwie zwraca
> `{"loginfo":"ok"}` **także bez cookie** — sprawdzone na MC888 i MC7010. Backend opierał
> na nim detekcję sesji i przez to nigdy się nie logował: `_authenticated: true` przy
> kompletnie pustych metrykach. Jedyny wiarygodny test to odczyt pola dostępnego wyłącznie
> po zalogowaniu (`lte_rsrp`, `Z5g_rsrp`, `cell_id`, `wan_ipaddr` — kilku naraz, bo
> pojedyncze bywa puste z innych powodów).

Wszystkie zapytania wymagają nagłówka `Referer: http://<modem>/index.html`.

Potwierdzone na urządzeniu: `wa_inner_version = BD_STDMC888V1.0.0B04`, `cr_version` puste.

**Bez logowania** czytają się: `signalbar`, `network_type`, `network_provider`,
`ppp_status`, `modem_main_state`, `wa_inner_version`, `simcard_roam`.
**Wymagają sesji**: wszystkie metryki sygnału (`lte_*`, `Z5g_*`, `nr5g_*`), `cell_id`,
`wan_ipaddr`, liczniki transferu.

### Warianty hashowania hasła

Firmware ZTE różnią się algorytmem, więc backend próbuje po kolei i **zapamiętuje
działający** w `zte-mc888.main.hash_variant`:

| wariant | wzór | |
|---|---|---|
| `sha256_b64` | `SHA256(base64(hasło) + LD)` wielkimi literami | |
| `sha256_sha256` | `SHA256(SHA256(hasło) + LD)` wielkimi literami | ✅ **ten działa na `BD_STDMC888V1.0.0B04`** |
| `b64_plain` | samo `base64(hasło)` (starsze firmware) | |
| `md5_plain` | `MD5(hasło + LD)` | |

Potwierdzone empirycznie 2026-08-06 przez `ubus call zte-mc888 probe`. Warto zauważyć, że
**hasło nie jest kodowane base64** — mimo że to najczęściej opisywany w sieci wariant dla ZTE.

Gdy zapamiętany wariant przestanie działać (np. zmiana hasła), backend automatycznie
przechodzi przez pozostałe. Ręczna diagnostyka: `ubus call zte-mc888 probe`.

## ⚠️ Sesje na modemie

CPE ZTE dopuszczają zwykle **jedną sesję administratora naraz**. Logowanie przy każdym
odpytaniu wyrzucałoby użytkownika z panelu modemu co kilka sekund. Dlatego backend:

- **reużywa cookie** z `/tmp/zte-mc888.cookie`; loguje się dopiero gdy modem przestanie
  zwracać pola wymagające sesji (patrz ostrzeżenie o `loginfo` wyżej),
- **cache'uje odpowiedź** w `/tmp/zte-mc888.json` — N otwartych kart LuCI to nadal
  **jedno** zapytanie do modemu na `refresh_interval`,
- **serializuje** równoległe wywołania przez `flock` na `/tmp/zte-mc888.lock`,
- **degraduje się łagodnie**: brak sesji → pokazuje pola dostępne bez logowania plus
  czytelny komunikat; modem nieosiągalny → ostatnie znane dane oznaczone jako `_stale`.

## Diagnostyka

```sh
ubus call zte-mc888 status     # pełny JSON (z cache, jeśli świeży)
ubus call zte-mc888 probe      # wymusza logowanie, mówi który wariant zadziałał
rm -f /tmp/zte-mc888.json      # wymuszenie odświeżenia
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
