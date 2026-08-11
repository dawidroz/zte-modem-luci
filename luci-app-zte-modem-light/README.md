# luci-app-zte-modem-light

Widok LuCI pokazujący na żywo parametry modemu ZTE stanowiącego łącze WAN routera.
Backend dostarcza pakiet [`zte-modem-core`](../zte-modem-core/) — ten pakiet to **sam
interfejs**.

> **Tylko odczyt, zero zapisu do pamięci trwałej.** To jest niezmiennik tego pakietu,
> a nie lista funkcji: wszystko, co wymagałoby pisania po flashu — liczniki transferu,
> statystyki, **trwała** historia sygnału — należy do
> [`luci-app-zte-modem`](../luci-app-zte-modem/). Wykresy na zakładce niżej mieszczą się
> tutaj, bo ich bufor żyje w pamięci przeglądarki i na routerze nie zostaje po nich ślad.

| zakładka | zawartość |
|---|---|
| **Status** | zużycie limitu danych, RSRP/RSRQ/RSSI/SNR dla LTE i 5G NR, tabela nośnych z agregacją, łączna szerokość, sufit teoretyczny, komórki sąsiednie, identyfikacja stacji bazowej |
| **Wykresy** | te same metryki w czasie, osobno LTE i 5G NR — w ramach sesji przeglądarki |
| **Modem** | model, firmware, IMEI, karta SIM (ICCID, IMSI, PLMN), APN, adresy WAN |
| **Konfiguracja** | adres modemu, hasło, interwał, test logowania |

> Zakładka **Transfer** (licznik miesięczny i sesji, prędkość chwilowa skalowana sufitem
> teoretycznym) została stąd usunięta — trafi do wersji pełnej. Kod jest w historii gita,
> w commicie `fbde1c1`; backend nadal pobiera `monthly_*` i `realtime_*`, bo
> [`zte-modem-core`](../zte-modem-core/) jest wspólny dla obu wersji.

Zakładki idą w kolejności **Status → Wykresy → Modem → Konfiguracja**: wykres to ta sama
rzecz, co paski wyżej, tylko w czasie, więc stoi obok nich, a nie za tożsamością modemu.

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
`ui.tabs.initTabGroup()` sklei je w jedną zakładkę. Status i Modem to własne podklasy
`form.NamedSection` z nadpisanym `render()`; konfiguracja siedzi w zwykłej sekcji
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

## Zużycie limitu danych

Sekcja nad blokiem LTE, ta sama informacja, którą modem pokazuje we własnym panelu:
*Użyto: X / Y*, pasek, *Do wykorzystania: Z*. Sens jest w tym, że **nie trzeba po nią
wchodzić do panelu modemu** — a wejście tam zabrałoby modułowi jedyną sesję admina, którą
modem dopuszcza.

Limit czyta się z modemu, nie z konfiguracji: `data_volume_limit_switch`,
`data_volume_limit_size` (kodowanie `<liczba>_<jednostka w MB>`, patrz
[`docs/kodowanie-pol.md`](../docs/kodowanie-pol.md#data_volume_limit_size--rozmiar-limitu)),
`data_volume_limit_unit` i `data_volume_alert_percent`. Zużycie to suma
`monthly_rx_bytes + monthly_tx_bytes` — modem nie podaje go osobnym polem.

**Sekcja znika w całości**, gdy limit jest wyłączony albo dotyczy czasu połączenia
(`unit = time`). To nie jest oszczędność miejsca: przy limicie czasowym pasek zużycia
danych kłamałby o tym, co modem naprawdę pilnuje, a bez limitu zostałby sam licznik
miesięczny — czyli zakładka Transfer, która należy do wersji pełnej.

Dwie decyzje warte odnotowania:

- **Próg ostrzeżenia bierzemy z modemu** (`data_volume_alert_percent`), zamiast wymyślać
  własne stopnie. Poniżej progu pasek jest zielony, od progu czerwony; gdy próg jest
  niższy niż 100%, staje na pasku kreska — inaczej liczba „ostrzeżenie przy 80%" nie
  byłaby nigdzie widoczna.
- **Wypełnienie przycinamy do 100%, procent nie.** Pasek zatrzymany na końcu bez liczby
  wygląda jak limit wyczerpany co do bajta; etykieta mówi `120,0%`, a prawy podpis zamienia
  się w *Przekroczono o …*.

## Wykresy — historia w ramach sesji

Bufor (`HISTORY`, `MAX_SAMPLES = 720`, czyli ~2 godz. przy interwale 10 s) żyje
**wyłącznie w pamięci przeglądarki** — bez `localStorage`, bez czegokolwiek na routerze.
Stoi w zasięgu **modułu**, nie w `render()`, więc LuCI nie ładuje go drugi raz i przejście
na inną stronę panelu historii nie gubi; `F5` — owszem, gubi. Tyle znaczy tu „sesja".

Cztery rzeczy warte zapamiętania, bo każda wzięła się z konkretnej pułapki:

**Próbka to odczyt modemu, nie tik pollera.** Core oddaje cache, dopóki jest młodszy niż
`refresh_interval` (`show_status` w `rpcd/zte-modem`), a przy `_stale` wprost ostatnie
znane dane — w obu wypadkach `_timestamp` się nie zmienia. Bez odsiewania po nim wykres
rysowałby odcinek z powtórzonej wartości i **udawał, że modem odpowiada**.

**Oś pozioma idzie po czasie, nie po numerze próbki.** Odczyty gubią się na dwa sposoby:
modem nie odpowiada albo LuCI wstrzymuje poller, gdy karta przeglądarki jest niewidoczna.
Przy skali po indeksie obie przerwy zniknęłyby, ściskając wykres i udając ciągłość
pomiaru. Przerwa dłuższa niż `3 × interwał` **rozrywa linię**.

**Skala pionowa to `TIERS`** — te same progi, co paski wyżej, więc pasy tła czytają się
jak kolor paska i nie trzeba uczyć się drugiej skali. Konsekwencja: wartości spoza zakresu
są przycinane do krawędzi, dokładnie jak długość paska w `quality()`.

**SVG powstaje przez `document.createElementNS()`** (helper `S()`), bo `E()` z LuCI woła
`createElement` — `<svg>` wyszedłby jako `HTMLUnknownElement` i nic by się nie narysowało.
Linia jest rysowana `currentColor`, więc dziedziczy kolor tekstu motywu i jest czytelna
tak samo w jasnym, jak i ciemnym; kolor stopnia idzie na kropkę bieżącej wartości, a nazwa
stopnia stoi obok słowem — jak w tabeli sąsiadów.

Krycie pasów jest **inne dla każdego motywu** (`BAND_OPACITY`): jedna wartość nie obsługuje
obu, bo to samo kilkanaście procent ginie na białym tle, a na ciemnym zamienia pastel
w błoto — zmieszany z prawie czarnym po prostu ciemnieje. Motyw rozpoznaje `darkTheme()`
po **jasności koloru tekstu**, a nie przez `prefers-color-scheme`: część motywów LuCI ma
własny przełącznik i nie idzie za ustawieniem systemu, więc zapytanie medialne kłamałoby
właśnie tam, gdzie ciemny wybrano świadomie.

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

## Testy

```sh
node tests/status.test.js       # z katalogu głównego repozytorium
```

Bez zależności poza samym `node` — [`tests/harness.js`](../tests/harness.js) podstawia
atrapę DOM i `E()` z LuCI, a widok ładuje odcinając końcowe `return view.extend(...)`.
`node` jest potrzebny na maszynie dewelopera, **nie** na routerze.

Pokrycie dotyczy zakładki Wykresy i różnic między modelami z
[`docs/modele.md`](../docs/modele.md): odsiewanie powtórzonego odczytu, RSSI bez znaku
na MF297D, 5G bez RSRQ na MC7010, geometria linii, przycięcie do skali, rozrywanie linii
na przerwie, modem nieosiągalny.

## Dlaczego poprzednie podejście nie działało

Wcześniejsza próba w Lua/CBI miała pięć niezależnych błędów — warte odnotowania, bo
każdy z nich jest łatwy do powtórzenia:

1. adres modemu ustawiony na **sam router**, nie na modem
2. `MD5(hasło + LD)` — a `LD` ma 64 znaki hex, czyli algorytm jest oparty o SHA256
3. `require("socket.http")` — `luasocket` nie jest zainstalowany
4. `Map`/CBI wymaga `luci-compat` — nie ma go na LuCI 24.10
5. brak pliku ACL w `/usr/share/rpcd/acl.d/`
