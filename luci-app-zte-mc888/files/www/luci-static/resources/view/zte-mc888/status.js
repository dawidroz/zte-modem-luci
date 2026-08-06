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

/* Progi jakosci sygnalu: poor = ponizej tego zle, good = powyzej tego dobrze,
   min/max sluza tylko do wyliczenia dlugosci paska. */
var SCALE = {
	rsrp: { poor: -100, good: -80, min: -130, max: -60 },
	rsrq: { poor:  -15, good: -10, min:  -25, max:  -3 },
	sinr: { poor:    0, good:  20, min:  -10, max:  30 },
	rssi: { poor:  -85, good: -65, min: -110, max: -40 }
};

var NETWORK_TYPES = {
	'ENDC':   '5G NSA (ENDC)',
	'NR5G':   '5G SA',
	'nr5g':   '5G SA',
	'LTE':    'LTE',
	'LTE_CA': 'LTE + agregacja',
	'WCDMA':  '3G',
	'NO':     'brak zasiegu'
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
	var s = SCALE[kind], n = num(v);
	if (!s || n === null) return null;
	var pct = Math.max(0, Math.min(100, (n - s.min) / (s.max - s.min) * 100));
	return {
		value: n,
		pct: pct,
		cls: (n >= s.good) ? 'good' : (n >= s.poor ? 'ok' : 'poor')
	};
}

function metric(label, kind, value, unit) {
	var q = quality(kind, value);
	var color = q ? COLORS[q.cls] : 'var(--border-color-medium, #999)';

	return E('div', {
		'style': 'flex:1 1 150px;min-width:150px;padding:10px;' +
		         'border:1px solid var(--border-color-low,#ccc);border-radius:6px'
	}, [
		E('div', { 'style': 'font-size:.85em;opacity:.75' }, label),
		E('div', { 'style': 'font-size:1.5em;font-weight:600;margin:.15em 0' },
			q ? (q.value + (unit ? ' ' + unit : '')) : '–'),
		E('div', {
			'style': 'height:6px;border-radius:3px;overflow:hidden;' +
			         'background:var(--border-color-low,#ddd)'
		}, [
			E('div', {
				'style': 'height:100%;background:' + color +
				         ';width:' + (q ? q.pct.toFixed(0) : 0) + '%'
			})
		])
	]);
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
		out.push(infoTable([
			st.wan_active_band ? [_('Aktywne pasmo'), txt(st.wan_active_band)] : null,
			[_('Pasmo (PCell)'),      txt(st.lte_ca_pcell_band)],
			[_('Szerokość (PCell)'),  txt(st.lte_ca_pcell_bandwidth) + ' MHz'],
			st.lte_ca_scell_band ? [_('Pasmo (SCell, CA)'), txt(st.lte_ca_scell_band)] : null,
			st.lte_ca_scell_bandwidth ? [_('Szerokość (SCell)'), txt(st.lte_ca_scell_bandwidth) + ' MHz'] : null,
			st.lte_ca_pcell_arfcn ? [_('EARFCN'), txt(st.lte_ca_pcell_arfcn)] : null,
			[_('PCI'),                txt(st.lte_pci)],
			[_('Cell ID'),            txt(st.cell_id)]
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
			[_('PCI'),      txt(st.nr5g_pci)],
			st.Z5g_CELL_ID ? [_('Cell ID'), txt(st.Z5g_CELL_ID)] : null
		]));
	}

	if (!hasLte && !has5g)
		out.push(banner(_('Brak danych o sygnale — modem nie zwrócił żadnej metryki.'),
			COLORS.ok));

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
	return E('div', { 'style': 'margin-top:1em;font-size:.85em;opacity:.65' },
		_('Modem') + ': ' + txt(st._host) +
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

		var m = new form.Map('zte-mc888', _('ZTE MC888'),
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
