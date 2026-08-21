// Mapper odpowiedzi modemow ZTE mowiacych po ubus JSON-RPC (MC7510 i pokrewne)
// na nazwy pol z API goform - tych, ktorymi posluguje sie widok.
//
// Wejscie  (stdin): koperta z odpowiedziami metod ubus, po jednym kluczu na
//                   metode: {"nwinfo":{...},"device":{...},"common":{...},...}
// Wyjscie (stdout): plaski obiekt w konwencji goform.
//
// WSZYSTKIE wartosci wychodza jako LANCUCHY. To nie kosmetyka: goform oddaje
// czysty tekst, wiec widok porownuje wprost (`st.pin_status === '0'`,
// `st.simcard_roam === 'Home'`), a ubus oddaje typy mieszane - `signalbar` jest
// tekstem, ale `lte_pci` i `rmcc` sa liczbami. Bez ujednolicenia porownania
// cicho przestaja trafiac.
//
// Dzieki temu mapowaniu modem na ubusie wyglada dla reszty modulu (cache, lock,
// btsearch, widok) DOKLADNIE tak jak modem na goformie - jedyna roznica jest
// kodowanie identyfikatorow, ktore backend oglasza w _pci_base / _cell_base.

'use strict';

let fs = require('fs');

// --- narzedzia -------------------------------------------------------------

// Skalar -> lancuch. Puste dla braku wartosci, zeby widok traktowal pole jak
// nieobslugiwane przez firmware (funkcja row() odsiewa '' i null).
//
// Dla liczb zmiennoprzecinkowych uzywamy %J, a NIE %s: %s obcina "4.0" do "4",
// a te pola (lte_snr, szerokosci nosnych) czytaja sie jako pomiar z dokladnoscia
// do dziesiatych.
function S(v) {
	// Brak wartosci to w ucode zawsze null - `undefined` nie istnieje jako
	// globalna nazwa i odwolanie do niej jest bledem wykonania, nie falszem.
	if (v === null)
		return '';

	let t = type(v);

	if (t == 'string') return v;
	if (t == 'bool')   return v ? '1' : '0';
	if (t == 'int')    return sprintf('%d', v);
	if (t == 'double') return sprintf('%J', v);

	return '';
}

// Jak S(), ale zero znaczy "modem tego nie podaje".
//
// Potrzebne, bo MC7510 wypelnia czesc pol zerem zamiast zostawic je puste:
// `rssi` i `rscp` w nwinfo stoja na 0 przy poprawnie podanym `lte_rssi` = -80.
// Widok bierze pierwsza NIEPUSTA wartosc (rssiOf: lte_rssi, potem rssi), wiec
// zero przepuszczone dalej udawaloby pomiar rowny 0 dBm.
function Snz(v) {
	let s = S(v);
	return (s == '' || +s == 0) ? '' : s;
}

// Adres IP albo puste. MC7510 w trybie bridge oddaje "0" zamiast pustego pola
// (ipv4_address = "0", gdy sesja jest IPv6-only), a "::" dla nieustawionego IPv6.
function Sip(v) {
	let s = trim(S(v));
	return (s == '' || s == '0' || s == '0.0.0.0' || s == '::') ? '' : s;
}

// Obcina biale znaki w kazdym elemencie tablicy.
//
// ⚠️ NIE wolno tu podac `trim` wprost jako map(arr, trim): ucode wola funkcje
// z trzema argumentami (wartosc, indeks, tablica), a `trim` przyjmuje drugim
// argumentem ZESTAW ZNAKOW do obcinania - dostaje wiec indeks i zwraca null.
// Objaw jest cichy i mylacy: cala lista wychodzi jako [null, null, ...],
// czyli modem wyglada na taki, ktory nie podaje agregacji.
function trimmed(arr) {
	return map(arr, function(x) { return trim(x); });
}

// Rozbior listy rozdzielonej ';' z ewentualnym separatorem na koncu
// ("a,b;c,d;" - MC7510 zawsze dokleja ostatni ';').
function items(v) {
	let s = trim(S(v));
	if (s == '')
		return [];

	return filter(trimmed(split(s, ';')), function(x) { return x != ''; });
}

// Pola jednego wpisu, kazde obcinane z bialych znakow.
//
// ltecasig ma spacje WEWNATRZ wpisu ("-75.0, -11.0,10.0,-65.0,0,2"), wiec bez
// trim() drugie pole wychodzi jako " -11.0" i nie przechodzi przez parseFloat
// w niektorych miejscach widoku.
function fields(entry) {
	return trimmed(split(entry, ','));
}

function get(obj, key) {
	return (type(obj) == 'object' && exists(obj, key)) ? obj[key] : null;
}

// --- wejscie ---------------------------------------------------------------

let raw = fs.stdin.read('all') ?? '';

// json() na niepoprawnym wejsciu RZUCA blad, a nie zwraca null - bez przechwycenia
// urwana albo pokiereszowana odpowiedz modemu wywala mapper z bledem skladni
// zamiast dac po prostu pusty wynik. Backend rozpoznaje pusty wynik i oddaje
// ostatnie znane dane; wysypanie sie zostawia tylko slad w logach rpcd.
let parsed;
try {
	parsed = json(raw);
} catch (e) {
	parsed = {};
}

parsed ??= {};

// Na wejsciu przyjmujemy dwa ksztalty:
//
//  1. TABLICE - surowa odpowiedz na paczke wywolan JSON-RPC, tak jak oddaje ja
//     modem. Nazwy kluczy koperty przychodza wtedy w ZTE_UBUS_KEYS (rozdzielone
//     przecinkami, w kolejnosci wywolan), a przypisanie idzie po polu `id`,
//     nie po pozycji w tablicy - kolejnosc odpowiedzi nie jest niczym
//     zagwarantowana, a `id` ustawiamy sami w _ub_batch.
//
//  2. OBIEKT - gotowa koperta {"nwinfo":{...},...}. Tak wygladaja probki
//     w tests/, dzieki czemu test nie musi udawac warstwy JSON-RPC.
function envelope(input) {
	if (type(input) != 'array')
		return input ?? {};

	let keys = filter(trimmed(split(getenv('ZTE_UBUS_KEYS') ?? '', ',')),
		function(k) { return k != ''; });

	let env = {};

	for (let i = 0; i < length(input); i++) {
		let entry = input[i] ?? {};
		let id    = get(entry, 'id');
		let res   = get(entry, 'result');

		// result to [status, dane]; status != 0 albo brak danych = pomijamy.
		if (type(res) != 'array' || length(res) < 2)
			continue;

		let name = keys[id - 1];
		if (name != null && name != '')
			env[name] = res[1];
	}

	return env;
}

let env = envelope(parsed);

let nw     = get(env, 'nwinfo')  ?? {};
let device = get(env, 'device')  ?? {};
let common = get(env, 'common')  ?? {};
let sim    = get(env, 'sim')     ?? {};
let iface  = get(env, 'iface')   ?? {};
let tr     = get(env, 'traffic') ?? {};
let lim    = get(env, 'limit')   ?? {};
let apn    = get(env, 'apn')     ?? {};
let web    = get(env, 'web')     ?? {};

let out = {};

function set(key, value) {
	if (value != null && value != '')
		out[key] = value;
}

// --- tozsamosc urzadzenia --------------------------------------------------
//
// `model_name` jest w get_zwrt_common_info, nie w device_info - inaczej niz na
// goformie, gdzie stoi obok wszystkiego innego. To nadal wiarygodny klucz
// rozpoznania modelu ("MC7510") i tak jest uzywany w stopce widoku.

set('model_name',         S(get(common, 'model_name')));
set('wa_inner_version',   S(get(device, 'wa_inner_version') ?? get(common, 'wa_inner_version')));
set('hardware_version',   S(get(common, 'hardware_version')));
set('imei',               S(get(device, 'imei')));

// "Wersja panelu": na goformie web_version / cr_version. Tutaj GUI_version
// ("V1.0"). Swiadomie NIE bierzemy web_red_version ("EU20.001") - to znacznik
// wydania regionalnego firmware'u, a nie wersja panelu.
set('web_version',        S(get(common, 'GUI_version')));

// Nazwa handlowa - MC7510 sprzedawany jest pod nazwa operatora (u Orange Polska
// jako "G51F"), i wlasnie ona jest na obudowie. Pole nie ma odpowiednika
// w goformie; widok pokazuje je tylko, gdy jest.
set('device_market_name', S(get(common, 'device_market_name')));

// Adres panelu modemu prosto od modemu, zamiast powtarzac ustawiony `host`.
set('lan_ipaddr',         Sip(get(web, 'web_local_addr')));

// --- karta SIM -------------------------------------------------------------

set('modem_main_state', S(get(sim, 'modem_main_state')));
set('iccid',            S(get(sim, 'sim_iccid')));
set('pin_status',       S(get(sim, 'pin_status')));

// IMSI CELOWO POMINIETE.
//
// MC7510 nie oddaje IMSI otwartym tekstem: `sim_imsi` i `msisdn` sa
// zaszyfrowane i podane w base64
// ("5C3T4ogfD8QYfM0OrZ/F1WmtTenH+9W0qvGfjdzhFMAE8eTu05QyPIiH1w=="), a klucza
// panel trzyma po swojej stronie. Przepisanie tego do `sim_imsi` wyswietliloby
// blok base64 z podpisem "IMSI", czyli smiec udajacy dane.
//
// Sieciowe MCC/MNC ida osobno (rmcc / rmnc ponizej), wiec PLMN widok policzy.

// --- siec ------------------------------------------------------------------

set('network_type',    S(get(nw, 'network_type')));
set('network_provider', S(get(nw, 'network_provider_fullname') ?? get(nw, 'network_provider')));
set('signalbar',       S(get(nw, 'signalbar')));
set('simcard_roam',    S(get(nw, 'simcard_roam')));
set('net_select_mode', S(get(nw, 'net_select_mode')));
set('rmcc',            S(get(nw, 'rmcc')));
set('rmnc',            S(get(nw, 'rmnc')));

// --- sygnal LTE ------------------------------------------------------------

set('lte_rsrp', S(get(nw, 'lte_rsrp')));
set('lte_rsrq', S(get(nw, 'lte_rsrq')));
set('lte_rssi', S(get(nw, 'lte_rssi')));
set('lte_snr',  S(get(nw, 'lte_snr')));

// Krotkie nazwy z goformu (zapas dla MF297D) tylko wtedy, gdy niosa pomiar -
// patrz Snz(): MC7510 trzyma tu zera przy wypelnionych polach dlugich.
set('rssi', Snz(get(nw, 'rssi')));

set('lte_pci', S(get(nw, 'lte_pci')));
set('cell_id', S(get(nw, 'cell_id')));

set('wan_active_channel', S(get(nw, 'wan_active_channel')));
set('wan_active_band',    S(get(nw, 'wan_active_band')));

// `lte_band` NIE JEST PRZEPISYWANE.
//
// Na goformie to pasmo nosnej glownej i widok robi z niego "B" + wartosc.
// Na MC7510 pod ta sama nazwa siedzi LISTA PASM WLACZONYCH w ustawieniach
// ("1,3,8,20,38") - przepisane dalej daloby pasmo "B1,3,8,20,38". Pasmo nosnej
// glownej bierzemy z `lteca` (patrz nizej), gdzie jest jednoznaczne.

// --- agregacja nosnych (CA) ------------------------------------------------
//
// `lteca` to nosne rozdzielone ';', kazda jako "PCI,pasmo,LAC,EARFCN,szerokosc";
// PIERWSZY wpis to nosna glowna.
//
// Uklad odczytany z danych, nie z dokumentacji, i zgodny arytmetycznie:
//
//   lteca = "259,1,53711,75,15.0;259,3,2,1725,15.0;307,20,2,6200,10.0"
//            \_ PCell: PCI 259, B1, LAC 53711, EARFCN 75, 15 MHz
//
//   - PCI 259, EARFCN 75 i LAC 53711 z pierwszego wpisu zgadzaja sie z osobnymi
//     polami lte_pci, wan_active_channel i lac_code;
//   - numery pasm zgadzaja sie z zakresami EARFCN wg 3GPP TS 36.101:
//     75 -> B1 (0-599), 1725 -> B3 (1200-1949), 6200 -> B20 (6150-6449).
//
// Trzecie pole jest LAC-iem tylko dla nosnej glownej; dla dodatkowych stoi tam
// "2" (te same 2 przy obu nosnych i przy kolejnych probkach). Nie zgadujemy, co
// znaczy - widok go nie potrzebuje, wiec w miejscu goformowego pola
// nieznanego przeznaczenia zapisujemy 0.

let ca = items(get(nw, 'lteca'));

if (length(ca) > 0) {
	let p = fields(ca[0]);

	if (length(p) >= 5) {
		set('lte_ca_pcell_band',      p[1]);
		set('lte_ca_pcell_freq',      p[3]);
		set('lte_ca_pcell_bandwidth', p[4]);

		// Zapas dla bwOf() w widoku, ktory przy pustym lte_ca_pcell_bandwidth
		// czyta tekstowe `bandwidth` ("15MHz"). Trzymamy oba, tak jak MC888.
		set('bandwidth', p[4] + 'MHz');
	}

	// Nosne dodatkowe w ukladzie goformu: "idx,PCI,?,pasmo,EARFCN,szerokosc".
	let scc = [];

	for (let i = 1; i < length(ca); i++) {
		let f = fields(ca[i]);
		if (length(f) < 5)
			continue;

		push(scc, sprintf('%d,%s,0,%s,%s,%s', i, f[0], f[1], f[3], f[4]));
	}

	if (length(scc) > 0)
		set('lte_multi_ca_scell_info', join(';', scc));
}

// Poziom sygnalu NA NOSNA DODATKOWA - `ltecasig`.
//
// Tego goform nie podaje w ogole (docs/modele.md: odpytane i puste na MC888
// i MC7010), wiec pole jest wlasne i dlatego ma prefiks '_'.
//
// Wpis to "RSRP, RSRQ,SINR,RSSI,?,?" - i dotyczy NOSNYCH DODATKOWYCH, nie
// wszystkich. Rozstrzygniete pomiarem, nie zalozeniem (cztery probki co 4 s):
//
//   lteca    = 3 nosne (B1 + B3 + B20)
//   ltecasig = 2 wpisy         <- tyle, ile nosnych DODATKOWYCH
//   lte_rsrp = -79 / -80 (PCell), a ltecasig[0] stoi stabilnie na -75.0
//             i ltecasig[1] na -71.0 - zadne nie jest pomiarem PCell.
//
// Gdyby wpisy zaczynaly sie od nosnej glownej, pierwszy musialby isc za
// lte_rsrp. Nie idzie, a liczba wpisow rowna sie liczbie nosnych dodatkowych,
// wiec ltecasig[i] opisuje SCC(i+1).
//
// Wyjscie: "RSRP,RSRQ,SINR,RSSI" na nosna, w kolejnosci SCC1, SCC2, ...
let sig = items(get(nw, 'ltecasig'));

if (length(sig) > 0) {
	let rows = [];

	for (let i = 0; i < length(sig); i++) {
		let f = fields(sig[i]);
		if (length(f) < 4)
			continue;

		push(rows, join(',', [ f[0], f[1], f[2], f[3] ]));
	}

	if (length(rows) > 0)
		set('_scell_sig', join(';', rows));
}

// `ngbr_cell_info` NIE JEST WYPELNIANE.
//
// MC7510 ma `lte_neighbor_cell`, ale podaje w nim tylko "PCI,EARFCN"
// (zlapane wypelnione raz na cztery probki: "258,75" przy komorce obslugujacej
// PCI 259 na EARFCN 75; ten sam uklad co w `nr_neighbor_cell` = "464,640704"
// przy nr5g_pci 463 i nr5g_action_channel 640704).
//
// Goformowe `ngbr_cell_info` to "EARFCN,PCI,RSRQ,RSRP,RSSI" - inna kolejnosc
// i, co wazniejsze, Z POZIOMAMI. Cala wartosc tabeli sasiadow w widoku to
// kolumna Δ (odstep RSRP od komorki obslugujacej), ktorej z PCI i EARFCN
// policzyc nie sposob. Przepisanie samych dwoch pol dalo by wiersze bez RSRP,
// odsiewane i tak przez neighbourRows() - wiec zostaje pusto, a nie "prawie".

// --- sygnal 5G NR ----------------------------------------------------------

set('Z5g_rsrp', S(get(nw, 'nr5g_rsrp')));
set('Z5g_rsrq', S(get(nw, 'nr5g_rsrq')));
set('Z5g_SINR', S(get(nw, 'nr5g_snr')));

set('nr5g_pci',            S(get(nw, 'nr5g_pci')));
set('nr5g_action_band',    S(get(nw, 'nr5g_action_band')));
set('nr5g_action_channel', S(get(nw, 'nr5g_action_channel')));
set('nr5g_bandwidth',      S(get(nw, 'nr5g_bandwidth')));

// Cell ID komorki NR - z odsianiem wartownika.
//
// MC7510 przy zestawionym ENDC oddaje nr5g_cell_id = 268435455, czyli 0xFFFFFFF:
// same jedynki na 28 bitach NR CI. To "nieznane", a nie numer komorki - modem
// w NSA nie zawsze dostaje pelna tozsamosc komorki 5G. Bez odsiania widok
// pokazywalby 268435455 jako prawdziwy identyfikator.
let nrcid = S(get(nw, 'nr5g_cell_id'));
if (nrcid != '' && nrcid != '268435455')
	set('Z5g_CELL_ID', nrcid);

// --- polaczenie ------------------------------------------------------------
//
// Adresy bierzemy z get_wwaniface, a NIE z web_api_telus_para_get: telus
// PRZYCINA adresy IPv6 do 31 znakow ("2a00:0f44:0cf1:391b:72f0:7c4b:f" zamiast
// "...:f39f:988c"), wiec adres stamtad jest nieprawdziwy.

set('wan_ipaddr',      Sip(get(iface, 'ipv4_address')));
set('ipv6_wan_ipaddr', Sip(get(iface, 'ipv6_address')));

// APN i typ PDP z profilu APN. Bierzemy profil wlaczony, a przy braku - pierwszy.
let table = get(apn, 'cid_table') ?? {};
let list  = get(table, 'apnListArray') ?? [];

if (type(list) == 'array' && length(list) > 0) {
	let prof = list[0];

	for (let i = 0; i < length(list); i++) {
		if (get(list[i], 'isEnable')) {
			prof = list[i];
			break;
		}
	}

	set('wan_apn', S(get(prof, 'wanapn')));

	// pdpType jest liczba; nazwy jak w panelu modemu.
	let pdp = { '1': 'IPv4', '2': 'IPv4v6', '3': 'IPv6' };
	set('pdp_type', pdp[S(get(prof, 'pdpType'))] ?? '');
}

// --- transfer --------------------------------------------------------------
//
// `month_*` chodzi wg cyklu rozliczeniowego modemu, `real_*` zeruje sie przy
// zestawieniu sesji - dokladnie tak, jak goformowe monthly_* i realtime_*.

set('monthly_rx_bytes',  S(get(tr, 'month_rx_bytes')));
set('monthly_tx_bytes',  S(get(tr, 'month_tx_bytes')));
set('realtime_rx_bytes', S(get(tr, 'real_rx_bytes')));
set('realtime_tx_bytes', S(get(tr, 'real_tx_bytes')));
set('realtime_rx_thrpt', S(get(tr, 'real_rx_speed')));
set('realtime_tx_thrpt', S(get(tr, 'real_tx_speed')));
set('realtime_time',     S(get(tr, 'real_time')));

// --- limit transferu pilnowany przez modem ---------------------------------
//
// get_wwandst_monthlimit: enable 0/1, type 1 = czas / 2 = dane, value = prog,
// ratio = zuzycie w procentach, overflow = przekroczony.
//
// ⚠️ Jednostka `value` jest NIESPRAWDZONA: na jedynym dostepnym MC7510 limit
// jest wylaczony i pole stoi na 0, wiec nie ma czego skalibrowac. Przyjmujemy
// BAJTY - tak traktuje to pole konsolowy odczyt tego samego API - i zapisujemy
// je w goformowym kodowaniu "<liczba>_<jednostka w MB>" z jednostka 1 B, zeby
// limitBytes() w widoku wylozylo z tego dokladnie te same bajty.
//
// Sekcja limitu w widoku powstaje tylko przy wlaczonym limicie na DANE, wiec
// przy niesprawdzonej jednostce i tak nic sie nie pokazuje, dopoki uzytkownik
// limitu nie ustawi.

set('data_volume_limit_switch', S(get(lim, 'enable')));

let ltype = S(get(lim, 'type'));
if (ltype != '')
	set('data_volume_limit_unit', (ltype == '1') ? 'time' : 'data');

let lval = +S(get(lim, 'value'));
if (lval > 0)
	set('data_volume_limit_size', sprintf('%J_1', lval / 1048576));

printf('%J\n', out);
