# API `goform` modemów ZTE

Modemy ZTE (CPE serii MC, dongle i routery serii MF) wystawiają panel WWW oparty
o dwa endpointy `goform`. To jedyny kanał, jakiego używają moduły w tym repozytorium —
bez `comgt`/AT, bez `/dev/ttyUSB*` i `/dev/cdc-wdm*`.

```
GET  /goform/goform_get_cmd_process?isTest=false&cmd=LD
     -> {"LD":"4AFC…1CB1"}                      64 hex => logowanie oparte o SHA256
     -> {"LD":""}                               puste  => rodzina bez wyzwania

POST /goform/goform_set_cmd_process
     isTest=false&goformId=LOGIN&password=<HASH>
     -> {"result":"0"}                          "0" = sukces, "3" = zle haslo/hash

GET  /goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=pole1,pole2,…
```

Wszystkie zapytania wymagają nagłówka `Referer: http://<modem>/index.html`.

Zakres używany przez moduły to **tylko odczyt**. Żadnego restartu, SMS-ów ani blokowania
pasm — dzięki temu niepotrzebny jest nagłówek `AD` i nie da się przez pomyłkę odciąć
routera od sieci.

## Logowanie

### Warianty hashowania hasła

Firmware'y różnią się algorytmem, więc backend próbuje po kolei i **zapamiętuje
działający** w `zte-modem.main.hash_variant`:

| wariant | wzór | |
|---|---|---|
| `sha256_b64` | `SHA256(base64(hasło) + LD)` wielkimi literami | |
| `sha256_sha256` | `SHA256(SHA256(hasło) + LD)` wielkimi literami | ✅ MC888, MC7010, MF297D |
| `b64_plain` | samo `base64(hasło)`, bez `LD` | ✅ MF79U |
| `md5_plain` | `MD5(hasło + LD)` | |

Warto zauważyć, że **hasło nie jest kodowane base64** przed hashowaniem — mimo że to
najczęściej opisywany w sieci wariant dla ZTE.

Gdy zapamiętany wariant przestanie działać (np. po zmianie hasła), backend automatycznie
przechodzi przez pozostałe. Ręczna diagnostyka: `ubus call zte-modem probe`.

### ⚠️ `LD` rotuje po nieudanej próbie

Potwierdzone eksperymentem na MC7010: po odrzuconym logowaniu kolejne `cmd=LD` zwraca
**inną** wartość. Każda próba wariantu **musi pobrać świeże `LD`** — strzelanie serią
wariantów z jednym, raz pobranym wyzwaniem daje fałszywy wniosek „żaden nie działa".

Między udanymi zapytaniami `LD` jest stałe; to nie jest nonce per żądanie.

### Semantyka pól logowania

Ustalona empirycznie, wbrew pierwszemu wrażeniu:

| pole | znaczenie |
|---|---|
| `result` | `"0"` = sukces, `"3"` = **złe hasło/hash** (nie blokada) |
| `psw_fail_num_str` | **pozostałe** próby, odlicza 5→4→…; po udanym logowaniu wraca do 5 |
| `login_lock_time` | licznik okna sesji (~300 s); `-1` = nieaktywny |

Sonda wariantów powinna **oszczędzać pulę prób**: przy 5 próbach i 4 wariantach nie ma
marginesu. Zaczynać od `sha256_sha256`.

⚠️ `login_lock_time` zwraca pustą wartość przy pojedynczym `cmd=` — działa wyłącznie
w `multi_data=1`.

## Wykrywanie sesji: `user_ip_addr`

Pole, po którym backend poznaje ważną sesję. Puste bez cookie, po zalogowaniu zawiera
adres klienta rozmawiającego z modemem. Jako jedyne jest wypełnione na **wszystkich**
sprawdzonych modelach i **nie zależy od karty SIM ani od zestawionego połączenia**:

| model | bez cookie | z cookie |
|---|---|---|
| MC888 | `""` | `192.168.32.147` |
| MC7010 | `""` | `192.168.8.20` |
| MF79U (bez SIM) | `""` | `192.168.10.178` |

To istotne właśnie dla modemu bez karty: metryki radiowe (`lte_rsrp`, `cell_id`, …) są
wtedy puste z powodów niezwiązanych z sesją, więc oparta na nich heurystyka uznawała
modem za wylogowany przy każdym odpytaniu — i moduł logował się w kółko, walcząc
o jedyną sesję z przeglądarką użytkownika. Pola radiowe zostają jako zapas.

⚠️ `SSID1` / `AuthMode` / `LocalDomain` też są bramkowane sesją, ale **tylko na MF79U** —
na MC888 i MC7010 są puste nawet po zalogowaniu. Nie nadają się na test uniwersalny.

### ⚠️⚠️ `cmd=loginfo` NIE jest wskaźnikiem sesji

W formie **pojedynczej** zwraca `{"loginfo":"ok"}` także **bez cookie** — sprawdzone na
MC888 i MC7010. Backend opierał na nim detekcję sesji i przez to nigdy się nie logował:
`_authenticated: true` przy kompletnie pustych metrykach.

Wewnątrz `multi_data=1` to samo pole zachowuje się już poprawnie, ale różnica jest zbyt
subtelna, żeby na niej polegać.

## Pola dostępne bez logowania

Czytają się zawsze: `model_name`, `network_type`, `network_provider`, `signalbar`,
`ppp_status`, `modem_main_state`, `wa_inner_version`, `simcard_roam`.

**Wymagają sesji:** wszystkie metryki sygnału (`lte_*`, `Z5g_*`, `nr5g_*`), `cell_id`,
`wan_ipaddr`, liczniki transferu, dane karty SIM.

⚠️ **Wygasła sesja wygląda jak awaria modemu, nie jak brak logowania.** Zapytanie zwraca
komplet kluczy, tyle że wypełnione są tylko te osiem pól. Objaw łatwo wziąć za limit
liczby pól w `multi_data` — sprawdzone: **takiego limitu nie ma**, po ponownym zalogowaniu
to samo zapytanie o 40 pól zwraca komplet. Hipoteza „limitu pól" okazała się czymś innym
już dwukrotnie.

## ⚠️ Jedna sesja administratora naraz

CPE ZTE dopuszczają zwykle **jedną sesję naraz**. Logowanie przy każdym odpytaniu
wyrzucałoby użytkownika z panelu modemu co kilka sekund. Dlatego backend:

- **reużywa cookie** z `/tmp/zte-modem.cookie`; loguje się dopiero gdy modem przestanie
  zwracać pola wymagające sesji,
- **cache'uje odpowiedź** w `/tmp/zte-modem.json` — N otwartych kart LuCI to nadal
  **jedno** zapytanie do modemu na `refresh_interval`,
- **serializuje** równoległe wywołania przez `flock` na `/tmp/zte-modem.lock`,
- **degraduje się łagodnie**: brak sesji → pola dostępne bez logowania plus czytelny
  komunikat; modem nieosiągalny → ostatnie znane dane oznaczone jako `_stale`.

Nazwa cookie zależy od firmware'u (`stok` na MF79U).

⚠️ **Kolizja o jedyną sesję jest myląca w diagnostyce.** Ręczne zapytania diagnostyczne
potrafią wybić sesję modułu, co wygląda dokładnie jak regres po wdrożeniu (puste metryki
przy `_authenticated: true`). Zanim ogłosisz regres — powtórz odczyt albo puść
`sh -x /usr/libexec/rpcd/zte-modem call status`.

## Zależności na routerze

**Żadnych dodatkowych pakietów.** Na docelowych routerach nie ma `openssl` ani `base64`,
więc:

| Potrzeba | Rozwiązanie |
|---|---|
| HTTP + cookies | `curl` |
| base64 | `ucode -e 'print(b64enc(getenv("ZTEPW")))'` — hasło przez **środowisko**, nie `argv` (nie widać go w `ps`) |
| SHA256 / MD5 | `sha256sum`, `md5sum` |
| JSON | `jsonfilter`, `jshn.sh` |
| Serializacja | `flock` |

⚠️ **`which curl` nie wystarcza.** Spotkana awaria: binarka `curl 8.19.0-r2` przy
`libcurl4 8.12.1-r1` → `Error relocating: curl_multi_notify_enable: symbol not found`.
Trzeba curla **uruchomić** (`curl --version`), nie tylko sprawdzić obecność.
Naprawa: `opkg upgrade libcurl4`. Do rozważenia `uclient-fetch` z bazy OpenWrt
(ma `--header` i `--post-data`) zamiast zależności od curla.
