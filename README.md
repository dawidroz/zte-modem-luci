# zte — aplikacje LuCI do monitoringu modemów ZTE

Moduły LuCI dla OpenWrt, które czytają parametry modemu ZTE **po HTTP przez API
`goform`** — bez `comgt`/AT, bez `/dev/ttyUSB*`. Docelowo dla modemów sieciowych
(CPE po Ethernecie) stanowiących łącze WAN routera.

## Zawartość

| katalog | opis |
|---|---|
| [`luci-app-zte-modem/`](luci-app-zte-modem/) | **wersja light** — zakres zamknięty |

### Wersja light — `luci-app-zte-modem`

Cztery zakładki, tylko odczyt, **zero zapisu do pamięci trwałej**:

- **Status** — RSRP/RSRQ/RSSI/SNR dla LTE i 5G NR, tabela nośnych z agregacją,
  łączna szerokość, sufit teoretyczny, identyfikacja stacji bazowej (btsearch.pl)
- **Transfer** — liczniki miesięczne i prędkość chwilowa z modemu
- **Modem** — model, firmware, IMEI, karta SIM (ICCID, IMSI, PLMN), APN, adresy WAN
- **Konfiguracja** — adres modemu, hasło, interwał, test logowania

Szczegóły API, warianty logowania i **pułapki poszczególnych firmware'ów**:
[`luci-app-zte-modem/README.md`](luci-app-zte-modem/README.md).

### Wersja rozbudowana — planowana

Statystyki, historia sygnału i wykresy trafią do **osobnego modułu pod własną nazwą**.
Świadomie nie dokładamy ich do wersji light, żeby nie wciągać jej w zapis do flasha.

## Sprawdzone modemy

| model | logowanie | `cmd=LD` | uwagi |
|---|---|---|---|
| MC888 | `sha256_sha256` | 64 hex | 5G NSA, pełna agregacja |
| MC7010 | `sha256_sha256` | 64 hex | 5G NSA, brak RSRQ dla NR |
| MF297D | `sha256_sha256` | 64 hex | LTE, mimo „MF" w nazwie loguje się jak seria MC |
| MF79U | `b64_plain` | **puste** | LTE, dongle USB, brak wyzwania |

⚠️ **Nazwa modelu nie wyznacza rodziny** — MF297D zachowuje się jak seria MC.
Reguły opierać na zachowaniu, nie na prefiksie nazwy.

## Wdrożenie

```sh
cd luci-app-zte-modem
./deploy.sh root@<adres-routera>      # --dry-run pokazuje, co by zrobił
```

Skrypt jest idempotentny i **nie nadpisuje istniejącego `/etc/config/zte-modem`**,
bo trzymane jest tam hasło do modemu. Hasła nie ma w repozytorium.

## Pochodzenie

Wydzielone z prywatnego repozytorium `horowe` z **zachowaniem pełnej historii**
(20 commitów, od pierwszej wersji modułu). Wcześniejsze commity używają starej
nazwy katalogu `luci-app-zte-mc888` — moduł został przemianowany, gdy przestał
dotyczyć jednego modelu.
