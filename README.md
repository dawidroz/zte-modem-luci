# zte — monitoring modemów ZTE w LuCI

Pakiety dla OpenWrt, które czytają parametry modemu ZTE **po HTTP przez API `goform`** —
bez `comgt`/AT, bez `/dev/ttyUSB*`. Dla modemów sieciowych (CPE po Ethernecie)
stanowiących łącze WAN routera.

To dlatego, że `modemdata` / `modemband` / `sms-tool` z feedu eko.one.pl **nie mają tu
zastosowania**: zależą od `comgt`/AT i wymagają `/dev/ttyUSB*` albo `/dev/cdc-wdm*`,
których przy CPE po Ethernecie po prostu nie ma.

## Pakiety

| katalog | rola |
|---|---|
| [`zte-modem-core/`](zte-modem-core/) | **backend** — obiekt ubus `zte-modem`, bez interfejsu |
| [`luci-app-zte-modem-light/`](luci-app-zte-modem-light/) | **widok, wersja light** — 4 zakładki, tylko odczyt, zero zapisu do flasha |
| [`luci-app-zte-modem/`](luci-app-zte-modem/) | **wersja rozbudowana** — historia sygnału i wykresy, *planowana* |
| [`docs/`](docs/) | dokumentacja protokołu, wspólna dla obu wersji |

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
