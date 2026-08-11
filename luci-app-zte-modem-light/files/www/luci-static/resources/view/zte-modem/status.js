'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require ui';
'require uci';

var callStatus = rpc.declare({ object: 'zte-modem', method: 'status' });
var callProbe  = rpc.declare({ object: 'zte-modem', method: 'probe'  });

var COLORS = { good: '#4caf50', ok: '#ff9800', poor: '#e53935' };

/* Czterostopniowa skala jakosci sygnalu.
 *
 * `steps` jest uporzadkowane malejaco i wygrywa PIERWSZY pasujacy prog, wiec
 * przedzialy sa rozlaczne z definicji. (W 3ginfo-lite, skad wziety jest pomysl
 * nazwanych poziomow, warunki zachodzily na siebie - np. dla RSRQ zarowno
 * `>= -10` jak i `>= -15 && <= -9` lapaly wartosc -10.)
 *
 * `from: null` = kosz na wszystko ponizej; min/max sluza tylko do dlugosci paska.
 */
var TIERS = {
	rsrp: { min: -130, max: -60, steps: [
		{ from:  -80, label: _('Doskonały'),     color: '#4caf50' },
		{ from:  -90, label: _('Dobry'),         color: '#8bc34a' },
		{ from: -100, label: _('Średni'),        color: '#ff9800' },
		{ from: null, label: _('Skraj komórki'), color: '#e53935' }
	] },
	rsrq: { min: -25, max: -3, steps: [
		{ from:  -10, label: _('Doskonały'),     color: '#4caf50' },
		{ from:  -15, label: _('Dobry'),         color: '#8bc34a' },
		{ from:  -20, label: _('Średni'),        color: '#ff9800' },
		{ from: null, label: _('Skraj komórki'), color: '#e53935' }
	] },
	sinr: { min: -10, max: 30, steps: [
		{ from:   20, label: _('Doskonały'),     color: '#4caf50' },
		{ from:   13, label: _('Dobry'),         color: '#8bc34a' },
		{ from:    1, label: _('Średni'),        color: '#ff9800' },
		{ from: null, label: _('Skraj komórki'), color: '#e53935' }
	] },
	rssi: { min: -110, max: -40, steps: [
		{ from:  -65, label: _('Doskonały'),     color: '#4caf50' },
		{ from:  -75, label: _('Dobry'),         color: '#8bc34a' },
		{ from:  -85, label: _('Średni'),        color: '#ff9800' },
		{ from: null, label: _('Skraj komórki'), color: '#e53935' }
	] }
};

/* Rozne modele nazywaja to samo inaczej: MC888 mowi `ENDC`, MC7010 `LTE-NSA`. */
var NETWORK_TYPES = {
	'ENDC':     '5G NSA (ENDC)',
	'LTE-NSA':  '5G NSA',
	'NR5G':     '5G SA',
	'nr5g':     '5G SA',
	'LTE':      'LTE',
	'LTE_CA':   'LTE + agregacja',
	'WCDMA':    '3G',
	'NO':       'brak zasiegu'
};

function num(v) {
	if (v === undefined || v === null || v === '') return null;
	var n = parseFloat(String(v).replace(',', '.'));
	return isNaN(n) ? null : n;
}

function txt(v) {
	return (v === undefined || v === null || v === '') ? '–' : String(v);
}

/* Jednostki IEC, nie SI. Panel modemu liczy binarnie, ale etykietuje "GB"/"TB"
   - my liczymy tak samo, a piszemy GiB/TiB, zeby liczba i jednostka mowily to
   samo. */
function bytes(v) {
	var n = num(v);
	if (n === null) return '–';
	var u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return n.toFixed(i ? 2 : 0) + ' ' + u[i];
}

function quality(kind, v) {
	var t = TIERS[kind], n = num(v);
	if (!t || n === null) return null;

	var step = t.steps[t.steps.length - 1];
	for (var i = 0; i < t.steps.length; i++) {
		if (t.steps[i].from === null || n >= t.steps[i].from) {
			step = t.steps[i];
			break;
		}
	}

	return {
		value: n,
		pct: Math.max(0, Math.min(100, (n - t.min) / (t.max - t.min) * 100)),
		label: step.label,
		color: step.color
	};
}

/* Uzywa natywnego .cbi-progressbar z LuCI - motyw renderuje `title` jako
   etykiete NAD paskiem (`::before { content: attr(title) }`), wiec wartosc
   i ocena jakosci trafiaja tam zamiast do osobnego diva. */
/* Zwraca null, gdy modem nie podaje tej metryki. Modele roznia sie zakresem pol
 * (MC7010 nie raportuje RSRQ dla 5G NR, MC888 raportuje), a pusty pasek "brak
 * danych" sugerowalby awarie zamiast braku wsparcia w firmwarze. */
function metric(label, kind, value, unit) {
	var q = quality(kind, value);
	if (!q) return null;

	var caption = q.value + (unit ? ' ' + unit : '') + ' · ' + q.label;

	return E('div', {
		'style': 'flex:1 1 190px;min-width:190px;padding:10px 12px 6px;' +
		         'border:1px solid var(--border-color-low,#ccc);border-radius:6px'
	}, [
		E('div', { 'style': 'font-size:.85em;opacity:.75' }, label),
		E('div', { 'class': 'cbi-progressbar', 'title': caption },
			E('div', { 'style': 'width:' + q.pct.toFixed(0) + '%;background:' + q.color }))
	]);
}

/* Przy kodowaniu szesnastkowym pokazujemy obok wartosc dziesietna (ECI), bo to
 * nia posluguje sie btsearch i wiekszosc narzedzi.
 *
 * Swiadomie BEZ odnosnika: stary glaboki link `szukaj.php?mode=std&search=` nie
 * dziala - btsearch jest dzis SPA i kazdy adres zwraca ten sam szkielet HTML.
 * Identyfikacje masztu robi backend przez /api/v1/search, a wynik pokazuje
 * sekcja "Stacja bazowa" nizej.
 *
 * Kodowanie jest per POLE, nie per urzadzenie: `cell_id` jest szesnastkowe na
 * wszystkich sprawdzonych modelach, ale PCI juz nie (MF79U podaje dziesietnie).
 * Rozstrzyga backend i oglasza wynik w `_pci_base`.
 *
 * PCI przyjeto podawac dziesietnie (zakres 0-503), stad taka kolejnosc.
 */
function pciHex(st) {
	return (st && st._pci_base) ? (st._pci_base === 'hex') : true;
}

function cellHex(st) {
	return (st && st._cell_base) ? (st._cell_base === 'hex') : true;
}

function pci(v, hex) {
	if (!v) return '–';
	if (hex === false) return txt(v);
	var dec = parseInt(String(v), 16);
	if (isNaN(dec)) return txt(v);
	return dec + ' (0x' + String(v).toLowerCase() + ')';
}

function cellId(v, hex) {
	if (!v) return '–';
	if (hex === false) return txt(v);
	var dec = parseInt(String(v), 16);
	if (isNaN(dec)) return txt(v);

	return v + ' (' + dec + ')';
}

/* eNodeB wyprowadzamy z ECI (górne bity), zamiast ufac polu `enodeb_id`:
 * MF79U wstawia tam KOPIE cell_id, wiec pokazywalby numer komorki jako numer
 * stacji. Na MC888/MC7010 wyliczona wartosc zgadza sie z tym, co modem podaje
 * sam (0x21ab417 >> 8 = 0x21ab4). Przy okazji widac numer sektora. */
function enodeb(cid, hex) {
	var eci = (hex === false) ? parseInt(String(cid || ''), 10)
	                          : parseInt(String(cid || ''), 16);
	if (isNaN(eci)) return null;
	var enb = Math.floor(eci / 256), sec = eci % 256;
	return enb + (hex === false ? '' : ' (0x' + enb.toString(16) + ')') +
	       '  ·  ' + _('sektor') + ' ' + sec;
}

/* Te same wielkosci pod roznymi nazwami: MC888 wypelnia `lte_snr` / `lte_rssi`,
 * MF297D zostawia je puste i podaje `sinr` / `rssi`. Bierzemy pierwsza niepusta. */
function snrOf(st) {
	var v = num(st.lte_snr);
	return (v !== null) ? v : num(st.sinr);
}

/* RSSI: MF297D gubi znak. W ciagu osmiu kolejnych probek zwrocil raz "-69",
 * a poza tym "67" i "71" - ta sama wielkosc, raz ze znakiem, raz bez. RSSI w
 * LTE jest zawsze ujemne (praktyczny zakres -110..-40 dBm), wiec normalizujemy
 * do -|v|. Dla poprawnie podpisanego `lte_rssi` ("-73") to operacja pusta. */
function rssiOf(st) {
	var v = num(st.lte_rssi);
	if (v === null) v = num(st.rssi);
	return (v === null) ? null : -Math.abs(v);
}

function infoTable(rows) {
	return E('table', { 'class': 'table', 'style': 'margin-top:.5em' },
		rows.filter(function(r) { return r !== null; }).map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'width:45%;opacity:.75' }, r[0]),
				E('td', { 'class': 'td left' }, r[1])
			]);
		}));
}

/* Dane masztu z btsearch.pl (dopasowane po Cell ID przez backend).
   Zwraca tablice wezlow albo null, gdy nic nie wiadomo. */
function station(st) {
	if (!st._bts_station && !st._bts_city)
		return null;

	var rows = [
		st._bts_operator ? [_('Operator'),    txt(st._bts_operator)] : null,
		st._bts_station  ? [_('Stacja'),      txt(st._bts_station)]  : null,
		st._bts_city     ? [_('Miejscowość'), txt(st._bts_city)]     : null,
		st._bts_address  ? [_('Adres'),       txt(st._bts_address)]  : null
	];

	if (st._bts_lat && st._bts_lon) {
		var ll = st._bts_lat + '/' + st._bts_lon;
		rows.push([_('Współrzędne'), E('a', {
			'href': 'https://www.openstreetmap.org/?mlat=' + st._bts_lat +
			        '&mlon=' + st._bts_lon + '#map=16/' + ll,
			'target': '_blank',
			'rel': 'noopener noreferrer'
		}, st._bts_lat + ', ' + st._bts_lon + ' — ' + _('pokaż na mapie'))]);
	}

	return [
		E('h4', { 'style': 'margin:1.2em 0 .3em' }, _('Stacja bazowa')),
		infoTable(rows),
		E('div', { 'style': 'font-size:.8em;opacity:.6;margin-top:.3em' },
			_('Dane z btsearch.pl (wykaz pozwoleń radiowych UKE), dopasowane po Cell ID.'))
	];
}

/* Tabela agregacji nosnych (CA).
 *
 * PCell: lte_ca_pcell_band / _bandwidth, EARFCN z lte_ca_pcell_freq
 *        (lte_ca_pcell_arfcn bywa zawsze puste - na MC7010 i MC888 wlasnie tak jest).
 * SCell: lte_multi_ca_scell_info - nosne rozdzielone ';', kazda to
 *        "idx,PCI,?,pasmo,EARFCN,szerokosc".
 *
 * Ukladu pol nie zgadywalem: dla MC888 pierwsza nosna dodatkowa ma PCI 334
 * i EARFCN 3025, a btsearch ma dla tej samej stacji komorke dokladnie
 * z `pci=334, earfcn=3025`. Zgadza sie tez zakres EARFCN z numerem pasma
 * (1348 -> B3 1200-1949; 3050 -> B7 2750-3449).
 *
 * UWAGA na niespojnosc: `lte_pci` (PCell) jest SZESNASTKOWE, ale PCI w
 * lte_multi_ca_scell_info jest DZIESIETNE.
 *
 * lte_ca_scell_band/_bandwidth pokazuje tylko PIERWSZA nosna dodatkowa -
 * sluzy wylacznie jako zapas dla firmware'ow bez lte_multi_ca_scell_info.
 */
/* Szerokosc kanalu -> liczba blokow zasobow (RB) wg tabeli LTE. */
var RB_PER_MHZ = { '1.4': 6, '3': 15, '5': 25, '10': 50, '15': 75, '20': 100 };

function rbFor(bw) {
	var n = num(bw);
	if (n === null) return 0;
	var key = (Math.abs(n - 1.4) < 0.05) ? '1.4' : String(Math.round(n));
	return RB_PER_MHZ[key] || 0;
}

/* Sufit warstwy fizycznej.
 *
 * Jeden RB to 12 podnosnych x 14 symboli = 168 elementow zasobow na ms;
 * ~25% zjada narzut (sygnaly referencyjne, PDCCH, synchronizacja), zostaje 126.
 *
 * Zalozenia 64QAM (6 bitow) i 2 strumienie sa PODANE WPROST w opisie, bo modem
 * nie udostepnia modulacji ani MIMO - pola cqi/dl_mcs/rank/mimo/lte_category
 * wracaja puste. To maksimum teoretyczne, nie prognoza: pomiar na MC7010 dal
 * 83 Mb/s przy sufitcie 378 Mb/s, czyli 22%.
 *
 * Swiadomie NIE liczymy tu szacunku z SINR. Pole `lte_snr` z ZTE nie jest
 * efektywnym SINR-em po equalizacji - oszacowanie z podrecznikowej krzywej
 * wyszlo 6,4x ponizej zmierzonej wartosci.
 */
function ceiling(rb) {
	return rb * 126 * 6 * 2 / 1000;   /* Mb/s */
}

/* Zakresy DL EARFCN wg 3GPP TS 36.101 - tyle pasm, ile realnie spotykamy w PL/LT.
 * Sluzy do wyznaczenia pasma, gdy modem go nie podaje ALBO podaje blednie. */
var EARFCN_BANDS = [
	[0,     599,   1], [600,   1199,  2], [1200,  1949,  3], [1950,  2399,  4],
	[2400,  2649,  5], [2750,  3449,  7], [3450,  3799,  8], [5010,  5179, 12],
	[5180,  5279, 13], [6150,  6449, 20], [8690,  9039, 26], [9210,  9659, 28],
	[9770,  9869, 32], [37750, 38249, 38], [38650, 39649, 40], [39650, 41589, 41],
	[41590, 43589, 42]
];

function bandFromEarfcn(v) {
	var e = num(v);
	if (e === null) return null;
	for (var i = 0; i < EARFCN_BANDS.length; i++)
		if (e >= EARFCN_BANDS[i][0] && e <= EARFCN_BANDS[i][1])
			return String(EARFCN_BANDS[i][2]);
	return null;
}

function earfcnOf(st) {
	return st.lte_ca_pcell_freq || st.wan_active_channel || st.lte_ca_pcell_arfcn || '';
}

/* Pasmo nosnej glownej. Kolejnosc zrodel nie jest przypadkowa:
 *
 * `lte_ca_pcell_band` i `lte_band` sa wiarygodne (na MC888/MC7010 zgadzaja sie
 * z EARFCN-em), ale bez agregacji bywaja puste. Dopiero potem wyliczamy pasmo
 * z EARFCN-a - i to WYPRZEDZA `wan_active_band`, bo to pole potrafi klamac:
 * MF79U raportuje "LTE BAND 1" zarowno przy EARFCN 1875 (B3), jak i 9460 (B28),
 * a zakres B1 to 0-599, wiec zadna z tych wartosci nie jest B1. EARFCN to
 * indeks fizycznej czestotliwosci, wiec jest rozstrzygajacy.
 */
function bandOf(st) {
	if (st.lte_ca_pcell_band) return String(st.lte_ca_pcell_band);
	if (st.lte_band)          return String(st.lte_band);

	var b = bandFromEarfcn(earfcnOf(st));
	if (b) return b;

	var m = String(st.wan_active_band || '').match(/(\d+)/);
	return m ? m[1] : null;
}

/* Szerokosc nosnej glownej. `lte_ca_pcell_bandwidth` to liczba ("15.0"), ale bez
 * agregacji potrafi byc puste; `bandwidth` to tekst ("15MHz") i jest wypelnione
 * zawsze. Bez tego zapasu przy jednej nosnej nie da sie policzyc ani lacznej
 * szerokosci, ani sufitu.
 */
function bwOf(st) {
	var n = num(st.lte_ca_pcell_bandwidth);
	if (n !== null) return n;
	var m = String(st.bandwidth || '').match(/([\d.]+)/);
	return m ? num(m[1]) : null;
}

/* PCI nosnej glownej sprowadzone do LICZBY dziesietnej, wg kodowania wykrytego
   przez backend. Osobno, bo posluguje sie tym takze tabela sasiadow - PCI
   wewnatrz lte_multi_ca_scell_info i ngbr_cell_info jest DZIESIETNE niezaleznie
   od tego, w czym modem podaje `lte_pci`. */
function pcellPciDec(st) {
	if (!st.lte_pci) return null;
	var d = parseInt(String(st.lte_pci), pciHex(st) ? 16 : 10);
	return isNaN(d) ? null : d;
}

function carrierRows(st) {
	var rows = [];

	var pband = bandOf(st), pbw = bwOf(st);
	if (pband || pbw !== null)
		rows.push({
			name:   'PCell',
			band:   pband ? 'B' + pband : '–',
			bw:     pbw,
			earfcn: txt(earfcnOf(st)),
			pci:    (pcellPciDec(st) !== null) ? String(pcellPciDec(st)) : txt(st.lte_pci)
		});

	if (st.lte_multi_ca_scell_info) {
		/* MC888 potrafi zameldowac NOSNA GLOWNA DRUGI RAZ jako SCell - potwierdzone
		 * w trzech probkach co 5 s (2026-08-08):
		 *
		 *   lte_pci = 1a3 (419), lte_ca_pcell_freq = 3125, lte_ca_pcell_band = 7
		 *   lte_multi_ca_scell_info = "...;3,419,1,7,3125,15.0"
		 *                                 ^^^^^^^^^^^^^^ ta sama komorka
		 *
		 * Bez odsiania widok pokazywal te sama nosna dwa razy, meldowal 4xCA zamiast
		 * 3xCA i doliczal 15 MHz, ktorych nie ma - wraz z zawyzonym o 43% sufitem
		 * teoretycznym (378 zamiast 265 Mb/s).
		 *
		 * Ten sam PCI i ten sam EARFCN co PCell = ta sama komorka; nosna nie moze
		 * byc agregowana sama ze soba, wiec odrzucenie jest bezpieczne.
		 */
		var pPci = pcellPciDec(st), pEarfcn = num(earfcnOf(st));

		String(st.lte_multi_ca_scell_info).split(';').forEach(function(part) {
			var f = part.split(',');
			if (f.length < 6) return;

			if (pPci !== null && pEarfcn !== null &&
			    num(f[1]) === pPci && num(f[4]) === pEarfcn)
				return;

			rows.push({ name: 'SCC' + f[0], band: 'B' + f[3], bw: num(f[5]),
			            earfcn: f[4], pci: f[1] });
		});
	} else if (num(st.lte_ca_scell_band)) {
		/* Uwaga na `num()`: MF297D przy WYLACZONEJ agregacji zwraca
		   lte_ca_scell_band "0" i _bandwidth "0.0" - jako lancuchy sa prawdziwe,
		   wiec zwykly test dorzucalby widmowa nosna "B0, 0.0 MHz". */
		rows.push({ name: 'SCC1', band: 'B' + st.lte_ca_scell_band,
		            bw: num(st.lte_ca_scell_bandwidth), earfcn: '–', pci: '–' });
	}

	return rows;
}

function carriers(st) {
	var rows = carrierRows(st);

	if (!rows.length)
		return E('div', {});

	var total = rows.reduce(function(a, r) { return a + (r.bw || 0); }, 0);
	var rb    = rows.reduce(function(a, r) { return a + rbFor(r.bw); }, 0);

	var head = E('tr', { 'class': 'tr table-titles' },
		[_('Nośna'), _('Pasmo'), _('Szerokość'), 'EARFCN', 'PCI'].map(function(h) {
			return E('th', { 'class': 'th left' }, h);
		}));

	var body = rows.map(function(r) {
		var cells = [r.name, r.band,
		             r.bw !== null ? r.bw.toFixed(1) + ' MHz' : '–',
		             r.earfcn, r.pci];
		return E('tr', { 'class': 'tr' }, cells.map(function(c) {
			return E('td', { 'class': 'td left' }, String(c));
		}));
	});

	/* Szerokosc kanalu bywa nieznana: `bandwidth` ma tylko czesc modeli, a pola
	   lte_ca_* potrafia byc puste. Wtedy nadal pokazujemy pasma - milczace
	   zniknicie calej sekcji wygladalo jak usterka modulu. */
	var unknown = rows.filter(function(r) { return r.bw === null; }).length;
	var caText  = rows.length > 1 ? rows.length + '×CA' : _('bez agregacji');

	var summary = (total > 0)
		? ((rows.length > 1 ? _('Łączna szerokość') : _('Szerokość')) + ': ' +
		   total.toFixed(1) + ' MHz  ·  ' + caText + (rb ? '  ·  ' + rb + ' RB' : '') +
		   (unknown ? '  ·  ' + _('bez %d nośnych o nieznanej szerokości').format(unknown) : ''))
		: (caText + '  ·  ' + _('modem nie podał szerokości kanału'));

	var ceilingNode = (rb > 0)
		? E('div', { 'style': 'font-size:.85em;opacity:.7' }, [
			(unknown ? _('Sufit teoretyczny (częściowy)') : _('Sufit teoretyczny')) +
				': ~' + Math.round(ceiling(rb)) + ' Mb/s ',
			E('span', {
				'style': 'opacity:.8;cursor:help',
				'title': _('Maksimum warstwy fizycznej przy założeniu 64QAM i 2 strumieni MIMO. ' +
				           'Modem nie podaje modulacji ani MIMO, więc to górne ograniczenie, ' +
				           'a nie prognoza — realny transfer bywa rzędu 20–30% tej wartości.')
			}, _('(64QAM 2×2, wartość graniczna)'))
		])
		: E('div', { 'style': 'font-size:.85em;opacity:.55' },
			_('Sufit teoretyczny: nie do policzenia — ten model nie podaje szerokości kanału.'));

	return E('div', {}, [
		E('table', { 'class': 'table', 'style': 'margin-top:.5em' }, [head].concat(body)),
		E('div', { 'style': 'font-size:.85em;opacity:.7;margin-top:.3em' }, summary),
		ceilingNode
	]);
}

/* Komorki sasiednie - `ngbr_cell_info`.
 *
 *   "3125,419,-11,-100,-66;3125,418,-18,-107,-80;3125,136,-15,-105,-81"
 *     │    │   │   │    └ RSSI [dBm]
 *     │    │   │   └────── RSRP [dBm]
 *     │    │   └────────── RSRQ [dB]
 *     │    └────────────── PCI (DZIESIETNIE, jak w lte_multi_ca_scell_info)
 *     └─────────────────── EARFCN
 *
 * Uklad odczytany z danych dwoch modemow, nie z dokumentacji: na MC888 pierwszy
 * wpis ma PCI 419 i EARFCN 3125, co zgadza sie z `lte_pci` (0x1a3) i
 * `lte_ca_pcell_freq`; na MC7010 tak samo dla PCI 123 (0x7b) i EARFCN 6275.
 *
 * Komorke obslugujaca rozpoznajemy PO WARTOSCIACH, nie po pozycji. Pierwszy wpis
 * pasuje na obu sprawdzonych modemach, ale dopasowanie po PCI i EARFCN nie
 * wywroci sie na firmwarze, ktory posortuje liste inaczej.
 */
function neighbourRows(st) {
	if (!st.ngbr_cell_info) return [];

	var servPci    = pcellPciDec(st);
	var servEarfcn = num(earfcnOf(st));

	return String(st.ngbr_cell_info).split(';').map(function(part) {
		var f = part.split(',');
		if (f.length < 5) return null;

		var earfcn = num(f[0]), pci = num(f[1]), rsrp = num(f[3]);
		if (earfcn === null || pci === null || rsrp === null) return null;

		return {
			earfcn:  earfcn,
			pci:     pci,
			rsrq:    num(f[2]),
			rsrp:    rsrp,
			rssi:    num(f[4]),
			serving: (servPci !== null && pci === servPci &&
			          servEarfcn !== null && earfcn === servEarfcn),
			cochan:  (servEarfcn !== null && earfcn === servEarfcn)
		};
	}).filter(function(r) { return r !== null; });
}

/* Tabela sasiadow. Swiadomie NIE liczymy tu sumy zaklocen ani SINR-u z RSRP
 * sasiadow: rachunek S-I rozjezdza sie ze zmierzonym `lte_snr` o 12,5 dB na
 * MC888 (0,9 dB wyliczone przy 13,4 dB zmierzonych). Widac dlaczego - PCI
 * 417/418/419 to kolejne numery, czyli sektory TEGO SAMEGO masztu; trafiaja na
 * liste sasiadow, ale nie zaklocaja jak obcy nadajnik. Odrzucenie ich z sumy
 * tez nie ratuje rachunku (3,8 dB przy 13,4 dB).
 *
 * Zostaje odstep `Δ` od komorki obslugujacej - wielkosc, ktora realnie
 * maksymalizuje sie obracajac antene, i ktora nic nie obiecuje ponad dane.
 *
 * RSSI jest rozbierane, ale nie pokazywane - przy strojeniu liczy sie RSRP
 * i odstep, a szesc kolumn miesci sie bez zawijania.
 */
function neighbours(st) {
	var rows = neighbourRows(st);
	if (!rows.length) return null;

	var serv = rows.filter(function(r) { return r.serving; })[0] || null;
	var cochan = rows.filter(function(r) { return r.cochan && !r.serving; });

	/* Najsilniejszy zaklocacz co-channel = najmniejszy odstep, czyli najwyzsze RSRP. */
	var worst = cochan.length
		? cochan.reduce(function(a, r) { return r.rsrp > a.rsrp ? r : a; })
		: null;

	/* Wyrozniamy go WARUNKOWO - tylko gdy jest nie dalej niz 10 dB pod komorka
	 * obslugujaca. Bezwarunkowe podswietlanie "najsilniejszego" zawsze cos
	 * oznacza, takze gdy jedyny sasiad siedzi 25 dB nizej i jest bez znaczenia;
	 * kolor niosl by wtedy falszywy alarm.
	 *
	 * 10 dB to prog czytelnosci ("na tyle blisko, ze konkuruje"), a NIE wyliczenie
	 * z fizyki - patrz komentarz wyzej: odstepy z tego pola nie odtwarzaja
	 * `lte_snr`, wiec zaden prog stad wyprowadzony nie bylby uczciwy.
	 *
	 * Przy obracaniu anteny wyroznienie bedzie przeskakiwac miedzy wierszami,
	 * bo dominujacy zaklocacz sie zmienia. To jest cel, nie usterka.
	 */
	var dominant = (serv && worst && (serv.rsrp - worst.rsrp) <= 10) ? worst : null;

	/* Kolejnosc kolumn wspolnych z tabela nosnych (Pasmo -> EARFCN -> PCI) jest
	   CELOWO taka sama - obie tabele stoja na tej samej zakladce jedna pod druga
	   i przy strojeniu anteny wodzi sie po nich wzrokiem naprzemiennie. Metryki
	   sasiada dopisane na koncu, bo w tabeli nosnych nie maja odpowiednika. */
	var head = E('tr', { 'class': 'tr table-titles' },
		[_('Pasmo'), 'EARFCN', 'PCI', 'RSRP', 'RSRQ', 'Δ'].map(function(h) {
			return E('th', { 'class': 'th left' }, h);
		}));

	var body = rows.map(function(r) {
		var band  = bandFromEarfcn(r.earfcn);
		var delta = serv ? (r.rsrp - serv.rsrp) : null;

		/* Znacznik slowny obok koloru - na samym kolorze nie wolno opierac
		   jedynego sygnalu (daltonizm, wydruk, ciemny motyw). */
		var tag = r.serving  ? '  ·  ' + _('obsługująca')
		        : (r === dominant ? '  ·  ' + _('dominujący') : '');

		var cells = [
			band ? 'B' + band : '–',
			String(r.earfcn),
			r.pci + tag,
			r.rsrp + ' dBm',
			r.rsrq !== null ? r.rsrq + ' dB' : '–',
			r.serving ? '—' : (delta !== null ? delta.toFixed(0) + ' dB' : '–')
		];

		/* Bez pogrubiania wierszy. Znacznik slowny w kolumnie PCI mowi to samo
		   wprost, a pogrubienie w tabeli, gdzie wyrozniony bywa co drugi wiersz
		   (komorka obslugujaca ZAWSZE, dominujacy czesto), przestaje cokolwiek
		   wyrozniac i tylko dokłada gestosci.

		   Zostaje kolor, i to na samym odstepie - to jego sie maksymalizuje
		   obracajac antene, wiec tam ma prowadzic wzrok. */
		return E('tr', { 'class': 'tr' }, cells.map(function(c, i) {
			var style = (r === dominant && (i === 2 || i === 5))
				? 'color:' + COLORS.poor : '';

			return E('td', { 'class': 'td left', 'style': style }, c);
		}));
	});

	var note;
	if (dominant) {
		note = _('Najsilniejszy zakłócacz co-channel') + ': PCI ' + dominant.pci + ', ' +
		       Math.abs(dominant.rsrp - serv.rsrp).toFixed(0) + ' dB ' + _('poniżej') +
		       ' — ' + _('to jego odstęp maksymalizujesz obracając antenę') + '.';
	} else if (serv && worst) {
		note = _('Najbliższy sąsiad co-channel (PCI %s) jest %s dB niżej — z zapasem.')
			.format(worst.pci, Math.abs(worst.rsrp - serv.rsrp).toFixed(0));
	} else if (!serv) {
		note = _('Komórki obsługującej nie ma na liście — odstępów nie da się policzyć.');
	} else {
		note = _('Żaden sąsiad nie nadaje na częstotliwości nośnej głównej.');
	}

	return E('div', { 'style': 'margin-top:1.2em' }, [
		E('h4', { 'style': 'margin:.3em 0 .3em' }, [
			_('Komórki sąsiednie'),
			E('span', { 'style': 'font-weight:400;font-size:.8em;opacity:.7;margin-left:.6em' },
				_('co-channel') + ': ' + cochan.length)
		]),
		E('table', { 'class': 'table', 'style': 'margin-top:.5em' }, [head].concat(body)),
		E('div', { 'style': 'font-size:.85em;opacity:.7;margin-top:.3em' }, note),
		E('div', { 'style': 'font-size:.8em;opacity:.55;margin-top:.2em' },
			_('Δ to odstęp RSRP od komórki obsługującej. Przy strojeniu anteny maksymalizuje ' +
			  'się ten odstęp, a nie samo RSRP — ale nie jest to SINR: sektory tego samego ' +
			  'masztu też trafiają na tę listę.'))
	]);
}

function block(title, children) {
	children = children.filter(function(c) { return c !== null; });
	if (!children.length) return E('div', {});

	return E('div', { 'style': 'margin-bottom:1.2em' }, [
		E('h4', { 'style': 'margin:.3em 0 .5em' }, title),
		E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px' }, children)
	]);
}

function banner(text, color) {
	return E('div', {
		'style': 'padding:8px 12px;border-radius:6px;margin-bottom:1em;' +
		         'border-left:4px solid ' + color + ';background:var(--border-color-low,#f0f0f0)'
	}, text);
}

/* --- limit transferu pilnowany przez modem --------------------------------
 *
 * `data_volume_limit_size` jest zakodowane jako "<liczba>_<jednostka w MB>":
 * "1070_1024" to 1070 x 1024 MB. Kodowania nie zgadywalem - rozstrzyga zrzut
 * z panelu modemu, ktory przy tej samej wartosci pola pisze "1.04TB":
 * 1070 x 1024 MB = 1,0449 TiB. Zgadzaja sie tez pozostale dwie liczby z panelu
 * ("148.77GB" uzyte i "0.89TB" do wykorzystania) wobec monthly_rx + monthly_tx
 * z tej samej chwili.
 *
 * Widac przy okazji, ze panel LICZY BINARNIE, a ETYKIETUJE DZIESIETNIE - dzieli
 * przez 1024 i pisze "GB". Nie powtarzamy tego: liczymy tak samo, ale piszemy
 * GiB/TiB, wiec przy resztce ponizej 1 TiB wyjdzie "921.09 GiB" tam, gdzie panel
 * pokazuje "0.89TB". Ta sama wielkosc, uczciwsza etykieta.
 */
function limitBytes(st) {
	var f = String(st.data_volume_limit_size || '').split('_');
	if (f.length < 2) return null;

	var size = num(f[0]), unit = num(f[1]);
	if (size === null || unit === null || size <= 0 || unit <= 0) return null;

	return size * unit * 1024 * 1024;
}

/* `date_month` - data najblizszego zerowania licznika, format YYYYMMDD
 * ("20260908").
 *
 * Znaczenie potwierdzone z dwoch stron, nie zalozone:
 *
 *  1. panel modemu ma "Zresetuj licznik (dzien miesiaca)" ustawione na 8,
 *     a pole pokazuje 2026-09-08 - ten sam dzien, najblizsze wystapienie;
 *  2. zegar samego modemu (naglowek `Date` jego serwera HTTP) szedl zgodnie
 *     z routerem, wiec ta data lezy w PRZYSZLOSCI, a nie jest zapisem
 *     ostatniego zerowania.
 *
 * Date z przeszlosci odrzucamy - znaczylaby, ze pole nie jest tym, czym je
 * bierzemy, a lepiej nie pokazac terminu niz pokazac miniony.
 *
 * ⚠️ Osobnego pola z samym dniem miesiaca modem NIE wystawia (sprawdzone
 * kilkanascie nazw), wiec ta data jest jedynym zrodlem terminu.
 */
function resetDate(v) {
	var m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})$/);
	if (!m) return null;

	var y = +m[1], mo = +m[2], d = +m[3];
	var dt = new Date(y, mo - 1, d);

	/* Odsiewa "20261332" i spolke - Date przewinalby to cicho na kolejny
	   miesiac i pokazalibysmy wymyslona date. */
	if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d)
		return null;

	return dt;
}

/* Termin obok pozostalej ilosci: "do 8.09.2026 (za 28 dni)". Sama ilosc nie
   mowi, czy trzeba ja rozlozyc na dwa dni, czy na miesiac. */
function until(st) {
	var dt = resetDate(st.date_month);
	if (!dt) return '';

	/* Do polnocy dnia zerowania, nie do teraz - inaczej termin "dzis" znikalby
	   juz o pierwszej w nocy. */
	var days = Math.ceil((dt - new Date()) / 86400000);
	if (days < 0) return '';

	var when = (days === 0) ? _('dziś')
	         : _('za') + ' ' + days + ' ' + (days === 1 ? _('dzień') : _('dni'));

	return '  ·  ' + _('do') + ' ' + dt.toLocaleDateString() + '  (' + when + ')';
}

/* Sekcja powstaje tylko dla limitu NA DANE i tylko wtedy, gdy modem go pilnuje.
 *
 * Bez ustawionego limitu nie ma czego pokazywac: sam licznik miesieczny to juz
 * zakladka Transfer, a ta nalezy do wersji pelnej. Modem umie tez limit CZASU
 * polaczenia (`data_volume_limit_unit` = "time") - wtedy pasek zuzycia danych
 * klamalby o tym, co jest pilnowane, wiec tez go nie ma.
 */
function dataLimit(st) {
	if (String(st.data_volume_limit_switch) !== '1') return null;

	var unit = String(st.data_volume_limit_unit || 'data');
	if (unit !== 'data') return null;

	var limit = limitBytes(st);
	if (limit === null) return null;

	var rx = num(st.monthly_rx_bytes), tx = num(st.monthly_tx_bytes);
	if (rx === null && tx === null) return null;

	var used = (rx || 0) + (tx || 0);
	var pct  = used / limit * 100;
	var left = limit - used;

	/* Prog ostrzezenia bierzemy z modemu, zamiast wymyslac wlasny - to ta sama
	   liczba, ktora modem pokazuje w panelu i wg ktorej alarmuje. */
	var alert = num(st.data_volume_alert_percent);
	if (alert === null || alert <= 0 || alert > 100) alert = 100;

	/* Wypelnienie przycinamy do 100%, ale procent w etykiecie zostaje PRAWDZIWY:
	   pasek zatrzymany na koncu bez liczby wyglada jak limit wyczerpany co do
	   bajta, a nie przekroczony. */
	var fill = Math.max(0, Math.min(100, pct));

	var bar = E('div', {
		'class': 'cbi-progressbar',
		'title': pct.toFixed(1).replace('.', ',') + '%'
	}, E('div', {
		'style': 'width:' + fill.toFixed(1) + '%;background:' +
		         (pct >= alert ? COLORS.poor : COLORS.good)
	}));

	/* Kreska progu tylko wtedy, gdy prog cokolwiek wnosi - przy 100% stanelaby
	   na krancu paska i udawala podzialke. */
	var track = (alert < 100)
		? E('div', { 'style': 'position:relative' }, [
			bar,
			E('div', {
				'style': 'position:absolute;top:0;bottom:0;left:' + alert + '%;' +
				         'width:2px;background:currentColor;opacity:.5',
				'title': _('Próg ostrzeżenia modemu') + ': ' + alert + '%'
			})
		])
		: bar;

	return E('div', { 'style': 'margin-bottom:1.2em' }, [
		E('h4', { 'style': 'margin:.3em 0 .5em' }, _('Zużycie limitu danych')),
		E('div', {
			'style': 'display:flex;flex-wrap:wrap;justify-content:space-between;' +
			         'align-items:baseline;gap:.5em 1em;margin-bottom:.3em'
		}, [
			E('span', {}, [
				E('span', { 'style': 'opacity:.75' }, _('Użyto') + ': '),
				E('span', { 'style': 'font-weight:600' }, bytes(used)),
				E('span', { 'style': 'opacity:.75' }, ' / ' + bytes(limit))
			]),
			/* Termin dotyczy tak samo przekroczenia - wtedy mowi, jak dlugo
			   jeszcze bedzie bolec. */
			E('span', { 'style': 'opacity:.75' }, ((left >= 0)
				? _('Do wykorzystania') + ': ' + bytes(left)
				: _('Przekroczono o') + ' ' + bytes(-left)) + until(st))
		]),
		track,
		E('div', { 'style': 'font-size:.8em;opacity:.6;margin-top:.3em' },
			_('Wykorzystanie jest przybliżone — liczy je modem, nie operator, ' +
			  'i zeruje wg własnego cyklu rozliczeniowego.'))
	]);
}

function renderStatus(st) {
	st = st || {};
	var out = [];

	if (st._error)
		out.push(banner(st._error, COLORS.poor));
	else if (st._authenticated === false || st._authenticated === 0)
		out.push(banner(
			_('Brak sesji na modemie — widoczne są tylko dane dostępne bez logowania.'),
			COLORS.ok));

	if (st._stale)
		out.push(banner(_('Dane nieaktualne — modem nie odpowiedział przy ostatniej próbie.'),
			COLORS.ok));

	if (st.simcard_roam && st.simcard_roam !== 'Home')
		out.push(banner(_('Karta SIM w roamingu') + ': ' + txt(st.simcard_roam), COLORS.ok));

	/* Nagłówek: operator, technologia, IP */
	var nt = st.network_type || '';
	out.push(E('div', {
		'style': 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:1.2em'
	}, [
		E('div', {
			'style': 'flex:2 1 260px;padding:12px;border-radius:6px;' +
			         'border:1px solid var(--border-color-low,#ccc)'
		}, [
			E('div', { 'style': 'font-size:1.3em;font-weight:600' }, txt(st.network_provider)),
			E('div', { 'style': 'opacity:.75' }, NETWORK_TYPES[nt] || txt(nt))
		]),
		E('div', {
			'style': 'flex:1 1 160px;padding:12px;border-radius:6px;' +
			         'border:1px solid var(--border-color-low,#ccc)'
		}, [
			E('div', { 'style': 'font-size:.85em;opacity:.75' }, _('Adres WAN')),
			E('div', { 'style': 'font-size:1.1em;font-weight:600' }, txt(st.wan_ipaddr))
		]),
		E('div', {
			'style': 'flex:1 1 120px;padding:12px;border-radius:6px;' +
			         'border:1px solid var(--border-color-low,#ccc)'
		}, [
			E('div', { 'style': 'font-size:.85em;opacity:.75' }, _('Siła sygnału')),
			E('div', { 'style': 'font-size:1.1em;font-weight:600' },
				st.signalbar ? (st.signalbar + '/5') : '–')
		])
	]));

	/* Limit transferu - nad LTE, bo dotyczy calego lacza, a nie technologii. */
	var dl = dataLimit(st);
	if (dl) out.push(dl);

	/* LTE */
	var hasLte = [num(st.lte_rsrp), num(st.lte_rsrq), rssiOf(st), snrOf(st)]
		.some(function(v) { return v !== null; });

	var hex = pciHex(st), chex = cellHex(st);

	if (hasLte) {
		out.push(block('LTE', [
			metric('RSRP', 'rsrp', st.lte_rsrp, 'dBm'),
			metric('RSRQ', 'rsrq', st.lte_rsrq, 'dB'),
			metric('RSSI', 'rssi', rssiOf(st), 'dBm'),
			metric('SNR',  'sinr', snrOf(st),  'dB')
		]));
		/* Tabela nosnych podaje juz pasmo, szerokosc, EARFCN i PCI kazdej nosnej,
		   wiec nie powtarzamy tu "Aktywne pasmo" ani PCI nosnej glownej.
		   wan_active_band zostaje wylacznie jako zapas dla modemow, ktore w ogole
		   nie raportuja pol CA (spodziewane w serii MF) - inaczej informacja
		   o pasmie zniknelaby calkiem. */
		var hasCarriers = !!(bandOf(st) || bwOf(st) !== null || st.lte_ca_scell_band);

		out.push(carriers(st));
		out.push(infoTable([
			(!hasCarriers && st.wan_active_band) ? [_('Aktywne pasmo'), txt(st.wan_active_band)] : null,
			(!hasCarriers && st.lte_pci)         ? [_('PCI'), pci(st.lte_pci, hex)] : null,
			[_('Cell ID'),            cellId(st.cell_id, chex)],
			enodeb(st.cell_id, chex) ? [_('eNodeB ID'), enodeb(st.cell_id, chex)] : null
		]));

		var nb = neighbours(st);
		if (nb) out.push(nb);
	}

	/* 5G */
	var has5g = [st.Z5g_rsrp, st.Z5g_rsrq, st.Z5g_SINR]
		.some(function(v) { return num(v) !== null; });

	if (has5g) {
		out.push(block('5G NR', [
			metric('RSRP', 'rsrp', st.Z5g_rsrp, 'dBm'),
			metric('RSRQ', 'rsrq', st.Z5g_rsrq, 'dB'),
			metric('SINR', 'sinr', st.Z5g_SINR, 'dB')
		]));
		out.push(infoTable([
			[_('Pasmo'),    txt(st.nr5g_action_band)],
			[_('Kanał'),    txt(st.nr5g_action_channel)],
			[_('PCI'),      pci(st.nr5g_pci, hex)],
			num(st.Z5g_CELL_ID) ? [_('Cell ID'), cellId(st.Z5g_CELL_ID, chex)] : null
		]));
	}

	if (!hasLte && !has5g)
		out.push(banner(_('Brak danych o sygnale — modem nie zwrócił żadnej metryki.'),
			COLORS.ok));

	var stn = station(st);
	if (stn)
		stn.forEach(function(node) { out.push(node); });

	out.push(footer(st));

	return out;
}

function footer(st) {
	var when = st._timestamp ? new Date(st._timestamp * 1000).toLocaleTimeString() : '–';
	/* Jedna aplikacja obsluguje rozne modele - warto widziec, ktory to. */
	return E('div', { 'style': 'margin-top:1em;font-size:.85em;opacity:.65' },
		(st.model_name ? st.model_name + ' · ' : '') + txt(st._host) +
		' · ' + _('firmware') + ': ' + txt(st.wa_inner_version) +
		' · ' + _('odczyt') + ': ' + when);
}

/* --- zakladka "Modem": tozsamosc urzadzenia, karty i polaczenia ------------ */

/* ICCID bywa 20-znakowe z dopelniajacym polbajtem BCD na koncu: MF297D zwraca
   "8948032552546103080F". Koncowe F nie jest cyfra numeru, wiec je ucinamy.
   MC7010 ma 20 samych cyfr, MC888 19 - tam nie ma czego ciac. */
function iccidOf(st) {
	var v = st.iccid;
	if (!v) return null;
	return String(v).replace(/[Ff]$/, '');
}

/* IMSI: `sim_imsi` jest na wszystkich trzech modemach, `imsi` dopiero na MF297D. */
function imsiOf(st) {
	return st.sim_imsi || st.imsi || null;
}

/* PLMN z rozdzielonych pol: 260-03 (Orange PL), 246-01 (Telia LT).
   MNC zwyczajowo pisze sie dwucyfrowo. */
function plmn(st) {
	if (!st.rmcc || !st.rmnc) return null;
	var mnc = String(st.rmnc);
	if (mnc.length < 2) mnc = '0' + mnc;
	return st.rmcc + '-' + mnc;
}

/* Stan modemu/karty. Mapujemy tylko wartosci potwierdzone empirycznie;
   nieznane pokazujemy SUROWO, zeby nie udawac wiedzy, ktorej nie mam. */
var MODEM_STATES = {
	'modem_init_complete': _('zarejestrowana'),
	'modem_sim_undetected': _('brak karty'),
	'modem_waiting_pin':   _('oczekuje na PIN'),
	'modem_waiting_puk':   _('oczekuje na PUK'),
	'modem_sim_destroy':   _('karta uszkodzona'),
	'modem_undetected':    _('modem niewykryty')
};

function simState(st) {
	if (!st.modem_main_state) return null;
	return MODEM_STATES[st.modem_main_state] || String(st.modem_main_state);
}

function duration(v) {
	var s = num(v);
	if (s === null || s < 0) return null;

	var d = Math.floor(s / 86400),
	    h = Math.floor(s % 86400 / 3600),
	    m = Math.floor(s % 3600 / 60);

	if (d) return d + ' ' + _('dni') + ' ' + h + ' ' + _('godz.');
	if (h) return h + ' ' + _('godz.') + ' ' + m + ' ' + _('min');
	return m + ' ' + _('min');
}

/* Sekcja powstaje tylko wtedy, gdy ma cokolwiek do pokazania - modem bez karty
   nie ma wyswietlac pustej ramki "Karta SIM". */
function infoBlock(title, rows) {
	var real = rows.filter(function(r) { return r !== null; });
	if (!real.length) return null;

	return E('div', {}, [
		E('h4', { 'style': 'margin:1.2em 0 .3em' }, title),
		infoTable(real)
	]);
}

function row(label, value) {
	return (value === undefined || value === null || value === '')
		? null : [label, String(value)];
}

function renderDevice(st) {
	st = st || {};
	var out = [];

	if (st._error)
		out.push(banner(st._error, COLORS.poor));

	var blocks = [
		infoBlock(_('Urządzenie'), [
			row(_('Model'),             st.model_name),
			row(_('Firmware'),          st.wa_inner_version),
			row(_('Wersja sprzętowa'),  st.hardware_version),
			/* Rozne modele wypelniaja rozne pola: MC maja web_version,
			   MF297D zamiast tego cr_version. */
			row(_('Wersja panelu'),     st.web_version || st.cr_version),
			row('IMEI',                 st.imei),
			row(_('Adres modemu'),      st.lan_ipaddr || st._host)
		]),

		infoBlock(_('Karta SIM'), [
			row(_('Stan'),      simState(st)),
			row('ICCID',        iccidOf(st)),
			row('IMSI',         imsiOf(st)),
			row('PLMN',         plmn(st)),
			row(_('Operator'),  st.network_provider),
			row(_('Blokada PIN'), st.pin_status === '0' ? _('wyłączona') : st.pin_status),
			row(_('Roaming'),   st.simcard_roam === 'Home' ? _('nie (sieć macierzysta)')
			                                               : st.simcard_roam)
		]),

		infoBlock(_('Połączenie'), [
			row('APN',              st.wan_apn),
			row(_('Typ PDP'),       st.pdp_type),
			row(_('Adres IPv4'),    st.wan_ipaddr),
			/* MF297D bez IPv6 zwraca "::" zamiast pustej wartosci. */
			row(_('Adres IPv6'),    (st.ipv6_wan_ipaddr === '::') ? null : st.ipv6_wan_ipaddr),
			row(_('Czas trwania'),  duration(st.realtime_time)),
			row(_('Wybór sieci'),   st.net_select_mode === 'auto_select' ? _('automatyczny')
			                                                            : st.net_select_mode)
		])
	].filter(function(b) { return b !== null; });

	if (!blocks.length)
		out.push(banner(_('Modem nie zwrócił żadnych danych o urządzeniu.'), COLORS.ok));
	else
		blocks.forEach(function(b) { out.push(b); });

	out.push(footer(st));

	return out;
}

/* --- zakladka "Wykresy": historia sygnalu w ramach sesji ------------------
 *
 * Bufor zyje WYLACZNIE w pamieci przegladarki - zadnego localStorage, zadnego
 * zapisu na routerze. To nie jest ograniczenie techniczne, tylko niezmiennik
 * wersji light ("zero zapisu do pamieci trwalej"). Trwale zbieranie historii
 * ma dojsc dopiero w luci-app-zte-modem, osobnym kolektorem z wlasnym obiektem
 * ubus - patrz ../luci-app-zte-modem/README.md.
 *
 * Bufor stoi w zasiegu MODULU, nie w render(): LuCI nie laduje modulu widoku
 * drugi raz, wiec przejscie na inna strone panelu i powrot nie gubi historii.
 * Przeladowanie strony (F5) - owszem, gubi. Tyle znaczy tu "sesja".
 */
var MAX_SAMPLES = 720;          /* ~2 godz. przy domyslnym interwale 10 s */
var HISTORY = [];

/* Jedna probka na ODCZYT MODEMU, nie na tik pollera.
 *
 * Core oddaje cache, dopoki jest mlodszy niz `refresh_interval` (`show_status`
 * w rpcd/zte-modem), a przy `_stale` oddaje wprost ostatnie znane dane -
 * w obu wypadkach `_timestamp` sie nie zmienia. Bez odsiewania po nim wykres
 * rysowalby odcinek z powtorzonej wartosci i udawal, ze modem odpowiada.
 *
 * SNR i RSSI biore przez snrOf()/rssiOf(), bo nazwy pol i znak roznia sie
 * miedzy modelami - te same poprawki co na zakladce Status.
 */
function sample(st) {
	var t = num(st && st._timestamp);
	if (t === null) return;

	var last = HISTORY[HISTORY.length - 1];
	if (last && last.t === t) return;

	HISTORY.push({
		t:        t,
		lte_rsrp: num(st.lte_rsrp),
		lte_rsrq: num(st.lte_rsrq),
		lte_rssi: rssiOf(st),
		lte_snr:  snrOf(st),
		nr_rsrp:  num(st.Z5g_rsrp),
		nr_rsrq:  num(st.Z5g_rsrq),
		nr_sinr:  num(st.Z5g_SINR)
	});

	if (HISTORY.length > MAX_SAMPLES)
		HISTORY.splice(0, HISTORY.length - MAX_SAMPLES);
}

/* E() z LuCI robi document.createElement, czyli dla <svg> dostalibysmy
   HTMLUnknownElement, ktory sie nie rysuje. Elementy graficzne musza powstac
   w przestrzeni nazw SVG. */
var SVG_NS = 'http://www.w3.org/2000/svg';

function S(tag, attr, children) {
	var el = document.createElementNS(SVG_NS, tag);

	for (var k in attr)
		if (attr[k] !== null && attr[k] !== undefined)
			el.setAttribute(k, String(attr[k]));

	(children || []).forEach(function(c) {
		el.appendChild((c instanceof Node) ? c : document.createTextNode(String(c)));
	});

	return el;
}

var LTE_SERIES = [
	{ key: 'lte_rsrp', label: 'RSRP', kind: 'rsrp', unit: 'dBm' },
	{ key: 'lte_rsrq', label: 'RSRQ', kind: 'rsrq', unit: 'dB'  },
	{ key: 'lte_rssi', label: 'RSSI', kind: 'rssi', unit: 'dBm' },
	{ key: 'lte_snr',  label: 'SNR',  kind: 'sinr', unit: 'dB'  }
];

var NR_SERIES = [
	{ key: 'nr_rsrp', label: 'RSRP', kind: 'rsrp', unit: 'dBm' },
	{ key: 'nr_rsrq', label: 'RSRQ', kind: 'rsrq', unit: 'dB'  },
	{ key: 'nr_sinr', label: 'SINR', kind: 'sinr', unit: 'dB'  }
];

var CHART = { w: 480, h: 150, padL: 36, padR: 8, padT: 10, padB: 8 };

/* Krycie pasow jakosci - inne dla kazdego motywu.
 *
 * Jedna wartosc nie obsluguje obu: te same 12% ginie na bialym tle (pasy
 * wychodza blade i nie da sie ich rozroznic), a na ciemnym zamienia kolor
 * w bloto, bo pastel zmieszany z prawie czarnym po prostu ciemnieje.
 * Wyzej na ciemnym, bo tam kolor musi sie PRZEBIC przez tlo, a nie tylko
 * je zabarwic.
 */
var BAND_OPACITY = { light: 0.18, dark: 0.30 };

/* Ciemny motyw rozpoznajemy po JASNOSCI KOLORU TEKSTU, a nie przez
 * prefers-color-scheme: czesc motywow LuCI ma wlasny przelacznik i nie idzie
 * za ustawieniem systemu, wiec zapytanie medialne klamaloby wlasnie tam, gdzie
 * uzytkownik swiadomie wybral ciemny. Kolor tekstu bierze sie z motywu bez
 * wzgledu na to, skad motyw wie, ze jest ciemny.
 */
function darkTheme() {
	if (typeof getComputedStyle !== 'function') return false;

	var m = String(getComputedStyle(document.body).color || '')
		.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
	if (!m) return false;

	/* Luminancja wg BT.709 - zielony wazy najwiecej, niebieski najmniej. */
	var lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;

	return lum > 0.5;   /* jasny tekst = ciemne tlo */
}

function bandOpacity() {
	return darkTheme() ? BAND_OPACITY.dark : BAND_OPACITY.light;
}

function clock(t) {
	return new Date(t * 1000).toLocaleTimeString();
}

function spanText(sec) {
	if (sec < 90)   return Math.round(sec) + ' s';
	if (sec < 5400) return Math.round(sec / 60) + ' min';
	return (sec / 3600).toFixed(1).replace('.', ',') + ' ' + _('godz.');
}

/* Wykres jednej metryki.
 *
 * Skala pionowa to TIERS - te same progi, co paski na zakladce Status, wiec
 * pasy tla czytaja sie tak samo jak kolor paska i nie trzeba uczyc sie drugiej
 * skali. Konsekwencja: wartosci poza zakresem sa PRZYCINANE do krawedzi,
 * dokladnie jak dlugosc paska w quality().
 *
 * Os pozioma idzie po CZASIE, nie po numerze probki. Odczyty gubia sie na dwa
 * sposoby - modem nie odpowiada, albo LuCI wstrzymuje poller, gdy karta
 * przegladarki jest niewidoczna - a przy skali po indeksie obie przerwy
 * zniknelyby, sciskajac wykres i udajac ciaglosc pomiaru. Dlatego przerwa
 * dluzsza niz `gapLimit` rozrywa linie zamiast ja przeciagac.
 *
 * Linia rysowana `currentColor`, wiec dziedziczy kolor tekstu motywu i jest
 * czytelna tak samo w jasnym, jak i ciemnym.
 */
function chartCard(def, samples, gapLimit) {
	var t = TIERS[def.kind];

	var vals = samples.map(function(s) { return s[def.key]; })
	                  .filter(function(v) { return v !== null; });

	/* Metryka, ktorej model nie zna, nie istnieje - ta sama zasada co metric(). */
	if (!vals.length) return null;

	var x0 = CHART.padL, x1 = CHART.w - CHART.padR;
	var y0 = CHART.padT, y1 = CHART.h - CHART.padB;

	var tMin = samples[0].t, tMax = samples[samples.length - 1].t;

	function X(s) {
		return (tMax === tMin) ? x1 : x0 + (s.t - tMin) / (tMax - tMin) * (x1 - x0);
	}

	function Y(v) {
		var c = Math.max(t.min, Math.min(t.max, v));
		return y1 - (c - t.min) / (t.max - t.min) * (y1 - y0);
	}

	/* Pasy jakosci: kazdy stopien od swojego progu do progu stopnia wyzszego. */
	var alpha = bandOpacity();
	var bands = [], top = t.max;
	t.steps.forEach(function(step) {
		var bottom = (step.from === null) ? t.min : Math.max(t.min, step.from);
		if (bottom < top)
			bands.push(S('rect', {
				x: x0, y: Y(top), width: x1 - x0, height: Y(bottom) - Y(top),
				fill: step.color, opacity: alpha
			}));
		top = bottom;
	});

	/* Opis osi: krance zakresu i progi miedzy stopniami. */
	var marks = [t.max].concat(t.steps.map(function(s) { return s.from; })
	                                  .filter(function(v) { return v !== null; }))
	                   .concat([t.min]);

	var axis = [];
	marks.forEach(function(v, i) {
		var y = Y(v);
		if (i > 0 && i < marks.length - 1)
			axis.push(S('line', { x1: x0, y1: y, x2: x1, y2: y,
			                      stroke: 'currentColor', 'stroke-width': 0.5, opacity: 0.2 }));
		axis.push(S('text', {
			x: x0 - 4, y: y, 'text-anchor': 'end', 'dominant-baseline': 'middle',
			'font-size': 10, fill: 'currentColor', opacity: 0.55
		}, [String(v)]));
	});

	/* Rozbicie na odcinki: brak wartosci albo dziura w czasie konczy odcinek. */
	var segs = [], cur = [];
	samples.forEach(function(s) {
		var v = s[def.key];

		if (v === null) {
			if (cur.length) { segs.push(cur); cur = []; }
			return;
		}

		if (cur.length && (s.t - cur[cur.length - 1].t) > gapLimit) {
			segs.push(cur);
			cur = [];
		}

		cur.push(s);
	});
	if (cur.length) segs.push(cur);

	var lines = segs.map(function(seg) {
		var d = seg.map(function(s, i) {
			return (i ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(s[def.key]).toFixed(1);
		}).join(' ');

		/* Odcinek jednopunktowy: powtorzony punkt + zaokraglona koncowka daje
		   kropke, zamiast znikac bez sladu. */
		if (seg.length === 1)
			d += ' L' + X(seg[0]).toFixed(1) + ' ' + Y(seg[0][def.key]).toFixed(1);

		return S('path', {
			d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5,
			'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.85
		});
	});

	var lastSample = null;
	for (var i = samples.length - 1; i >= 0; i--)
		if (samples[i][def.key] !== null) { lastSample = samples[i]; break; }

	var q = quality(def.kind, lastSample[def.key]);

	var dot = S('circle', {
		cx: X(lastSample), cy: Y(lastSample[def.key]), r: 3,
		fill: q.color, stroke: 'currentColor', 'stroke-width': 0.5
	});

	var svg = S('svg', {
		viewBox: '0 0 ' + CHART.w + ' ' + CHART.h,
		width: '100%', style: 'display:block;height:auto',
		role: 'img',
		'aria-label': def.label + ': ' + q.value + ' ' + def.unit + ', ' + q.label
	}, bands.concat(axis, lines, [dot]));

	var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
	var avg = vals.reduce(function(a, v) { return a + v; }, 0) / vals.length;

	var stats = _('min') + ' ' + lo + '  ·  ' + _('śr') + ' ' + avg.toFixed(1) +
	            '  ·  ' + _('maks') + ' ' + hi;

	return E('div', {
		'style': 'padding:10px 12px 6px;' +
		         'border:1px solid var(--border-color-low,#ccc);border-radius:6px'
	}, [
		E('div', { 'style': 'display:flex;justify-content:space-between;align-items:baseline' }, [
			E('span', { 'style': 'font-size:.85em;opacity:.75' },
				def.label + ' [' + def.unit + ']'),
			E('span', { 'style': 'display:flex;align-items:baseline;gap:.4em' }, [
				/* Kolor tylko jako kropka obok wartosci: nazwany poziom niesie te
				   sama informacje slowem, tak jak w tabeli sasiadow. */
				E('span', { 'style': 'width:8px;height:8px;border-radius:50%;' +
				                     'align-self:center;background:' + q.color }),
				E('span', { 'style': 'font-weight:600' }, String(q.value)),
				E('span', { 'style': 'font-size:.85em;opacity:.7' }, q.label)
			])
		]),
		svg,
		E('div', {
			'style': 'display:flex;justify-content:space-between;font-size:.75em;opacity:.6'
		}, [
			E('span', {}, clock(tMin)),
			E('span', {}, stats),
			E('span', {}, clock(tMax))
		])
	]);
}

function chartBlock(title, series, samples, gapLimit) {
	var cards = series.map(function(def) { return chartCard(def, samples, gapLimit); })
	                  .filter(function(c) { return c !== null; });

	if (!cards.length) return null;

	/* Siatka, a nie flex-wrap jak w block().
	 *
	 * Przy `flex:1 1 380px` kafelek, ktory zostaje sam w wierszu, rozciaga sie
	 * na cala szerokosc - a 5G NR ma trzy metryki, wiec przy dwoch kolumnach
	 * SINR wychodzil dwa razy szerszy od RSRP i RSRQ. Wykresy tej samej rangi
	 * maja byc tej samej wielkosci, bo roznica rozmiaru czyta sie jak roznica
	 * waznosci.
	 *
	 * `auto-fill` (nie `auto-fit`) zostawia puste tory zamiast rozdzielac je
	 * miedzy kafelki - to wlasnie ono trzyma szerokosc kolumny. `min(300px,100%)`
	 * chroni przed wyjechaniem poza ekran na waskich telefonach.
	 */
	return E('div', { 'style': 'margin-bottom:1.2em' }, [
		E('h4', { 'style': 'margin:.3em 0 .5em' }, title),
		E('div', { 'style': 'display:grid;gap:8px;' +
		                    'grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))' },
			cards)
	]);
}

function renderHistory(st, interval) {
	st = st || {};
	var out = [];

	if (st._error)
		out.push(banner(st._error, COLORS.poor));

	var samples = HISTORY;

	/* Dwie probki to minimum, zeby cokolwiek narysowac - z jednej wychodzi
	   kropka bez osi czasu, co wyglada na usterke. */
	if (samples.length < 2) {
		out.push(banner(
			_('Zbieram próbki — wykres pojawi się po drugim odczycie modemu (co %d s).')
				.format(interval),
			COLORS.ok));
		out.push(historyNote(interval));
		out.push(footer(st));
		return out;
	}

	/* Poller stoi, gdy karta przegladarki jest niewidoczna, wiec przerwy sa
	   normalne. Trzy interwaly to prog "to juz nie jest ciagly pomiar";
	   dolne 30 s chroni przed rwaniem linii przy interwale 5 s. */
	var gapLimit = Math.max(3 * interval, 30);

	var span = samples[samples.length - 1].t - samples[0].t;

	out.push(E('div', { 'style': 'font-size:.85em;opacity:.7;margin-bottom:.8em' },
		_('Próbek') + ': ' + samples.length + '  ·  ' + _('zakres') + ': ' + spanText(span) +
		'  ·  ' + _('interwał') + ': ' + interval + ' s'));

	var blocks = [
		chartBlock('LTE',    LTE_SERIES, samples, gapLimit),
		chartBlock('5G NR',  NR_SERIES,  samples, gapLimit)
	].filter(function(b) { return b !== null; });

	if (!blocks.length)
		out.push(banner(_('Brak danych o sygnale — modem nie zwrócił żadnej metryki.'),
			COLORS.ok));
	else
		blocks.forEach(function(b) { out.push(b); });

	out.push(historyNote(interval));
	out.push(footer(st));

	return out;
}

function historyNote(interval) {
	return E('div', { 'style': 'font-size:.8em;opacity:.55;margin-top:1em' }, [
		E('div', {}, _('Historia żyje w pamięci przeglądarki: mieści %d próbek (~%s przy interwale %d s) ' +
		               'i zaczyna się od zera po przeładowaniu strony. Nic nie jest zapisywane na routerze.')
			.format(MAX_SAMPLES, spanText(MAX_SAMPLES * interval), interval)),
		E('div', {}, _('Skala pionowa jest ta sama, co u pasków na zakładce Status — wartości poza ' +
		                'zakresem są przycinane do krawędzi. Przerwa w linii to odczyt, którego nie ' +
		                'było: modem nie odpowiedział albo przeglądarka wstrzymała odświeżanie ' +
		                'na nieaktywnej karcie.'))
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('zte-modem'),
			callStatus().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var st = data[1] || {};
		var interval = parseInt(uci.get('zte-modem', 'main', 'refresh_interval')) || 10;

		sample(st);

		/* Kazda zakladka ma wlasny panel; poller podmienia wszystkie naraz
		   z jednego odczytu. Historia zbiera sie niezaleznie od tego, ktora
		   zakladka jest na wierzchu - poller jest jeden, wspolny dla strony. */
		var panels = {
			status:   E('div', {}, renderStatus(st)),
			chart:    E('div', {}, renderHistory(st, interval)),
			device:   E('div', {}, renderDevice(st))
		};

		function swap(key, content) {
			var old = panels[key];
			/* Przy pierwszym tiku panel moze jeszcze nie byc w DOM. */
			if (!old || !old.parentNode)
				return;
			var fresh = E('div', {}, content);
			old.parentNode.replaceChild(fresh, old);
			panels[key] = fresh;
		}

		poll.add(function() {
			return callStatus().then(function(res) {
				res = res || {};
				sample(res);
				swap('status',   renderStatus(res));
				swap('chart',    renderHistory(res, interval));
				swap('device',   renderDevice(res));
			}).catch(function() { /* chwilowy blad rpc - nastepny poll sprobuje ponownie */ });
		}, interval);

		/* Bez podtytulu: model, adres i firmware sa w stopce kazdej zakladki,
		   wiec zdanie opisowe tylko powtarzalo to, co widac nizej. */
		var m = new form.Map('zte-modem', _('Modem ZTE'));

		/* Przy m.tabbed kazda sekcja = osobna zakladka. data-tab bierze sie z
		   sectiontype, wiec obie sekcje MUSZA miec rozny sectiontype. */
		m.tabbed = true;

		/* Sekcja-zakladka z wlasna trescia (poza mechanizmem opcji formularza),
		   dzieki czemu kafelki maja pelna szerokosc strony. */
		function panelTab(type, title) {
			return form.NamedSection.extend({
				__name__: 'ZteTab_' + type,
				render: function() {
					return E('div', {
						'class': 'cbi-section',
						'data-tab': type,
						'data-tab-title': title
					}, [ panels[type] ]);
				}
			});
		}

		/* --- zakladka 1: Status ------------------------------------------- */
		m.section(panelTab('status', _('Status')), 'main', 'status');

		/* --- zakladka 2: Wykresy ------------------------------------------ */
		/* Zaraz po Statusie, bo to ta sama rzecz w czasie - te same metryki
		   i te same progi, tylko historia zamiast chwili. */
		m.section(panelTab('chart', _('Wykresy')), 'main', 'chart');

		/* --- zakladka 3: Modem -------------------------------------------- */
		m.section(panelTab('device', _('Modem')), 'main', 'device');

		/* --- zakladka 4: Konfiguracja ------------------------------------- */
		var s = m.section(form.NamedSection, 'main', 'zte-modem', _('Konfiguracja'));

		/* Tytul sekcji jest juz etykieta zakladki - nie powtarzaj go w <h3>. */
		s.renderContents = function() {
			var task = form.NamedSection.prototype.renderContents.apply(this, arguments);
			return Promise.resolve(task).then(function(node) {
				for (var i = 0; i < node.childNodes.length; i++) {
					if (node.childNodes[i].nodeName === 'H3') {
						node.removeChild(node.childNodes[i]);
						break;
					}
				}
				return node;
			});
		};

		var o = s.option(form.Value, 'host', _('Adres modemu'),
			_('Adres panelu modemu — <b>nie</b> adres tego routera.'));
		o.datatype = 'ipaddr';
		o.placeholder = '192.168.32.1';
		o.rmempty = false;

		o = s.option(form.Value, 'password', _('Hasło administratora modemu'),
			_('To samo, którym logujesz się do panelu modemu.'));
		o.password = true;

		o = s.option(form.Value, 'refresh_interval', _('Interwał odświeżania'),
			_('Sekundy (5–300). Krótszy interwał = częstsze zapytania do modemu.'));
		o.datatype = 'range(5,300)';
		o.placeholder = '10';

		o = s.option(form.Value, 'timeout', _('Limit czasu zapytania'),
			_('Sekundy (1–30).'));
		o.datatype = 'range(1,30)';
		o.placeholder = '6';
		o.optional = true;

		o = s.option(form.Flag, 'bts_lookup', _('Rozpoznawaj stację bazową'),
			_('Odpytuje btsearch.pl po Cell ID i pokazuje lokalizację masztu. ' +
			  'Wyłącz, jeśli nie chcesz wysyłać Cell ID do zewnętrznego serwisu.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.DummyValue, '_variant', _('Wariant logowania'),
			_('Wykrywany automatycznie przy pierwszym udanym logowaniu.'));
		o.cfgvalue = function() {
			return uci.get('zte-modem', 'main', 'hash_variant') || _('jeszcze nie wykryto');
		};

		o = s.option(form.Button, '_probe', _('Test połączenia'),
			_('Zapisuje ustawienia i sprawdza, który wariant hashowania hasła przyjmuje modem.'));
		o.inputtitle = _('Sprawdź logowanie');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var self = this;
			return self.map.save().then(function() {
				ui.showModal(_('Test połączenia'), [
					E('p', { 'class': 'spinning' }, _('Łączę się z modemem…'))
				]);
				return callProbe();
			}).then(function(res) {
				res = res || {};
				var rows = [
					[_('Modem osiągalny'), res.reachable ? _('tak') : _('nie')],
					[_('Długość LD'),      txt(res.ld_length)],
					[_('Logowanie'),       res.success ? _('powiodło się') : _('nie powiodło się')]
				];
				if (res.variant) rows.push([_('Działający wariant'), res.variant]);
				if (res.error)   rows.push([_('Błąd'), res.error]);

				ui.showModal(_('Test połączenia'), [
					infoTable(rows),
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'cbi-button cbi-button-primary',
							'click': ui.hideModal
						}, _('Zamknij'))
					])
				]);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', _('Błąd') + ': ' + err));
			});
		};

		/* Panel statusu jest juz czescia mapy (zakladka Status). */
		return m.render();
	}
});
