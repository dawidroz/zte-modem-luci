# luci-app-zte-modem-light

Widok LuCI pokazujący na żywo parametry modemu ZTE stanowiącego łącze WAN routera.
Backend dostarcza pakiet [`zte-modem-core`](../zte-modem-core/) — ten pakiet to **sam
interfejs**.

> **Zakres jest zamknięty.** Cztery zakładki, tylko odczyt, **zero zapisu do pamięci
> trwałej**. Statystyki, historia sygnału i wykresy należą do
> [`luci-app-zte-modem`](../luci-app-zte-modem/) — tutaj świadomie ich nie ma, żeby nie
> wciągać modułu w zapis do flasha.

| zakładka | zawartość |
|---|---|
| **Status** | RSRP/RSRQ/RSSI/SNR dla LTE i 5G NR, tabela nośnych z agregacją, łączna szerokość, sufit teoretyczny, identyfikacja stacji bazowej |
| **Transfer** | licznik miesięczny i bieżącego połączenia z podziałem pobrane/wysłane, prędkość chwilowa skalowana sufitem teoretycznym |
| **Modem** | model, firmware, IMEI, karta SIM (ICCID, IMSI, PLMN), APN, adresy WAN |
| **Konfiguracja** | adres modemu, hasło, interwał, test logowania |

Instalacja i wymagania — patrz [README repozytorium](../README.md).
Hasło ustawia się w LuCI: **Services → Modem ZTE → Konfiguracja**.

## Architektura widoku

Wzorzec jak `luci-app-apcontroller`: widok w JS + backend w `rpcd`. Świadomie **nie**
Lua/CBI — w LuCI 24.10 wymagałoby to `luci-compat`, którego na docelowych routerach nie ma.

```
files/usr/share/luci/menu.d/luci-app-zte-modem.json       wpis menu (admin/services)
files/www/luci-static/resources/view/zte-modem/status.js  widok, wszystkie zakładki
```

Zakładki robi wbudowany mechanizm `form.Map` (`m.tabbed = true`), tak samo jak
apcontroller. Przy `m.tabbed` **każda sekcja mapy staje się osobną zakładką**: `data-tab`
bierze się z `sectiontype`, a etykieta z `title` sekcji.

⚠️ Stąd wymóg: **każda sekcja musi mieć inny `sectiontype`**, inaczej
`ui.tabs.initTabGroup()` sklei je w jedną zakładkę. Status, Transfer i Modem to własne
podklasy `form.NamedSection` z nadpisanym `render()`; konfiguracja siedzi w zwykłej sekcji
(sectiontype `zte-modem`).

## Prezentacja sygnału

Czterostopniowa skala z **nazwanym poziomem** — Doskonały / Dobry / Średni / Skraj
komórki — zamiast samego koloru.

| | Doskonały | Dobry | Średni | Skraj komórki |
|---|---|---|---|---|
| RSRP [dBm] | ≥ −80 | −90…−81 | −100…−91 | < −100 |
| RSRQ [dB] | ≥ −10 | −15…−11 | −20…−16 | < −20 |
| SINR [dB] | ≥ 20 | 13…19 | 1…12 | ≤ 0 |
| RSSI [dBm] | ≥ −65 | −75…−66 | −85…−76 | < −85 |

Pomysł zapożyczony z
[luci-app-3ginfo-lite](https://github.com/4IceG/luci-app-3ginfo-lite), implementacja
własna, bo tam progi **zachodzą na siebie** (dla RSRQ warunki `>= -10` oraz
`>= -15 && <= -9` łapią jednocześnie −10 i −9, wygrywa ostatni sprawdzony), a wyliczanie
długości paska potrafi przekroczyć 100% i jest łatane hackiem `width:33%` na kontenerze.

Tutaj `TIERS[*].steps` jest uporządkowane malejąco i wygrywa **pierwszy** pasujący próg,
więc przedziały są rozłączne z definicji.

Pasek to natywny **`.cbi-progressbar`** z LuCI, nie własne div-y — dziedziczy wygląd
z motywu. Warto wiedzieć, że motyw renderuje atrybut `title` jako etykietę **nad** paskiem
(`.cbi-progressbar::before { content: attr(title) }`), więc wartość i ocena jakości
trafiają właśnie tam, zamiast do osobnego elementu.

## Metryka, której model nie zna, nie istnieje

`metric()` zwraca `null` dla pustej wartości, a `block()` odfiltrowuje takie kafelki —
zamiast pustego paska „brak danych", który sugerował awarię łącza. Nie ma tu żadnej listy
modeli: sterują tym same dane. Które pola bywają puste na którym modemie:
[`docs/modele.md`](../docs/modele.md).

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

Wcześniejsza próba w Lua/CBI miała pięć niezależnych błędów — warte odnotowania, bo
każdy z nich jest łatwy do powtórzenia:

1. adres modemu ustawiony na **sam router**, nie na modem
2. `MD5(hasło + LD)` — a `LD` ma 64 znaki hex, czyli algorytm jest oparty o SHA256
3. `require("socket.http")` — `luasocket` nie jest zainstalowany
4. `Map`/CBI wymaga `luci-compat` — nie ma go na LuCI 24.10
5. brak pliku ACL w `/usr/share/rpcd/acl.d/`
