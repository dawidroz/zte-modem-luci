# Profile modeli

Zakres pól zależy od **firmware'u**, nie od zasięgu ani od klasy urządzenia.
Wszystko poniżej sprawdzone na żywo, na fizycznych egzemplarzach.

## Potwierdzone urządzenia

| model | `model_name` | `wa_inner_version` | `cmd=LD` | wariant logowania |
|---|---|---|---|---|
| MC888 | `MC888` | `BD_STDMC888V1.0.0B04` | 64 hex | `sha256_sha256` |
| MC7010 | `MC7010` | `PLY_PL_MC7010V1.0.0B03` | 64 hex | `sha256_sha256` |
| MF79U | `MF79U` | `BD_MF79UV1.0.0B03` | **puste** | `b64_plain` |
| MF297D | `MF297D` | `BD_TELIASEMF297DMODV1.0.1B03` | 64 hex | `sha256_sha256` |

⚠️⚠️ **Nazwa modelu NIE wyznacza rodziny.** MF297D ma w nazwie „MF", ale zachowuje się
jak seria MC: `cmd=LD` zwraca 64 znaki hex i loguje się `sha256_sha256`. Podział
„MC z wyzwaniem / MF bez wyzwania" jest **fałszywy** — MF79U ≠ MF297D. Wszelkie reguły
„per rodzina" trzeba opierać na **zachowaniu**, nie na prefiksie nazwy.

⚠️ Wbrew częstemu założeniu **rodzina MF też wymaga logowania** dla pól odczytowych.
Na MF79U `SSID1`, `AuthMode`, `LocalDomain` i `iccid` są puste bez cookie. Tryb
„bez logowania" nie jest potrzebny jako osobny wariant.

**`model_name` to wiarygodny klucz rozpoznania modelu** — jest wypełnione na wszystkich
i czyta się bez logowania.

## Metryki radiowe

| pole | MC888 | MC7010 | MF297D | MF79U |
|---|---|---|---|---|
| `lte_rsrp` | ✓ | ✓ | ✓ | ✓ |
| `lte_rsrq` | ✓ | ✓ | **puste** | ✓ |
| `lte_snr` / `lte_rssi` | ✓ | ✓ | **puste** (patrz niżej) | ✓ |
| `lte_pci` | ✓ | ✓ | **puste** | ✓ |
| `Z5g_rsrp`, `Z5g_SINR` | ✓ | ✓ | brak 5G | brak 5G |
| `Z5g_rsrq` | ✓ (`-11`) | **zawsze puste** | brak 5G | brak 5G |
| `bandwidth` | ✓ (`"15MHz"`) | **zawsze puste** | — | — |
| pola CA (`lte_ca_*`) | ✓ | ✓ | częściowo | **brak** |

MC7010 **nie raportuje RSRQ dla 5G NR** — i nie chodzi o inną nazwę pola: `nr5g_rsrq`,
`Z5g_RSRQ` i `nr_rsrq` też są puste. W teście obciążeniowym `Z5g_rsrp` i `Z5g_SINR` były
wypełnione w 53/53 próbkach przy `Z5g_rsrq` w 0/53.

Stąd zasada w widoku: metryka o pustej wartości zwraca `null` i **nie renderuje się
wcale**, zamiast pokazywać pusty pasek „brak danych" sugerujący awarię łącza. Nie ma
w kodzie żadnej listy modeli — sterują tym same dane.

⚠️ **SNR i RSSI mają na MF297D inne nazwy.** `lte_snr` i `lte_rssi` są tam puste, a te
same wielkości siedzą pod `sinr` i `rssi`. Na MC888 jest odwrotnie (`sinr`/`rssi` puste).
Backend pobiera obie pary, widok bierze pierwszą niepustą.

⚠️ **`rssi` na MF297D gubi znak.** W ośmiu kolejnych próbkach wróciło raz `-69`,
a poza tym `67` i `71` — ta sama wielkość, raz ze znakiem, raz bez. RSSI w LTE jest
zawsze ujemne (praktycznie −110…−40 dBm), więc widok normalizuje do `-|v|`. Dla
poprawnie podpisanego `lte_rssi` (`"-73"`) to operacja pusta.

## Liczniki transferu

| pole | znaczenie |
|---|---|
| `monthly_rx_bytes` / `monthly_tx_bytes` | licznik miesięczny, zeruje się wg **cyklu rozliczeniowego modemu** |
| `realtime_rx_bytes` / `realtime_tx_bytes` | bajty bieżącego połączenia, zerują się przy zestawieniu sesji |
| `realtime_rx_thrpt` / `realtime_tx_thrpt` | prędkość chwilowa w **bajtach na sekundę** |
| `realtime_time` | czas trwania bieżącego połączenia [s] |

⚠️ Liczniki są **modemu, nie routera** — nie zgadzają się z ruchem mierzonym na
interfejsie WAN i nie da się ich wyzerować z poziomu modułu (zakres tylko do odczytu).

✅ `realtime_*_bytes` potwierdzone na **MC888** (2026-08-07). Na pozostałych modelach
jeszcze niesprawdzone — widok pomija sekcję „Bieżące połączenie", gdy obie wartości są
puste, więc firmware bez tych liczników degraduje się cicho. Przy okazji profilowania
kolejnego modemu warto uzupełnić tę tabelę.

⚠️ `realtime_*_thrpt` podaje **bajty/s**, a nie bity — widok mnoży przez 8, żeby pokazać
Mb/s porównywalne z sufitem teoretycznym. Zweryfikowane na MC888 (2026-08-07).

⚠️⚠️ **`realtime_*_thrpt` jest chwilowe w oknie rzędu sekundy** i praktycznie
nieskorelowane ze średnią z dłuższego okresu. W pomiarze 13 kolejnych próbek co 10 s
wartość skakała o **pięć rzędów wielkości** (208 → 1 956 423), a stosunek do
rzeczywistego przepływu liczonego z przyrostu `realtime_rx_bytes` wahał się od 25% do
207 000%.

Konsekwencja dla weryfikacji jednostki: **średnia z próbek niczego nie dowodzi** —
zależy wyłącznie od tego, czy trafi się w szczyt ruchu. Rozstrzyga porównanie
**maksimów**: najwyższe zaobserwowane `thrpt` musi być ≥ najwyższej średniej z licznika
bajtów, bo chwilowe szczyty nie mogą być niższe od średniej, którą łącze utrzymało.
Przy interpretacji „bity/s" ten warunek był łamany, przy „bajty/s" spełniony.

Do mierzenia rzeczywistej przepustowości używać **przyrostu `realtime_*_bytes`**,
nie uśredniania `thrpt`.

## Tożsamość urządzenia i karty SIM

| pole | MC888 | MC7010 | MF297D |
|---|---|---|---|
| `hardware_version` | `MC888HWV1.0.0` | `MC7010-1` | `MF297DHW1.0` |
| `web_version` | ✓ | ✓ | **puste** |
| `cr_version` | puste | puste | `MF297D_Nordic1_B16` |
| `iccid` | 19 cyfr | 20 cyfr | 20 znaków, **z końcowym `F`** |
| `imsi` | **puste** | **puste** | ✓ |
| `sim_imsi` | ✓ | ✓ | ✓ |
| `pdp_type` | `IPv6` | `IPv4v6` | `IP` |
| `ipv6_wan_ipaddr` | adres | adres | **`::`** |

Pułapki:

- **IMSI trzeba brać z `sim_imsi`** — `imsi` wypełnia dopiero MF297D.
- **ICCID kończy się `F`** na MF297D (`…080F`). To dopełniający półbajt kodowania BCD,
  nie cyfra numeru — widok ucina pojedyncze końcowe `F`.
- **Wersję panelu podają dwa różne pola:** seria MC ma `web_version`, MF297D `cr_version`.
- **`ipv6_wan_ipaddr` bywa `"::"`** zamiast pustego — wiersz wtedy nie powstaje.
- **`msisdn`, `sim_card_status`, `sim_slot`, `mac_address` są puste na wszystkich** — nie
  ma sensu ich pobierać. Stan karty czytamy z `modem_main_state` (`modem_init_complete`,
  `modem_sim_undetected`, `modem_waiting_pin`…).

Lista `FIELDS` ma ~57 pól i **działa** — sprawdzone przez porównanie liczby niepustych
pól przed i po rozszerzeniu (36→49, 34→47, 24→37; nic nie zniknęło). Warto pamiętać, bo
objaw „nagle mniej danych" pochodzi z **wygasłej sesji**, nie z długości zapytania.

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

Układ nie jest zgadnięty. Zgadzają się zakresy EARFCN z numerami pasm (1348 → B3
1200–1949; 3050 → B7 2750–3449), a rozbiór zweryfikowano wobec panelu MC7010, który
pokazuje `10.0MHz@800(B20) + 20.0MHz@1800(B3) + 20.0MHz@2600(B7)`. Dodatkowo dane
z btsearch dla tej samej stacji zawierają komórkę dokładnie o takim PCI i EARFCN, jak
pierwsza nośna dodatkowa raportowana przez modem.

⚠️ **Niespójność do zapamiętania:** `lte_pci` (nośna główna) jest **szesnastkowe**,
ale PCI wewnątrz `lte_multi_ca_scell_info` jest **dziesiętne**.

⚠️ **`lte_ca_scell_band` = `"0"` przy wyłączonej agregacji.** MF297D zwraca wtedy
`lte_ca_scell_band: "0"` i `lte_ca_scell_bandwidth: "0.0"` — jako łańcuchy są
**prawdziwe**, więc zwykłe `if (st.lte_ca_scell_band)` dorzuca do tabeli widmową nośną
„B0, 0.0 MHz". Trzeba testować wartością liczbową, nie samą obecnością pola.

### Nośna główna bez agregacji

Wiersz PCell nie może zależeć wyłącznie od `lte_ca_*` — te pola opisują agregację
i potrafią być puste, gdy jej nie ma. Dlatego widok schodzi po zapasach:

| co | kolejność źródeł |
|---|---|
| pasmo | `lte_ca_pcell_band` → `lte_band` → liczba z `wan_active_band` (`"LTE BAND 7"`) |
| szerokość | `lte_ca_pcell_bandwidth` (`"15.0"`) → liczba z `bandwidth` (`"15MHz"`) |
| EARFCN | `lte_ca_pcell_freq` → `wan_active_channel` → `lte_ca_pcell_arfcn` |

**`bandwidth` nie jest uniwersalne** — MC888 je wypełnia (`"15MHz"`), MC7010 zwraca puste.
Jeśli modem nie poda szerokości żadnym kanałem, tabela nośnych i tak się renderuje
(kolumna „Szerokość" = `–`), a zamiast sufitu teoretycznego pojawia się nota, że nie da
się go policzyć. Wcześniej znikała cała sekcja, co wyglądało na usterkę modułu.

## Procedura profilowania kolejnego modelu

Dla każdego nowego modemu zebrać po kolei:

1. `cmd=LD` — długość odpowiedzi wskazuje wariant hasha (64 hex / puste),
2. `wa_inner_version` i `model_name`,
3. listę pól czytelnych **bez** logowania,
4. listę pól czytelnych **po** zalogowaniu,
5. próbki `cell_id` i `lte_pci` (do rozstrzygnięcia kodowania — patrz
   [`kodowanie-pol.md`](kodowanie-pol.md)).

Backend ma do tego `ubus call zte-modem probe`. Dodanie kolejnego modelu powinno być
wypełnieniem tabeli, a nie zgadywanką.
