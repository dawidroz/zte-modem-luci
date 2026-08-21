# zte-modem-core

Backend odczytu modemów ZTE. Pakiet **bez interfejsu** — rejestruje obiekt ubus
`zte-modem`, z którego korzystają widoki LuCI w tym repozytorium.

Rozmawia **dwoma protokołami**, wykrywanymi automatycznie po tym, który endpoint
odpowiada: [`goform`](../docs/goform-api.md) (MC888, MC7010, MF79U, MF297D) albo
[`ubus`](../docs/ubus-api.md) JSON-RPC (MC7510). Nazwy pól różnią się między nimi
całkowicie, więc odpowiedzi ubusa przechodzą przez mapper, który tłumaczy je na nazwy
goformowe — **na zewnątrz backend wygląda tak samo niezależnie od modemu**.

```
files/etc/config/zte-modem                          UCI: host, hasło, interwał
files/usr/libexec/rpcd/zte-modem                    backend, obiekt ubus zte-modem
files/usr/share/zte-modem/ubus-map.uc               mapper nazw pól ubus -> goform
files/usr/share/rpcd/acl.d/luci-app-zte-modem.json  ACL
```

Wydzielony osobno z dwóch powodów: widoki dzielą **całą** logikę odczytu (protokoły,
warianty logowania, sonda hasha, dekodowanie pól, cache, btsearch), a dwa pakiety
shipujące ten sam plik `/usr/libexec/rpcd/zte-modem` powodowałyby konflikt plików
w `opkg`.

> **Core jest read-only** — nie zapisuje niczego do pamięci trwałej poza zapamiętaniem
> wykrytego protokołu i wariantu hasha w UCI. To niezmiennik: historia sygnału i statystyki należą
> do własnego kolektora w pakiecie, który ich potrzebuje.

## Metody ubus

```sh
ubus call zte-modem status     # pełny odczyt (z cache, jeśli świeży)
ubus call zte-modem probe      # rozpoznaje protokół, wymusza logowanie, mówi co zadziałało
```

Pola `_*` w odpowiedzi to metadane modułu, nie modemu: `_host`, `_timestamp`,
`_authenticated`, `_stale`, `_variant`, `_protocol`, `_pci_base`, `_cell_base`, `_error`.

Na modemach ubusowych dochodzi `_scell_sig` — poziom sygnału na nośną dodatkową,
składany przez backend z pola `ltecasig`. Modemy goformowe nie podają go w ogóle.

## Konfiguracja

`/etc/config/zte-modem`, sekcja `config zte-modem 'main'`:

| opcja | domyślnie | znaczenie |
|---|---|---|
| `host` | `192.168.32.1` | **adres modemu**, nie routera |
| `password` | puste | hasło admina modemu; uzupełniane w LuCI, nie trafia do repozytorium |
| `refresh_interval` | `10` | co ile sekund odpytywać modem (5–300) |
| `timeout` | `6` | timeout pojedynczego zapytania HTTP |
| `hash_variant` | puste | wykrywany automatycznie, nie ustawiać ręcznie |
| `protocol` | puste | `goform` albo `ubus`; wykrywany automatycznie, odświeżany przyciskiem „Sprawdź logowanie" |
| `bts_lookup` | `1` | rozpoznawanie stacji przez btsearch.pl; `0` = Cell ID nie opuszcza sieci lokalnej |

`refresh_interval` chroni też modem przed zalewaniem, gdy otwartych jest kilka kart LuCI
naraz — wszystkie czytają z jednego cache.

## Pliki robocze

Wszystko w tmpfs, nic nie ląduje we flashu:

```
/tmp/zte-modem.json          cache odpowiedzi
/tmp/zte-modem.cookie        cookie sesji (goform)
/tmp/zte-modem.stok          token ubus_rpc_session (ubus), tryb 0600
/tmp/zte-modem.lock          flock, serializacja rownoleglych wywolan
/tmp/zte-modem.bts.*.json    cache btsearch, 20 ostatnich komorek
```

## Dokumentacja protokołu

- [`docs/goform-api.md`](../docs/goform-api.md) — endpointy, logowanie, sesje (MC888, MC7010, MF79U, MF297D)
- [`docs/ubus-api.md`](../docs/ubus-api.md) — protokół ubus, mapowanie nazw pól (MC7510)
- [`docs/modele.md`](../docs/modele.md) — profile pól per model
- [`docs/kodowanie-pol.md`](../docs/kodowanie-pol.md) — hex/dec, heurystyki
- [`docs/btsearch.md`](../docs/btsearch.md) — rozpoznawanie stacji bazowej
- [`docs/pulapki.md`](../docs/pulapki.md) — skrót pułapek
