# luci-app-zte-modem — wersja rozbudowana (planowana)

**Ten pakiet jeszcze nie istnieje.** Katalog trzyma miejsce i zapisuje ustalenia
projektowe, żeby nie odtwarzać ich od zera przy starcie prac.

Wersja działająca dziś to [`luci-app-zte-modem-light`](../luci-app-zte-modem-light/) —
cztery zakładki, tylko odczyt, zero zapisu do flasha. Jej zakres jest **zamknięty**
i nie należy do niej dokładać rzeczy z listy poniżej.

## Co ma dojść ponad wersję light

- historia sygnału (RSRP/RSRQ/SINR w czasie)
- wykresy
- statystyki transferu dłuższe niż licznik miesięczny modemu
- prawdopodobnie: log zmian komórki / stacji bazowej

## Ustalenia projektowe

**Backend zostaje wspólny.** Odczyt modemu bierzemy z
[`zte-modem-core`](../zte-modem-core/) bez zmian — warianty logowania, sonda hasha,
dekodowanie pól i cache są identyczne dla obu wersji. Duplikowanie tego kodu jest
zabronione; poprawka pułapki firmware'u ma działać w obu wersjach naraz.

⚠️ **Core musi pozostać read-only.** Historia wymaga zapisu, ale zapis nie może trafić
do core, bo złamałby niezmiennik wersji light („zero zapisu do pamięci trwałej").
Dlatego:

- kolektor historii jest **osobnym procesem w tym pakiecie**, nie rozszerzeniem core,
- czyta przez `ubus call zte-modem status` — czyli korzysta z tego samego cache i nie
  dokłada ruchu do modemu ani nie walczy o jedyną sesję,
- wystawia **własny obiekt ubus** (roboczo `zte-modem-hist`), żeby ACL i metody wersji
  light zostały nietknięte.

**Nośnik historii do wyboru przy starcie.** Flash routera nie znosi częstego zapisu,
więc realne opcje to bufor pierścieniowy o stałym rozmiarze z rzadkim zrzutem, albo
`rrdtool` / `collectd`, jeśli i tak są na routerze.

## Nazewnictwo — uwaga

Identyfikatory runtime są **wspólne dla obu wersji i się nie zmieniają**:
`/etc/config/zte-modem`, obiekt ubus `zte-modem`, ścieżka menu `admin/services/zte-modem`,
katalog widoku `view/zte-modem/`. Sufiks `-light` dotyczy wyłącznie nazwy katalogu
w repozytorium i nazwy pakietu.

⚠️ Konsekwencja: obie wersje shipują wpis menu pod tą samą ścieżką, więc **nie da się ich
zainstalować obok siebie**. To celowe — to dwa warianty tego samego ekranu, nie dwa
niezależne narzędzia. Przy pakowaniu do `.ipk` należy zadeklarować konflikt.
