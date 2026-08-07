# Rozpoznawanie stacji bazowej (btsearch.pl)

Moduł potrafi zamienić `cell_id` na **operatora, miejscowość, adres i współrzędne masztu**,
z którego wisi modem, plus odnośnik do mapy OpenStreetMap. Działa dla stacji w polskim
rejestrze UKE; komórki zagraniczne po prostu się nie znajdą i sekcja się nie pokazuje.

## API

Stary link `szukaj.php?mode=std&search=` **nie działa** — btsearch.pl jest dziś SPA za
Cloudflare i każdy adres zwraca ten sam ~5,8 kB szkielet HTML. Jest za to publiczne API:

```
POST https://btsearch.pl/api/v1/search
Content-Type: application/json

{"query": "ecid: 35304471"}
```

Modem podaje Cell ID **szesnastkowo** (`21ab417`), API szuka po **dziesiętnym ECI**
(`35304471`) — konwersja po stronie backendu, patrz [`kodowanie-pol.md`](kodowanie-pol.md).

Odpowiedź zawiera `data[0].operator.name`, `data[0].location.{city,address,latitude,
longitude}` oraz listę komórek z `ecid` / `enbid` / `clid` / `earfcn`.

> ⚠️ `ecid:` i `enbid:` są prawdziwymi filtrami. Uwaga na inne nazwy — `clid:` czy `pci:`
> wyglądają na fallback do wyszukiwania tekstowego po `station_id` i zwracają przypadkowe
> stacje. Trafienie warto potwierdzić po `ecid` w zwróconych komórkach.

## Cache

Backend **cache'uje odpowiedź w tmpfs pod numerem komórki**
(`/tmp/zte-modem.bts.<dec>.json`) — maszt zmienia się rzadko, więc to jedno zapytanie na
zmianę komórki, nie przy każdym odświeżeniu.

| | czas |
|---|---|
| odczyt ciepły | ~0,15 s |
| odczyt zimny | ~0,46 s |

Cache jest przycinany do 20 ostatnich komórek. Nietrafione zapytanie **nie jest
cache'owane** — spróbuje ponownie.

## Prywatność

Zapytanie **wysyła Cell ID modemu do zewnętrznego serwisu**, a odpowiedź zawiera
przybliżoną lokalizację. Wyłącznik:

```
uci set zte-modem.main.bts_lookup='0'
uci commit zte-modem
```

albo pole w zakładce Konfiguracja. Przy `bts_lookup=0` Cell ID **nie opuszcza sieci
lokalnej** — widok pokazuje go wtedy tylko liczbowo, bez sekcji „Stacja bazowa".

Cell ID jest w widoku wypisany szesnastkowo i dziesiętnie (`21ab417 (35304471)`),
ale **bez odnośnika** do btsearch — bo działający odnośnik wymagałby SPA, a stary
format URL prowadzi donikąd.
