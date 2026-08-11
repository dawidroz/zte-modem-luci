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
| RSRP/RSRQ **per nośna dodatkowa** | **brak** | **brak** | — | — |
| `lte_rsrq` | ✓ | ✓ | **puste** | ✓ |
| `lte_snr` / `lte_rssi` | ✓ | ✓ | **puste** (patrz niżej) | ✓ |
| `lte_pci` | ✓ | ✓ | **puste** | ✓ |
| `Z5g_rsrp`, `Z5g_SINR` | ✓ | ✓ | brak 5G | brak 5G |
| `Z5g_rsrq` | ✓ (`-11`) | **zawsze puste** | brak 5G | brak 5G |
| `bandwidth` | ✓ (`"15MHz"`) | **zawsze puste** | — | — |
| pola CA (`lte_ca_*`) | ✓ | ✓ | częściowo | **brak** |

**Poziomu sygnału per nośna dodatkowa API nie podaje w ogóle.** Odpytane i puste na MC888
i MC7010: `lte_multi_ca_scell_sig_info`, `lte_ca_scell_rsrp`, `lte_ca_scell_rsrq`,
`lte_scell_rsrp`, `scell_rsrp`, `lte_multi_ca_scell_signal_info`. Samo
`lte_multi_ca_scell_info` ma sześć pól i **żadne nie jest poziomem**. Stąd tabela nośnych
nie ma kolumn RSRP/RSRQ — byłyby wypełnione wyłącznie w wierszu PCell, powtarzając kafelki
stojące bezpośrednio nad tabelą.

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

> ℹ️ Pola są **pobierane przez core**, a wersja light pokazuje z nich tylko **zużycie
> limitu** (sekcja nad LTE na zakładce Status). Rozbicie rx/tx, prędkość chwilowa
> i liczniki bieżącej sesji to zakładka Transfer, czyli
> [wersja pełna](../luci-app-zte-modem/README.md). Ustalenia poniżej dotyczą samych pól
> i zostają w mocy dla obu wersji.

| pole | znaczenie |
|---|---|
| `monthly_rx_bytes` / `monthly_tx_bytes` | licznik miesięczny, zeruje się wg **cyklu rozliczeniowego modemu** |
| `realtime_rx_bytes` / `realtime_tx_bytes` | bajty bieżącego połączenia, zerują się przy zestawieniu sesji |
| `realtime_rx_thrpt` / `realtime_tx_thrpt` | prędkość chwilowa w **bajtach na sekundę** |
| `realtime_time` | czas trwania bieżącego połączenia [s] |

### Limit pilnowany przez modem

| pole | wartość na MC888 | znaczenie |
|---|---|---|
| `data_volume_limit_switch` | `1` | czy modem pilnuje limitu |
| `data_volume_limit_size` | `1070_1024` | **`<liczba>_<jednostka w MB>`** — patrz [`kodowanie-pol.md`](kodowanie-pol.md#data_volume_limit_size--rozmiar-limitu) |
| `data_volume_limit_unit` | `data` | `data` = limit na dane, `time` = na czas połączenia |
| `data_volume_alert_percent` | `100` | próg ostrzeżenia [%] |

Zużycie to zwykła suma `monthly_rx_bytes + monthly_tx_bytes` — modem nie podaje go osobnym
polem. Widok pokazuje sekcję **tylko** dla `switch=1` i `unit=data`: przy limicie czasowym
pasek zużycia danych kłamałby o tym, co jest pilnowane, a bez limitu zostałby sam licznik
miesięczny, czyli już zakładka Transfer.

### `date_month` — termin zerowania licznika

| pole | wartość na MC888 | znaczenie |
|---|---|---|
| `date_month` | `20260908` | data najbliższego zerowania licznika, `YYYYMMDD` |

✅ Potwierdzone z dwóch niezależnych stron (2026-08-11):

1. panel modemu ma **„Zresetuj licznik (dzień miesiąca)" ustawione na `8`**, a pole
   wskazuje `2026-09-08` — ten sam dzień, najbliższe wystąpienie;
2. zegar samego modemu (nagłówek `Date` z jego serwera HTTP) szedł zgodnie z routerem,
   więc ta data leży w **przyszłości** — nie jest zapisem ostatniego zerowania.

⚠️ **Dnia miesiąca modem nie wystawia osobnym polem.** Sprawdzone i puste:
`data_volume_limit_day`, `monthly_reset_day`, `reset_day`, `data_clear_day`,
`data_volume_clear_day`, `auto_clear_day`, `monthly_clear_day`, `limit_day`, `month_day`.
`date_month` jest więc jedynym źródłem terminu — widok odrzuca datę z przeszłości, bo
znaczyłaby, że pole nie jest tym, czym je bierzemy.

⚠️ `monthly_time` **nie jest** licznikiem czasu w ramach cyklu: pokazywał 5,7 dnia
połączenia przy 3,8 dnia od początku cyklu (8. dzień miesiąca). Do czego się odnosi —
nierozstrzygnięte; nie używamy go.

⚠️ Liczniki są **modemu, nie routera** — nie zgadzają się z ruchem mierzonym na
interfejsie WAN i nie da się ich wyzerować z poziomu modułu (zakres tylko do odczytu).

✅ `realtime_*_bytes` potwierdzone na **MC888** (2026-08-07). Na pozostałych modelach
jeszcze niesprawdzone — widok pomijał sekcję „Bieżące połączenie", gdy obie wartości są
puste, więc firmware bez tych liczników degradował się cicho. Zasadę zachować przy
odtwarzaniu zakładki. Przy okazji profilowania kolejnego modemu warto uzupełnić tę tabelę.

⚠️ `realtime_*_thrpt` podaje **bajty/s**, a nie bity — trzeba mnożyć przez 8, żeby pokazać
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

⚠️⚠️ **MC888 melduje nośną główną DRUGI RAZ jako SCell.** Potwierdzone w trzech próbkach
co 5 s (2026-08-08):

```
lte_pci = 1a3 (419)   lte_ca_pcell_freq = 3125   lte_ca_pcell_band = 7
lte_multi_ca_scell_info = "1,198,2,8,3650,5.0;2,271,1,3,1815,15.0;3,419,1,7,3125,15.0"
                                                                   └ PCI 419 @ 3125 = PCell
```

Ten sam PCI **i** ten sam EARFCN co nośna główna — to ta sama komórka, a nośna nie może być
agregowana sama ze sobą. Bez odsiania widok pokazywał ją dwa razy i liczył:

| | z duplikatem | po odsianiu |
|---|---|---|
| nośne | 4×CA | **3×CA** |
| łączna szerokość | 50 MHz | **35 MHz** |
| sufit teoretyczny | 378 Mb/s | **265 Mb/s** |

Błąd nie kończył się na tabeli: `ceilingOf()` skaluje sufitem paski prędkości na zakładce
**Transfer**, więc zawyżenie o 43% szło dalej. Widok odrzuca wpis SCell o PCI i EARFCN
równych PCell-owi. MC7010 duplikatu nie ma (nośne 425/1290/3200 przy PCell 6275) i po
poprawce raportuje bez zmian 4×CA / 70 MHz.

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

## Komórki sąsiednie (`ngbr_cell_info`)

Jedyne pole, które pokazuje **jednocześnie sygnał użyteczny i konkurencję na tej samej
częstotliwości** — właściwy instrument przy ustawianiu anteny kierunkowej.

```
ngbr_cell_info = "3125,419,-11,-100,-66;3125,418,-18,-107,-80;3125,136,-15,-105,-81"
                  │    │   │   │    └ RSSI [dBm]
                  │    │   │   └────── RSRP [dBm]
                  │    │   └────────── RSRQ [dB]
                  │    └────────────── PCI (dziesiętnie!)
                  └─────────────────── EARFCN
```

Separator `;`, pola `,` — ta sama konwencja co `lte_multi_ca_scell_info`, i tak samo
**PCI jest dziesiętne**, mimo że `lte_pci` bywa szesnastkowe.

Układ odczytany z danych, nie z dokumentacji — potwierdzony na dwóch modelach (2026-08-08):

| model | próbka | `lte_pci` | `lte_ca_pcell_freq` |
|---|---|---|---|
| MC888 | 5 wpisów, PCI 419/418/417/133/136 | `1a3` = **419** | 3125 |
| MC7010 | 3 wpisy, PCI 123/451/168 | `7b` = **123** | 6275 |
| MF297D, MF79U | niesprawdzone | | |

Na obu **pierwszy wpis to komórka obsługująca** — zgadza się z `lte_pci` i
`lte_ca_pcell_freq`. Widok mimo to rozpoznaje ją **po wartościach, nie po pozycji**:
dopasowanie po PCI i EARFCN nie wywróci się na firmwarze, który posortuje listę inaczej.

### ⚠️⚠️ Zakłócenia policzone z tego pola NIE odtwarzają `lte_snr`

Kuszący rachunek — zsumować moc sąsiadów co-channel i odjąć od RSRP komórki obsługującej —
na jednej próbce MC7010 zgodził się ze zmierzonym SINR-em **co do dziesiątej decybela**.
To był zbieg okoliczności:

| modem | `S − I` z `ngbr_cell_info` | zmierzony `lte_snr` | rozjazd |
|---|---|---|---|
| MC7010 | 3,0 dB | 4,4 dB | 1,4 dB |
| MC888 | 0,9 dB | **13,4 dB** | **12,5 dB** |

Powód widać w danych MC888: PCI **417/418/419** to kolejne numery, czyli **sektory tego
samego masztu**. Trafiają na listę sąsiadów, ale nie zakłócają jak obcy nadajnik — antena
sektorowa je tłumi. Odrzucenie ich z sumy też nie ratuje rachunku (wychodzi 3,8 dB
przy 13,4 dB).

Dlatego widok **nie liczy żadnego SINR-u ani sumy zakłóceń**. Pokazuje odstęp `Δ` każdego
sąsiada od komórki obsługującej — wielkość, którą realnie maksymalizuje się obracając
antenę, i która nic nie obiecuje ponad to, co jest w danych. Sąsiedzi na innym EARFCN-ie
są wyliczeni, ale nie liczą się jako co-channel.

Dominujący zakłócacz jest wyróżniony w tabeli **warunkowo** — tylko gdy siedzi nie dalej
niż 10 dB pod komórką obsługującą. Bezwarunkowe podświetlanie „najsilniejszego" zawsze coś
oznacza, także gdy jedyny sąsiad jest 25 dB niżej i nie ma znaczenia. **10 dB to próg
czytelności, nie wyliczenie z fizyki** — skoro odstępy z tego pola nie odtwarzają `lte_snr`,
żaden próg wyprowadzony stąd „fizycznie" nie byłby uczciwy.

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
