/* Testy obslugi MC7510 - modemu mowiacego po ubusie.
 *
 * Probki to WYNIK MAPPERA (/usr/share/zte-modem/ubus-map.uc), zdjety z zywego
 * MC7510, a nie surowa odpowiedz modemu: widok widzi wylacznie nazwy goformowe,
 * bo na tym polega cale mapowanie. Surowe pola ubusa testuje osobno
 * tests/ubus-map.test.sh.
 *
 * Uruchomienie:  node tests/mc7510.test.js
 */
'use strict';

var H = require('./harness.js');

var fails = 0;

function ok(name, cond, extra) {
	if (cond) {
		console.log('  ok  ' + name);
	} else {
		fails++;
		console.log('FAIL  ' + name + (extra ? '   (' + extra + ')' : ''));
	}
}

/* Odczyt z MC7510 (Orange PL, 3xCA: B1 + B3 + B20, ENDC na n78).
 * Przepisany z `ubus call zte-modem status` na zywym urzadzeniu. */
function mc7510(over) {
	var st = {
		_timestamp: 1787316926,
		_protocol: 'ubus', _pci_base: 'dec', _cell_base: 'dec',
		_variant: 'sha256_salt', _host: '192.168.254.1', _authenticated: true,

		model_name: 'MC7510', device_market_name: 'G51F',
		wa_inner_version: 'BD_STDPLMC7510AV1.0.0B04',
		hardware_version: 'MC7510_HW1.0', web_version: 'V1.0',
		imei: '864866070139083', lan_ipaddr: '192.168.254.1',

		modem_main_state: 'modem_init_complete',
		iccid: '8948032522760305828F', pin_status: '0',
		network_type: 'ENDC', network_provider: 'Orange', signalbar: '5',
		simcard_roam: 'Home', net_select_mode: 'auto_select',
		rmcc: '260', rmnc: '3',

		lte_rsrp: '-80', lte_rsrq: '-9', lte_rssi: '-79', lte_snr: '7.0',
		lte_pci: '259', cell_id: '35072027',
		wan_active_channel: '75', wan_active_band: 'LTE BAND 1',

		lte_ca_pcell_band: '1', lte_ca_pcell_freq: '75',
		lte_ca_pcell_bandwidth: '15.0', bandwidth: '15.0MHz',
		lte_multi_ca_scell_info: '1,259,0,3,1725,15.0;2,307,0,20,6200,10.0',
		_scell_sig: '-75.0,-8.0,4.0,-68.0;-70.0,-14.0,0.0,-58.0',

		Z5g_rsrp: '-91', Z5g_rsrq: '-12', Z5g_SINR: '18.0',
		nr5g_pci: '463', nr5g_action_band: 'n78',
		nr5g_action_channel: '640704', nr5g_bandwidth: '100',

		ipv6_wan_ipaddr: '2a00:0f44:0cf1:391b:72f0:7c4b:f39f:988c',
		wan_apn: 'internetipv6', pdp_type: 'IPv4v6',
		realtime_time: '129809'
	};

	for (var k in (over || {})) st[k] = over[k];
	return st;
}

/* MC888 - modem goformowy, dla porownania: BEZ pomiaru na nosna. */
function mc888() {
	return {
		_timestamp: 1786000000, model_name: 'MC888',
		lte_rsrp: '-87', lte_rsrq: '-11', lte_snr: '13.4', lte_rssi: '-73',
		lte_pci: '1a3', cell_id: '21ab417',
		lte_ca_pcell_band: '7', lte_ca_pcell_freq: '3125',
		lte_ca_pcell_bandwidth: '15.0',
		lte_multi_ca_scell_info: '1,334,1,3,1348,20.0'
	};
}

function cells(node, tag) {
	return node.find(tag).map(function(n) { return n.text(); });
}

console.log('\n-- rozbior _scell_sig --');

var sig = H.scellSig(mc7510());
ok('dwa wpisy dla dwoch nosnych dodatkowych', sig.length === 2, 'jest ' + sig.length);
ok('SCC1: RSRP -75, SINR 4', sig[0].rsrp === -75 && sig[0].sinr === 4,
   JSON.stringify(sig[0]));
ok('SCC2: RSRP -70, SINR 0', sig[1].rsrp === -70 && sig[1].sinr === 0,
   JSON.stringify(sig[1]));
ok('brak pola -> pusta lista', H.scellSig({}).length === 0);
ok('wpis obciety -> null w tablicy',
   H.scellSig({ _scell_sig: '-75.0,-8.0' })[0] === null);

console.log('\n-- tabela nosnych na MC7510 --');

var rows = H.carrierRows(mc7510());
ok('trzy nosne: PCell + SCC1 + SCC2', rows.length === 3, 'jest ' + rows.length);
ok('PCell na pasmie B1, nie "B1,3,8,20,38"', rows[0].band === 'B1', rows[0].band);
ok('PCell 15 MHz na EARFCN 75', rows[0].bw === 15 && rows[0].earfcn === '75');
ok('PCI nosnej glownej dziesietnie (259)', rows[0].pci === '259', rows[0].pci);
ok('SCC1 = B3, 15 MHz, EARFCN 1725', rows[1].band === 'B3' && rows[1].bw === 15 &&
   rows[1].earfcn === '1725');
ok('SCC2 = B20, 10 MHz, EARFCN 6200', rows[2].band === 'B20' && rows[2].bw === 10 &&
   rows[2].earfcn === '6200');

ok('PCell bierze pomiar z pol wlasnych (lte_rsrp/lte_snr)',
   rows[0].sig.rsrp === -80 && rows[0].sig.sinr === 7,
   JSON.stringify(rows[0].sig));
ok('SCC1 ma pomiar z _scell_sig', rows[1].sig.rsrp === -75);
ok('SCC2 ma pomiar z _scell_sig', rows[2].sig.rsrp === -70);

var tbl = H.carriers(mc7510());
var head = cells(tbl, 'th');
ok('siedem kolumn: doklejone RSRP i SINR', head.length === 7, head.join('|'));
ok('kolumny nazwane RSRP i SINR',
   head[5] === 'RSRP' && head[6] === 'SINR', head.join('|'));

var txt = tbl.text();
ok('lacznie 40 MHz (15+15+10)', /40\.0 MHz/.test(txt), txt.slice(0, 200));
ok('meldunek 3xCA', /3×CA/.test(txt));
ok('poziom SCC widoczny w tabeli', /-75 dBm/.test(txt) && /-70 dBm/.test(txt));

console.log('\n-- pomiar na nosna dopasowany po NUMERZE SCC --');

/* Gdy modem melduje tylko SCC2 (numer 2, nie pozycja 1), pomiar musi pojsc
   za numerem - inaczej SCC2 dostalby wartosci SCC1. */
var skewed = H.carrierRows(mc7510({
	lte_multi_ca_scell_info: '2,307,0,20,6200,10.0'
}));
ok('jedna nosna dodatkowa: SCC2', skewed.length === 2 && skewed[1].name === 'SCC2');
ok('SCC2 dostaje DRUGI wpis pomiaru (-70), nie pierwszy',
   skewed[1].sig.rsrp === -70, JSON.stringify(skewed[1].sig));

console.log('\n-- modem goformowy zostaje bez zmian --');

var gf = H.carriers(mc888());
var gfHead = cells(gf, 'th');
ok('piec kolumn, bez RSRP/SINR', gfHead.length === 5, gfHead.join('|'));
ok('brak pomiaru na nosna', H.carrierRows(mc888())[0].sig === null);
ok('nadal liczy agregacje', /35\.0 MHz/.test(gf.text()), gf.text().slice(0, 160));

console.log('\n-- zakladka Modem: nazwa handlowa --');

var dev = H.renderDevice(mc7510());
ok('nazwa handlowa G51F widoczna', /G51F/.test(H.text(dev)));
ok('MC7510 bez IMSI nie pokazuje pustego wiersza',
   !/IMSI/.test(H.text(dev)), 'IMSI nie powinno byc');
ok('nazwa handlowa nieobecna, gdy modem jej nie podaje',
   !/G51F/.test(H.text(H.renderDevice(mc888()))));

console.log('\n-- Status renderuje sie w calosci --');

var out;
try {
	out = H.renderStatus(mc7510());
	ok('renderStatus nie wysypuje sie na danych z MC7510', true);
} catch (e) {
	ok('renderStatus nie wysypuje sie na danych z MC7510', false, String(e));
	out = [];
}

var all = H.text(out);
ok('typ sieci rozwiniety do 5G NSA', /5G NSA/.test(all));
ok('pokazuje 5G NR', /n78/.test(all));

console.log(fails ? '\n' + fails + ' testow nie przechodzi' : '\nwszystko przechodzi');
process.exit(fails ? 1 : 0);
