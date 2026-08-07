'use strict';
'require view';
'require form';
'require rpc';
'require poll';
'require ui';
'require uci';

var callStatus = rpc.declare({ object: 'zte-mc888', method: 'status' });
var callProbe  = rpc.declare({ object: 'zte-mc888', method: 'probe'  });

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

function bytes(v) {
	var n = num(v);
	if (n === null) return '–';
	var u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0;
	while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
	return n.toFixed(i ? 2 : 0) + ' ' + u[i];
}

function rate(v) {
	var n = num(v);
	if (n === null) return '–';
	return bytes(n) + '/s';
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
function metric(label, kind, value, unit) {
	var q = quality(kind, value);
	var caption = q
		? (q.value + (unit ? ' ' + unit : '') + ' · ' + q.label)
		: _('brak danych');

	return E('div', {
		'style': 'flex:1 1 190px;min-width:190px;padding:10px 12px 6px;' +
		         'border:1px solid var(--border-color-low,#ccc);border-radius:6px'
	}, [
		E('div', { 'style': 'font-size:.85em;opacity:.75' }, label),
		E('div', { 'class': 'cbi-progressbar', 'title': caption },
			E('div', { 'style': 'width:' + (q ? q.pct.toFixed(0) : 0) + '%' +
			                    (q ? ';background:' + q.color : '') }))
	]);
}

/* Cell ID przychodzi w hex; pokazujemy tez wartosc dziesietna (ECI), bo to nia
 * posluguje sie btsearch i wiekszosc narzedzi.
 *
 * Swiadomie BEZ odnosnika: stary glaboki link `szukaj.php?mode=std&search=` nie
 * dziala - btsearch jest dzis SPA i kazdy adres zwraca ten sam szkielet HTML.
 * Identyfikacje masztu robi backend przez /api/v1/search, a wynik pokazuje
 * sekcja "Stacja bazowa" nizej.
 */
/* PCI modem podaje SZESNASTKOWO - potwierdzone na MC7010, ktory zwrocil
 * `lte_pci: "1e3"` i `nr5g_pci: "3d"`; "1e3" nie jest liczba dziesietna.
 * Na MC888 wartosci ("11", "133") wygladaja na dziesietne, ale to ta sama
 * rodzina firmware'u i to samo pole, a cell_id jest tam hexem potwierdzonym
 * dopasowaniem w btsearch - wiec traktujemy je jednolicie jako hex.
 *
 * PCI przyjeto podawac dziesietnie (zakres 0-503), stad taka kolejnosc.
 */
function pci(hex) {
	if (!hex) return '–';
	var dec = parseInt(String(hex), 16);
	if (isNaN(dec)) return txt(hex);
	return dec + ' (0x' + String(hex).toLowerCase() + ')';
}

function cellId(hex) {
	if (!hex) return '–';
	var dec = parseInt(String(hex), 16);
	if (isNaN(dec)) return txt(hex);

	return hex + ' (' + dec + ')';
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
function carriers(st) {
	var rows = [];

	function hexDec(v) {
		if (!v) return '–';
		var d = parseInt(String(v), 16);
		return isNaN(d) ? String(v) : String(d);
	}

	if (st.lte_ca_pcell_band)
		rows.push(['PCell', 'B' + st.lte_ca_pcell_band,
			st.lte_ca_pcell_bandwidth ? st.lte_ca_pcell_bandwidth + ' MHz' : '–',
			txt(st.lte_ca_pcell_freq || st.wan_active_channel || st.lte_ca_pcell_arfcn),
			hexDec(st.lte_pci)]);

	if (st.lte_multi_ca_scell_info) {
		String(st.lte_multi_ca_scell_info).split(';').forEach(function(part) {
			var f = part.split(',');
			if (f.length < 6) return;
			rows.push(['SCC' + f[0], 'B' + f[3], f[5] + ' MHz', f[4], f[1]]);
		});
	} else if (st.lte_ca_scell_band) {
		rows.push(['SCC1', 'B' + st.lte_ca_scell_band,
			st.lte_ca_scell_bandwidth ? st.lte_ca_scell_bandwidth + ' MHz' : '–',
			'–', '–']);
	}

	if (!rows.length)
		return E('div', {});

	var total = rows.reduce(function(a, r) {
		var n = parseFloat(r[2]);
		return a + (isNaN(n) ? 0 : n);
	}, 0);

	var head = E('tr', { 'class': 'tr table-titles' },
		[_('Nośna'), _('Pasmo'), _('Szerokość'), 'EARFCN', 'PCI'].map(function(h) {
			return E('th', { 'class': 'th left' }, h);
		}));

	var body = rows.map(function(r) {
		return E('tr', { 'class': 'tr' }, r.map(function(c) {
			return E('td', { 'class': 'td left' }, String(c));
		}));
	});

	return E('div', {}, [
		E('table', { 'class': 'table', 'style': 'margin-top:.5em' }, [head].concat(body)),
		total > 0
			? E('div', { 'style': 'font-size:.85em;opacity:.7;margin-top:.3em' },
				_('Łączna szerokość') + ': ' + total.toFixed(1) + ' MHz  ·  ' +
				rows.length + '×CA')
			: ''
	]);
}

function block(title, children) {
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

	/* LTE */
	var hasLte = [st.lte_rsrp, st.lte_rsrq, st.lte_rssi, st.lte_snr]
		.some(function(v) { return num(v) !== null; });

	if (hasLte) {
		out.push(block('LTE', [
			metric('RSRP', 'rsrp', st.lte_rsrp, 'dBm'),
			metric('RSRQ', 'rsrq', st.lte_rsrq, 'dB'),
			metric('RSSI', 'rssi', st.lte_rssi, 'dBm'),
			metric('SNR',  'sinr', st.lte_snr,  'dB')
		]));
		out.push(carriers(st));
		out.push(infoTable([
			st.wan_active_band ? [_('Aktywne pasmo'), txt(st.wan_active_band)] : null,
			[_('PCI'),                pci(st.lte_pci)],
			[_('Cell ID'),            cellId(st.cell_id)],
			st.enodeb_id ? [_('eNodeB ID'), cellId(st.enodeb_id)] : null
		]));
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
			[_('PCI'),      pci(st.nr5g_pci)],
			st.Z5g_CELL_ID ? [_('Cell ID'), cellId(st.Z5g_CELL_ID)] : null
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

/* Duza liczba z podpisem - do kafelkow transferu (bez paska jakosci). */
function figure(label, value, sub) {
	return E('div', {
		'style': 'flex:1 1 170px;min-width:170px;padding:12px;' +
		         'border:1px solid var(--border-color-low,#ccc);border-radius:6px'
	}, [
		E('div', { 'style': 'font-size:.85em;opacity:.75' }, label),
		E('div', { 'style': 'font-size:1.5em;font-weight:600;margin:.15em 0' }, value),
		sub ? E('div', { 'style': 'font-size:.8em;opacity:.6' }, sub) : ''
	]);
}

function footer(st) {
	var when = st._timestamp ? new Date(st._timestamp * 1000).toLocaleTimeString() : '–';
	/* Jedna aplikacja obsluguje rozne modele - warto widziec, ktory to. */
	return E('div', { 'style': 'margin-top:1em;font-size:.85em;opacity:.65' },
		(st.model_name ? st.model_name + ' · ' : '') + txt(st._host) +
		' · ' + _('firmware') + ': ' + txt(st.wa_inner_version) +
		' · ' + _('odczyt') + ': ' + when);
}

function renderTransfer(st) {
	st = st || {};
	var out = [];

	var rx = num(st.monthly_rx_bytes);
	var tx = num(st.monthly_tx_bytes);
	var total = (rx !== null && tx !== null) ? (rx + tx) : null;

	out.push(E('h4', { 'style': 'margin:.3em 0 .5em' }, _('Licznik miesięczny')));
	out.push(E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px' }, [
		figure(_('Pobrane'), bytes(st.monthly_rx_bytes)),
		figure(_('Wysłane'), bytes(st.monthly_tx_bytes)),
		figure(_('Razem'),   total !== null ? bytes(total) : '–',
			(total !== null && rx !== null && total > 0)
				? _('pobieranie stanowi') + ' ' + Math.round(rx / total * 100) + '%'
				: null)
	]));

	out.push(E('h4', { 'style': 'margin:1.2em 0 .5em' }, _('Prędkość chwilowa')));
	out.push(E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:8px' }, [
		figure(_('Pobieranie'), rate(st.realtime_rx_thrpt)),
		figure(_('Wysyłanie'),  rate(st.realtime_tx_thrpt))
	]));

	out.push(E('div', {
		'style': 'margin-top:1.2em;font-size:.85em;opacity:.7'
	}, _('Liczniki pochodzą z modemu i zerują się zgodnie z jego własnym cyklem rozliczeniowym — ' +
	     'nie z ruchem mierzonym na routerze.')));

	out.push(footer(st));

	return out;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('zte-mc888'),
			callStatus().catch(function() { return {}; })
		]);
	},

	render: function(data) {
		var st = data[1] || {};
		var interval = parseInt(uci.get('zte-mc888', 'main', 'refresh_interval')) || 10;

		/* Kazda zakladka ma wlasny panel; poller podmienia oba naraz z jednego odczytu. */
		var panels = {
			status:   E('div', {}, renderStatus(st)),
			transfer: E('div', {}, renderTransfer(st))
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
				swap('status',   renderStatus(res));
				swap('transfer', renderTransfer(res));
			}).catch(function() { /* chwilowy blad rpc - nastepny poll sprobuje ponownie */ });
		}, interval);

		var m = new form.Map('zte-mc888', _('Modem ZTE'),
			_('Monitoring sygnału modemu 5G stanowiącego łącze WAN tego routera.'));

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

		/* --- zakladka 2: Transfer ----------------------------------------- */
		m.section(panelTab('transfer', _('Transfer')), 'main', 'transfer');

		/* --- zakladka 3: Konfiguracja ------------------------------------- */
		var s = m.section(form.NamedSection, 'main', 'zte-mc888', _('Konfiguracja'));

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
			_('Adres panelu MC888 — <b>nie</b> adres tego routera.'));
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
			return uci.get('zte-mc888', 'main', 'hash_variant') || _('jeszcze nie wykryto');
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
