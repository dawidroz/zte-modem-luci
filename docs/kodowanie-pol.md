# Kodowanie identyfikatorów — per POLE, nie per urządzenie

Najbardziej zdradliwa część tego API: **nie ma pola, które ogłaszałoby system liczbowy**.
Ten sam modem potrafi podać jeden identyfikator szesnastkowo, a drugi dziesiętnie.
Decyzję trzeba podejmować osobno dla każdego pola, na podstawie zakresu wartości.

Wartości w przykładach poniżej są zanonimizowane, ale **wewnętrznie spójne** — arytmetyka
się zgadza i można na nich sprawdzić implementację.

## `cell_id` — `_cell_base`

Rozstrzyga zakres: ECI ma **28 bitów** (max 268 435 455), więc wartość, która jako hex go
przekracza, hexem nie jest.

| model | `cell_id` | rozstrzygnięcie |
|---|---|---|
| MC888 | `21ab417` | litera → **hex** (= 35304471) |
| MC7010 | `1c59021` | litera → **hex** |
| MF79U | `0f2a16` / `0f2a1c` | **hex** — obie próbki dają ten sam eNodeB (`>>8` = 3882) przy sektorach 22 i 28 |
| MF297D | `35304501` | jako hex 892 355 841 **> 268 435 455** → **dec** |

Ograniczenie: krótka wartość bez liter, mieszcząca się w zakresie w obu interpretacjach
(np. `1234567`) — wygrywa hex. Dla 8-cyfrowych ECI dziesiętnych test działa zawsze, bo
jako hex przekraczają zakres.

✅ **Kontrola krzyżowa, która domyka sprawę.** Dwa różne modemy w tej samej lokalizacji
zameldowały się na tym samym maszcie:

| modem | `cell_id` | interpretacja | ECI | eNodeB | sektor |
|---|---|---|---|---|---|
| MC888 | `21ab417` | hex | 35304471 | **137908** | 23 |
| MF297D | `35304501` | dec | 35304501 | **137908** | 53 |

Ten sam maszt, dwa modemy, dwa różne kodowania, ten sam wynik — i oba trafiają
w btsearch na tę samą stację. To jest dowód, że heurystyka zakresu działa, a nie
że akurat dobrze zgadła.

⚠️ **Zanim modem się zarejestruje** (`ppp_disconnected`), `cell_id` bywa **niepełny** —
MF297D pokazywał wtedy `60213`, wartość na tyle krótką, że heurystyka wybrała hex.
Nic z tego nie wynika: przy takiej wartości btsearch i tak nie trafia w żadną
interpretację, a po zestawieniu połączenia pole wraca do pełnej postaci.

## `lte_pci` — `_pci_base`, decyzja OSOBNA

Dotyczy **wyłącznie pola `lte_pci`**. PCI wewnątrz `lte_multi_ca_scell_info`
i `ngbr_cell_info` jest **zawsze dziesiętne**, niezależnie od tego, w czym modem podaje
`lte_pci` — te listy nie przechodzą przez tę heurystykę.

MF79U podaje `cell_id` szesnastkowo, ale PCI dziesiętnie: `205`, co jako hex daje 517 —
poza zakresem PCI (0–503). Stąd druga, **niezależna** heurystyka:

| krok | reguła |
|---|---|
| 1 | jest litera `a-f` → **hex** |
| 2 | jako hex > 503 → to nie może być PCI → **dec** |
| 3 | `model_name` zaczyna się od `MF79` → **dec** |
| 4 | inaczej → **hex** (zgodnie z serią MC) |

Krok 3 jest potrzebny, bo dla wartości typu `100` — bez liter i w zakresie obu
interpretacji — sam łańcuch nie rozstrzyga. Zawężony do `MF79*`, bo **sama litera „MF"
nie oznacza rodziny**: MF297D loguje się dokładnie jak seria MC.

⚠️ Konsekwencja pominięcia tej heurystyki: MC888 pokazywał PCI 11 i 133, a naprawdę
było to **17 i 307**.

## `data_volume_limit_size` — rozmiar limitu

Nie liczba i nie jednostka, tylko **oba naraz, sklejone podkreśleniem**:

```
data_volume_limit_size: "1070_1024"
                         │    └ jednostka w MB (1024 = GiB)
                         └────── liczba jednostek
bajty = liczba × jednostka × 1024²
```

Kodowania nie trzeba zgadywać — rozstrzyga zrzut z panelu modemu przy tej samej wartości
pola: `1070 × 1024 MB = 1,0449 TiB`, a panel pisze **„1.04TB"**. Zgadzają się też dwie
pozostałe liczby z tego ekranu wobec `monthly_rx + monthly_tx` z tej samej chwili.

⚠️ Widać przy okazji, że **panel liczy binarnie, a etykietuje dziesiętnie** — dzieli przez
1024 i pisze „GB". Moduł liczy tak samo, ale pisze `GiB`/`TiB`, więc przy resztce poniżej
1 TiB pokaże `921.09 GiB` tam, gdzie panel pokazuje `0.89TB`. Ta sama wielkość.

Towarzyszące pola są zwykłe: `data_volume_limit_switch` (`0`/`1`),
`data_volume_alert_percent` (liczba procent) i `data_volume_limit_unit` — `data` albo
`time`, bo modem umie limitować także **czas połączenia**, i wtedy `..._size` znaczy coś
innego niż bajty.

## Co jest dziesiętne mimo wszystko

Nie wszystko jest hexem. Pasma i kanały są **dziesiętne**:

```
lte_ca_pcell_band:      "20"        pasmo B20, nie 32
nr5g_action_channel:    "640704"
lte_ca_pcell_bandwidth: "15.0"
```

Potrzebna jest więc **tabela typów pól** (hex / dec / string), nie jedno założenie dla
całego urządzenia.

## eNodeB liczymy sami

`enodeb_id` **nie jest wiarygodne**: MF79U wstawia tam kopię `cell_id`, więc numer
komórki udawałby numer stacji.

```
eNB    = ECI >> 8
sektor = ECI & 0xff
```

Na MC888 i MC7010 wynik zgadza się z tym, co modem podaje sam
(`0x21ab417 >> 8 = 0x21ab4`).

## `wan_active_band` potrafi kłamać

MF79U raportuje `LTE BAND 1` zarówno przy EARFCN 1875 (to B3), jak i 9460 (to B28) —
a zakres B1 to 0–599, więc żadna z tych wartości nie jest B1.

Dlatego pasmo nośnej głównej wyznaczamy w kolejności:

```
lte_ca_pcell_band → lte_band → wyliczenie z EARFCN → wan_active_band
```

EARFCN jest indeksem fizycznej częstotliwości, więc rozstrzyga. Tablica `EARFCN_BANDS`
wg **3GPP TS 36.101**. `wan_active_band` zostaje ostatnim zapasem, nie pierwszym źródłem.
