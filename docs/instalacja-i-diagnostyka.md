# Instalacja na cudzym routerze i zgłaszanie problemów

Dokument dla osoby, która dostała gotowe pakiety i chce je uruchomić u siebie.

## Czego wymaga moduł

### Router

| wymaganie | dlaczego |
|---|---|
| **OpenWrt** (testowane na 24.10.2) | moduł to backend `rpcd` + widok LuCI |
| **LuCI** zainstalowane | bez niego jest sam obiekt ubus, bez ekranu |
| modem ZTE **po Ethernecie**, z panelem WWW | cały odczyt idzie po HTTP przez API `goform` |
| ok. **60 kB** miejsca | to skrypty i JS, nic się nie kompiluje |

⚠️ **Moduł nie obsługuje modemów na USB przez AT/`comgt`.** Jest napisany pod CPE
sieciowe (modem jest osobnym urządzeniem z własnym adresem IP). Jeśli Twój modem widać
jako `/dev/ttyUSB*` albo `/dev/cdc-wdm*`, to nie jest narzędzie dla Ciebie — użyj
`modemdata` / `modemband` z feedu eko.one.pl.

### Pakiety, które muszą być na routerze

Wszystkie są w standardowym OpenWrt z LuCI, więc zwykle **nic nie trzeba doinstalowywać**:

| pakiet | do czego |
|---|---|
| `curl` | HTTP do modemu, obsługa ciasteczka sesji |
| `ucode` | base64 przy jednym z wariantów hashowania hasła |
| `jshn` | składanie JSON-a w backendzie (`jshn.sh`) |
| `jsonfilter` | czytanie odpowiedzi modemu |
| `rpcd` | rejestracja obiektu ubus |
| `luci-base` | widok (tylko pakiet `-light`) |

`flock`, `sha256sum` i `md5sum` pochodzą z busyboxa i są zawsze.

Gdyby czegoś brakowało, menedżer pakietów **odmówi instalacji** i nic nie zapisze na dysku
— nie ma stanu połowicznego. Wtedy: `opkg update && opkg install <brakujący>`.

### Instalacja

```sh
# OpenWrt <= 24.10 (opkg)
opkg install zte-modem-core_*.ipk luci-app-zte-modem-light_*.ipk

# OpenWrt z apk
apk add --allow-untrusted zte-modem-core-*.apk luci-app-zte-modem-light-*.apk
```

⚠️ **Podawaj oba pakiety w jednym poleceniu.** Osobno widok nie znajdzie jeszcze
`zte-modem-core`, a opkg zgłosi wtedy mylący błąd o **niezgodnej architekturze** —
prawdziwa przyczyna jest w pierwszej linii („cannot find dependency").

#### `error: uninstallable` przy `apk add`

Dotyczy **pakietów `.apk` do wersji 1.0.0 włącznie** — poprawione w 1.1.0 (core)
i 1.2.0 (widok). Objaw:

```
ERROR: unable to select packages:
  zte-modem-core-1.0.0-r1:
    error: uninstallable
    arch: all
```

Nie chodzi ani o zależności, ani o podpis — pakiety miały wpisaną architekturę `all`,
czyli konwencję **opkg**. `apk-tools` nazywa brak architektury `noarch` i wartości `all`
nie zna. `apk mkpkg` budował taki pakiet bez słowa skargi, a błąd wychodził dopiero
u instalującego; linia `arch:` jest w komunikacie tylko jednym z opisów pakietu, więc
łatwo wziąć całość za brak zależności.

**Rozwiązanie: pobierz pakiety w wersji 1.1.0/1.2.0 lub nowszej.** Sprawdzone na
OpenWrt 25.12-SNAPSHOT (apk-tools 3.0.5). Architekturę pakietu potwierdza
`apk adbdump plik.apk | grep arch` — ma być `noarch`.

Potem: **Services → Modem ZTE → Konfiguracja** — adres modemu i hasło administratora.

⚠️ **Adres modemu to NIE adres routera.** Typowo `192.168.32.1`, `192.168.8.1` albo
`192.168.0.1` — ten, pod którym otwiera się panel WWW modemu. Wpisanie adresu routera to
najczęstszy błąd konfiguracji.

## Zanim zgłosisz problem — pięć rzeczy do sprawdzenia

Najczęstsze przyczyny, w kolejności od najczęstszej. Cztery pierwsze nie są usterką modułu.

### 1. Widok wygląda jak sprzed instalacji

LuCI trzyma JS w cache przeglądarki i podaje go ze statycznym numerem wersji, więc
podmiana pliku na routerze go nie unieważnia.

➡️ **Twarde przeładowanie: Ctrl+Shift+R.** Bez tego każda aktualizacja wygląda na nieudaną.

### 2. Wszystkie metryki puste, choć łącze działa

Modemy ZTE dopuszczają zwykle **jedną sesję administratora naraz**. Jeśli masz otwarty
panel modemu w drugiej karcie albo właśnie robiłeś coś `curl`-em ręcznie — wybiłeś sesję
modułu.

➡️ Zamknij panel modemu, odczekaj interwał odświeżania, sprawdź ponownie.

### 3. Pusty ekran / brak danych zaraz po instalacji

➡️ Sprawdź, czy backend się zarejestrował:

```sh
ubus list | grep zte-modem      # ma wypisać: zte-modem
ubus call zte-modem status      # ma zwrócić JSON
```

Jeśli obiektu nie ma, prawie zawsze znaczy to, że plik
`/usr/libexec/rpcd/zte-modem` **nie jest wykonywalny** albo `rpcd` nie został przeładowany:

```sh
chmod 0755 /usr/libexec/rpcd/zte-modem
/etc/init.d/rpcd restart
```

### 4. „Logowanie do modemu nie powiodło się"

➡️ Sprawdź kolejno:

```sh
uci get zte-modem.main.host     # czy to na pewno adres MODEMU, nie routera
ubus call zte-modem probe       # wymusza logowanie i mówi, który wariant hasha zadziałał
```

`probe` zużywa próby logowania — modem blokuje po pięciu nieudanych. Nie puszczaj go
w pętli.

### 5. Metryki puste i `curl` „jest, ale nie działa"

Zdarzyło się realnie: `curl` zainstalowany, zależność formalnie spełniona, a binarka nie
startuje z powodu niedopasowanego `libcurl4`.

➡️ **Uruchom curla, nie sprawdzaj samej obecności pakietu:**

```sh
curl --version
# Error relocating: curl_multi_notify_enable: symbol not found   <- to jest to
```

Naprawa: `opkg update && opkg upgrade libcurl4`.

## Co podesłać, gdy nadal nie działa

W repozytorium jest skrypt, który zbiera wszystko naraz — wersję OpenWrt, stan pakietów,
**czy zależności realnie się uruchamiają**, tryby plików, rejestrację w ubus, łączność
z modemem i pełny odczyt modułu.

```sh
ssh root@router sh - < scripts/diag.sh > raport.txt
# albo, jeśli jesteś już na routerze:
sh /tmp/diag.sh > /tmp/raport.txt
```

Skrypt jest **tylko do odczytu** — nic nie instaluje, nie restartuje i nie zapisuje.

### 🔒 Raport jest zredagowany, ale i tak go przejrzyj

Automatycznie zastępowane przez `[ukryte]`: **hasło do modemu**, IMEI, IMSI, ICCID,
Cell ID, eNodeB, adresy WAN oraz dane masztu z btsearch (stacja, miejscowość, adres,
współrzędne).

Zostają **metryki radiowe i struktura nośnych** (PCI, EARFCN, pasma, RSRP/RSRQ/SINR) oraz
nazwa operatora — bez nich zgłoszenie nic nie wnosi, a same nie identyfikują abonenta.

⚠️ Redakcja jest oparta na liście nazw pól. Jeśli Twój firmware zwraca pole, którego lista
nie zna, może ono przejść — **przejrzyj raport przed wklejeniem go w publiczne miejsce.**

### Do tego napisz

1. **model modemu i wersję firmware'u** (widać w zakładce Modem albo w raporcie),
2. **co konkretnie jest nie tak** — czego brakuje, co pokazuje złą wartość,
3. **czego się spodziewałeś** i skąd wiesz, że tak ma być (np. panel modemu pokazuje co
   innego — wtedy zrzut ekranu z panelu bardzo pomaga),
4. czy problem jest **stały czy przerywany**.

Jeśli zgłoszenie dotyczy **modelu spoza listy sprawdzonych** (MC888, MC7010, MF297D,
MF79U) — to najcenniejszy rodzaj zgłoszenia. Procedura profilowania nowego modemu jest
na końcu [`modele.md`](modele.md); raport z `diag.sh` pokrywa jej większość.
