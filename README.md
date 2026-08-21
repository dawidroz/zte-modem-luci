# zte — monitoring modemów ZTE w LuCI

Pakiety dla OpenWrt, które czytają parametry modemu ZTE **po HTTP** — bez `comgt`/AT,
bez `/dev/ttyUSB*`. Dla modemów sieciowych (CPE po Ethernecie) stanowiących łącze WAN
routera.

Obsługiwane są **dwa protokoły**, wykrywane automatycznie:

| protokół | modemy | endpoint |
|---|---|---|
| [`goform`](docs/goform-api.md) | MC888, MC7010, MF79U, MF297D | `/goform/goform_get_cmd_process` |
| [`ubus`](docs/ubus-api.md) | MC7510 (Orange PL: **G51F**) | `/ubus/` (JSON-RPC) |

MC7510 nie ma API `goform` w ogóle — na starym endpoincie oddaje **404**. Jego firmware
stoi na OpenWrt, więc panel rozmawia z nim po ubusie, innymi nazwami pól. Backend
tłumaczy je na nazwy goformowe, dzięki czemu widok, cache i rozpoznawanie stacji bazowej
są dla obu protokołów **te same**.

To dlatego, że `modemdata` / `modemband` / `sms-tool` z feedu eko.one.pl **nie mają tu
zastosowania**: zależą od `comgt`/AT i wymagają `/dev/ttyUSB*` albo `/dev/cdc-wdm*`,
których przy CPE po Ethernecie po prostu nie ma.

## Pakiety

| katalog | rola |
|---|---|
| [`zte-modem-core/`](zte-modem-core/) | **backend** — obiekt ubus `zte-modem`, bez interfejsu |
| [`luci-app-zte-modem-light/`](luci-app-zte-modem-light/) | **widok, wersja light** — 4 zakładki (Status, Wykresy, Modem, Konfiguracja), tylko odczyt, zero zapisu do flasha |
| [`luci-app-zte-modem/`](luci-app-zte-modem/) | **wersja rozbudowana** — transfer i trwała historia sygnału, *planowana* |
| [`docs/`](docs/) | dokumentacja protokołów, wspólna dla obu wersji |
| [`tests/`](tests/) | testy widoku w `node` i testy mappera w `ucode`, bez zależności z npm |

Widoki dzielą całą logikę odczytu, dlatego backend jest osobnym pakietem — a nie
kopiowany. Obie wersje używają tych samych identyfikatorów runtime
(`/etc/config/zte-modem`, ubus `zte-modem`, menu `admin/services/zte-modem`), więc
**nie instaluje się ich obok siebie**; sufiks `-light` dotyczy tylko nazwy pakietu.

## Instalacja

```sh
./scripts/deploy.sh                          # core + light, root@192.168.0.1
./scripts/deploy.sh root@10.0.0.1            # inny cel
./scripts/deploy.sh --pkg zte-modem-core     # tylko wybrany pakiet
./scripts/deploy.sh --dry-run                # podglad bez zmian
```

Skrypt jest idempotentny i **nie nadpisuje istniejącego `/etc/config/zte-modem`**, bo
trzymane jest tam hasło do modemu. Po wgraniu restartuje `rpcd` i sprawdza, czy obiekt
ubus się zarejestrował. Hasła nie ma w repozytorium — plik w `files/` ma pustą wartość,
ustawia się je w LuCI (**Services → Modem ZTE → Konfiguracja**).

Zakres modułów to **tylko odczyt**: żadnego restartu, SMS-ów ani blokowania pasm. Dzięki
temu niepotrzebny jest nagłówek `AD` i nie da się przez pomyłkę odciąć routera od sieci.

## Testy

```sh
node tests/status.test.js                        # widok: wykresy, limit transferu
node tests/mc7510.test.js                        # widok: tabela nośnych, MC7510
sh   tests/ubus-map.test.sh --ssh root@<router>  # mapper ubus -> goform
```

Test mappera potrzebuje `ucode` i `jsonfilter`, więc na maszynie deweloperskiej odpala
się go na routerze przez `--ssh`. Próbki we wszystkich trzech plikach są zdjęte z żywych
urządzeń.

## Instalujesz u siebie?

Zacznij od [`docs/instalacja-i-diagnostyka.md`](docs/instalacja-i-diagnostyka.md) —
wymagania, kolejność instalacji, pięć najczęstszych przyczyn „nie działa" (cztery z nich
to nie usterka modułu) oraz `scripts/diag.sh`, który zbiera komplet danych do zgłoszenia
z **zredagowanym** IMEI, ICCID, Cell ID i hasłem.

## Pakiety instalacyjne

```sh
./scripts/build-pkg.sh                       # .ipk + .apk, oba pakiety -> build/
./scripts/build-pkg.sh --format ipk          # tylko .ipk
./scripts/build-pkg.sh --pkg zte-modem-core  # tylko wybrany
```

Pakiety są **bezarchitekturowe** — to sam kod w shellu i JS, nic się nie kompiluje, więc
**SDK OpenWrt nie jest potrzebny**. Metadane każdego pakietu leżą w jego pliku `pkginfo`.

⚠️ Każdy format nazywa to inaczej: `.ipk` ma `Architecture: all` (opkg), `.apk` ma
`arch: noarch` (apk-tools). Wpisanie `all` do `.apk` przechodzi przez `apk mkpkg` bez
ostrzeżenia, a wywala się dopiero u instalującego jako `error: uninstallable` — patrz
[`docs/instalacja-i-diagnostyka.md`](docs/instalacja-i-diagnostyka.md#error-uninstallable-przy-apk-add).

| format | dla kogo | czym budowane |
|---|---|---|
| `.ipk` | OpenWrt ≤ 24.10 (opkg) | lokalnie, `tar` + `gzip` |
| `.apk` | OpenWrt z apk | `apk mkpkg` w kontenerze (podman albo docker) |

Instalacja na routerze:

```sh
opkg install zte-modem-core_1.2.0-r1_all.ipk luci-app-zte-modem-light_1.3.0-r1_all.ipk
apk add --allow-untrusted zte-modem-core-1.2.0-r1.apk luci-app-zte-modem-light-1.3.0-r1.apk
```

⚠️ **Podawać oba pakiety naraz** — instalowane osobno, widok nie znajdzie jeszcze
`zte-modem-core` i opkg przerwie z mylącym błędem o niezgodnej architekturze.

⚠️ **`.apk` jest niepodpisany**, stąd `--allow-untrusted`. Podpisywanie ma sens dopiero
przy własnym repozytorium.

⚠️ `/etc/config/zte-modem` trzyma hasło do modemu. W `.ipk` jest zadeklarowany jako
`conffiles`, więc opkg **nie nadpisze** zmienionego pliku przy aktualizacji. Przy
**pierwszej** instalacji na routerze, gdzie plik powstał wcześniej przez `deploy.sh`
(czyli nie należy do żadnego pakietu), zostanie **zastąpiony** — hasło trzeba wtedy
ustawić ponownie.

### Zależności — co się stanie, gdy czegoś zabraknie

Oba formaty deklarują zależności i **oba menedżery ich pilnują**. Sprawdzone doświadczalnie
pakietem testowym z celowo nieistniejącą zależnością:

| | opkg (OpenWrt 24.10.2) | apk (apk-tools 3.0.7) |
|---|---|---|
| instalacja | **odmawia** | **odmawia** |
| kod wyjścia | 255 | 2 |
| pliki na dysku | **żadne** | **żadne** |
| stan pakietu | niezainstalowany | niezainstalowany |

Nic nie ląduje w połowie — to instalacja „wszystko albo nic", nie ma stanu pośredniego.

⚠️ **Komunikat opkg jest mylący.** Przy brakującej zależności wypisuje *trzy* błędy,
a decydujący jest **pierwszy**:

```
* pkg_hash_check_unresolved: cannot find dependency <pakiet> for zte-modem-core   <- prawdziwa przyczyna
* pkg_hash_fetch_best_installation_candidate: ... incompatible with the architectures configured
* opkg_install_cmd: Cannot install package zte-modem-core.
```

Zdanie o **niezgodnej architekturze jest fałszywym tropem** — `arch all` jest obsługiwane
(`opkg print-architecture` pokazuje je z priorytetem 1). To ten sam komunikat, który
pojawia się przy instalowaniu samego widoku bez `zte-modem-core`.

⚠️ **`--force-depends` tego nie obchodzi** — sprawdzone prawdziwą instalacją: opkg
przerywa na etapie rozwiązywania zależności, zanim dojdzie do wymuszania. Jedyne wyjście
to doinstalować brakujący pakiet: `opkg update && opkg install <pakiet>`.

W praktyce nie powinno zaboleć: wszystkie zależności (`curl`, `ucode`, `jshn`,
`jsonfilter`, `rpcd`, `luci-base`) są na standardowym OpenWrt z LuCI — potwierdzone na
obu testowych routerach.

⚠️⚠️ **Czego zależności NIE złapią: pakiet obecny, ale niedziałający.** Udokumentowany
przypadek z tego projektu to `curl` w wersji niedopasowanej do `libcurl4`
(`Error relocating: curl_multi_notify_enable: symbol not found`) — pakiet jest
zainstalowany, zależność spełniona, a binarka nie startuje i moduł nie dostaje żadnych
danych. Dlatego przy diagnostyce **uruchamiać `curl --version`**, a nie sprawdzać samą
obecność pakietu (patrz [`docs/goform-api.md`](docs/goform-api.md#zależności-na-routerze)).

### Co jest sprawdzone, a co nie

✅ `.ipk` — `opkg install` na OpenWrt 24.10.4 w kontenerze (obraz `openwrt/rootfs`), oba
pakiety naraz, zależności dociągnięte z repozytoriów. Wcześniej też `--noaction` na
prawdziwym 24.10.2 (aarch64).

✅ `.apk` — `apk add --allow-untrusted` na **OpenWrt 25.12-SNAPSHOT** (apk-tools 3.0.5)
w kontenerze, oba pakiety naraz, `curl` dociągnięty z repozytorium. Gdyby jakieś apk
odrzuciło format, jest przełącznik `--apk-compat` (np. `--apk-compat 3.0.0_pre3`).

⚠️ To zastrzeżenie stało tu wcześniej z powodem: dopóki `.apk` był sprawdzany **tylko
strukturalnie** (`apk adbdump` czyta metadane, więc „wygląda dobrze"), przez dwa wydania
jechał w nim błąd `arch: all`, przez który **nie dawało się go zainstalować**. Wyszło
dopiero ze zgłoszenia użytkownika. Struktura czytelna dla narzędzia to nie to samo, co
pakiet, który wchodzi.

```sh
# Test instalacji bez routera z apk:
docker run --rm -v "$PWD/build:/pkg:ro" openwrt/rootfs:x86_64-openwrt-25.12 \
  sh -c 'cd /pkg && apk add --allow-untrusted ./zte-modem-core-*.apk ./luci-app-*.apk'
```

⚠️ Obraz docker OpenWrt **nie ma linii `arch` w `/etc/opkg.conf`**, więc test `.ipk` w
kontenerze wymaga ich dopisania — inaczej odbija się od „incompatible with the
architectures configured", czego na prawdziwym routerze nie ma:

```sh
printf 'arch all 100\narch noarch 200\narch x86_64 300\n' >> /etc/opkg.conf
```

## Sprawdzone modemy

| model | logowanie | `cmd=LD` | uwagi |
|---|---|---|---|
| MC888 | `sha256_sha256` | 64 hex | 5G NSA, pełna agregacja |
| MC7010 | `sha256_sha256` | 64 hex | 5G NSA, brak RSRQ dla NR |
| MF297D | `sha256_sha256` | 64 hex | LTE, mimo „MF" w nazwie loguje się jak seria MC |
| MF79U | `b64_plain` | **puste** | LTE, dongle USB, brak wyzwania |

⚠️ **Nazwa modelu nie wyznacza rodziny.** Reguły opierać na zachowaniu, nie na prefiksie.

Testowane na OpenWrt 24.10.2 (MikroTik RB5009, Cudy WR3000S, Zyxel), z modemem jako
bramą domyślną routera.

## Dokumentacja

| dokument | zawartość |
|---|---|
| [`docs/goform-api.md`](docs/goform-api.md) | endpointy, warianty logowania, wykrywanie sesji, zależności |
| [`docs/modele.md`](docs/modele.md) | profile pól per model, tożsamość i SIM, agregacja nośnych |
| [`docs/kodowanie-pol.md`](docs/kodowanie-pol.md) | hex vs. dec per pole, eNodeB, pasmo z EARFCN |
| [`docs/btsearch.md`](docs/btsearch.md) | rozpoznawanie stacji bazowej, cache, wyłącznik |
| [`docs/instalacja-i-diagnostyka.md`](docs/instalacja-i-diagnostyka.md) | **dla instalującego u siebie** — wymagania, pięć rzeczy do sprawdzenia, co podesłać przy zgłoszeniu |
| [`docs/pulapki.md`](docs/pulapki.md) | skrót wszystkich pułapek z odnośnikami |

Jeśli zamierzasz dodać obsługę kolejnego modelu — zacznij od
[`docs/pulapki.md`](docs/pulapki.md) i procedury profilowania na końcu
[`docs/modele.md`](docs/modele.md).

## Uwaga o danych

Identyfikatory komórek i stacji w dokumentacji są **zanonimizowane**, ale wewnętrznie
spójne — arytmetyka `ECI >> 8` i test zakresu 28 bitów zgadzają się i można na nich
sprawdzić implementację.

Moduł domyślnie wysyła Cell ID do btsearch.pl w celu rozpoznania masztu. Wyłącznik:
`uci set zte-modem.main.bts_lookup='0'`.
