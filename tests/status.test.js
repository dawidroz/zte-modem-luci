/* Testy zakladki "Wykresy" (historia sygnalu w ramach sesji).
 *
 * Probki modeli sa przepisane z docs/modele.md - to tam siedza roznice, ktore
 * ten kod ma znosic: inne nazwy pol na MF297D, RSSI bez znaku, 5G bez RSRQ
 * na MC7010.
 *
 * Uruchomienie:  node tests/status.test.js
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

function reset() { H.HISTORY.length = 0; }

var T0 = 1786000000;

/* MC888: LTE + 5G NSA, `lte_snr` / `lte_rssi` wypelnione. */
function mc888(i) {
	return {
		_timestamp: T0 + i * 10,
		lte_rsrp: String(-87 - (i % 5)), lte_rsrq: '-11',
		lte_snr: '13.4', lte_rssi: '-73',
		Z5g_rsrp: '-95', Z5g_rsrq: '-11', Z5g_SINR: '8'
	};
}

/* MF297D: SNR/RSSI pod innymi nazwami, RSSI bez znaku, bez 5G. */
function mf297d(i) {
	return { _timestamp: T0 + i * 10, lte_rsrp: '-99', lte_rsrq: '-14',
	         sinr: '5', rssi: '67' };
}

/* MC7010: 5G bez RSRQ (w tescie obciazeniowym 0/53 probek). */
function mc7010(i) {
	return { _timestamp: T0 + i * 10, lte_rsrp: '-101',
	         Z5g_rsrp: '-98', Z5g_SINR: '11', Z5g_rsrq: '' };
}

function pathPoints(d) {
	return d.match(/[ML]([\d.]+) ([\d.]+)/g).map(function(s) {
		var m = s.slice(1).split(' ');
		return { x: parseFloat(m[0]), y: parseFloat(m[1]) };
	});
}

console.log('\n-- bufor probek --');

reset();
H.sample(mc888(0));
H.sample(mc888(0));                                  /* cache core'a: ten sam odczyt */
H.sample(mc888(1));
ok('powtorzony _timestamp odsiany', H.HISTORY.length === 2, 'jest ' + H.HISTORY.length);

H.sample({});
H.sample({ _error: 'brak danych' });
ok('probka bez _timestamp ignorowana', H.HISTORY.length === 2, 'jest ' + H.HISTORY.length);

reset();
for (var i = 0; i < H.MAX_SAMPLES + 50; i++) H.sample(mc888(i));
ok('bufor nie rosnie ponad MAX_SAMPLES', H.HISTORY.length === H.MAX_SAMPLES,
	'jest ' + H.HISTORY.length);
ok('bufor trzyma najnowsze probki',
	H.HISTORY[H.HISTORY.length - 1].t === T0 + (H.MAX_SAMPLES + 49) * 10);

console.log('\n-- normalizacja pol miedzy modelami --');

reset();
H.sample(mf297d(0));
ok('RSSI bez znaku sprowadzone do ujemnego', H.HISTORY[0].lte_rssi === -67,
	String(H.HISTORY[0].lte_rssi));
ok('`sinr` uzyte, gdy `lte_snr` puste', H.HISTORY[0].lte_snr === 5,
	String(H.HISTORY[0].lte_snr));
ok('brak 5G -> null, nie 0', H.HISTORY[0].nr_rsrp === null);

console.log('\n-- stan poczatkowy --');

reset();
H.sample(mc888(0));
var out = H.renderHistory(mc888(0), 10);
ok('jedna probka -> komunikat o zbieraniu', /Zbieram próbki/.test(H.text(out)));
ok('jedna probka -> zaden wykres', H.svgs(out).length === 0);

console.log('\n-- wykres, MC888 --');

reset();
for (i = 0; i < 30; i++) H.sample(mc888(i));
out = H.renderHistory(mc888(29), 10);

var svgs = H.svgs(out);
ok('4 wykresy LTE + 3 wykresy 5G NR', svgs.length === 7, 'jest ' + svgs.length);

var paths = svgs[0].find('path');
ok('ciagly odczyt -> jedna linia', paths.length === 1, 'jest ' + paths.length);

var pts = pathPoints(paths[0].attr.d);
ok('linia ma tyle punktow, ile probek', pts.length === 30, 'jest ' + pts.length);
ok('pierwszy punkt na lewej krawedzi pola', Math.abs(pts[0].x - 36) < 0.5,
	'x=' + pts[0].x);
ok('ostatni punkt na prawej krawedzi pola', Math.abs(pts[29].x - 472) < 0.5,
	'x=' + pts[29].x);
ok('czas rosnie monotonicznie', pts.every(function(p, n) {
	return n === 0 || p.x >= pts[n - 1].x;
}));
ok('wszystkie punkty w polu rysunku', pts.every(function(p) {
	return p.y >= 10 - 0.01 && p.y <= 142 + 0.01;
}));
ok('cztery pasy jakosci w tle', svgs[0].find('rect').length === 4,
	'jest ' + svgs[0].find('rect').length);
ok('kropka biezacej wartosci', svgs[0].find('circle').length === 1);
ok('aria-label podaje wartosc i ocene', /RSRP: -\d+ dBm, \S+/.test(svgs[0].attr['aria-label']),
	svgs[0].attr['aria-label']);

/* Kafelki nie moga sie rozciagac: przy flex-wrap ostatni w wierszu bral cala
   reszte szerokosci i SINR 5G (trzeci z trzech) wychodzil dwa razy szerszy. */
var grids = out.reduce(function(a, n) {
	return a.concat(n.find('div').filter(function(d) {
		return /display:grid/.test(d.attr.style || '');
	}));
}, []);
ok('sekcje ukladaja kafelki w siatke', grids.length === 2, 'jest ' + grids.length);
ok('siatka trzyma szerokosc kolumny (auto-fill)',
	grids.every(function(g) { return /auto-fill/.test(g.attr.style); }));
ok('kafelek nie ma wlasnej szerokosci ani flex-grow',
	grids.every(function(g) {
		return g.kids.every(function(c) { return !/flex|width/.test(c.attr.style || ''); });
	}));

console.log('\n-- pasy jakosci a motyw --');

function bandAlphas(nodes) {
	return H.svgs(nodes)[0].find('rect').map(function(r) { return r.attr.opacity; });
}

H.setTheme('light');
ok('jasny motyw: krycie pasow z BAND_OPACITY.light',
	bandAlphas(H.renderHistory(mc888(29), 10))
		.every(function(a) { return a === String(H.BAND_OPACITY.light); }),
	bandAlphas(H.renderHistory(mc888(29), 10)).join(','));

H.setTheme('dark');
ok('ciemny motyw wykryty po jasnosci tekstu', H.darkTheme() === true);
ok('ciemny motyw: pasy mocniejsze, zeby nie zlaly sie z tlem',
	bandAlphas(H.renderHistory(mc888(29), 10))
		.every(function(a) { return a === String(H.BAND_OPACITY.dark); }),
	bandAlphas(H.renderHistory(mc888(29), 10)).join(','));
ok('ciemny mocniejszy od jasnego', H.BAND_OPACITY.dark > H.BAND_OPACITY.light);

H.setTheme('light');
ok('powrot do jasnego wykrywany', H.darkTheme() === false);

console.log('\n-- przyciecie do skali --');

reset();
H.sample({ _timestamp: T0,      lte_rsrp: '-140' });   /* ponizej min (-130) */
H.sample({ _timestamp: T0 + 10, lte_rsrp: '-20'  });   /* powyzej max  (-60) */
out = H.renderHistory({ _timestamp: T0 + 10 }, 10);
pts = pathPoints(H.svgs(out)[0].find('path')[0].attr.d);
ok('wartosc pod skala przycieta do dolnej krawedzi', Math.abs(pts[0].y - 142) < 0.01,
	'y=' + pts[0].y);
ok('wartosc nad skala przycieta do gornej krawedzi', Math.abs(pts[1].y - 10) < 0.01,
	'y=' + pts[1].y);

console.log('\n-- przerwy w pomiarze --');

reset();
H.sample(mc888(0));
H.sample(mc888(1));
H.sample({ _timestamp: T0 + 200 });                    /* 190 s luki > 3 x 10 s */
H.sample(mc888(30));
H.sample(mc888(31));
out = H.renderHistory(mc888(31), 10);
ok('luka rozrywa linie na dwa odcinki', H.svgs(out)[0].find('path').length === 2,
	'jest ' + H.svgs(out)[0].find('path').length);

console.log('\n-- modele bez czesci metryk --');

reset();
for (i = 0; i < 5; i++) H.sample(mf297d(i));
out = H.renderHistory(mf297d(4), 10);
ok('MF297D: same wykresy LTE', H.svgs(out).length === 4, 'jest ' + H.svgs(out).length);
ok('MF297D: bez pustej sekcji 5G NR', !/5G NR/.test(H.text(out)));

reset();
for (i = 0; i < 5; i++) H.sample(mc7010(i));
out = H.renderHistory(mc7010(4), 10);
ok('MC7010: RSRP LTE + RSRP/SINR 5G, bez RSRQ 5G', H.svgs(out).length === 3,
	'jest ' + H.svgs(out).length);

console.log('\n-- modem nieosiagalny --');

reset();
H.sample({ _timestamp: T0,      _error: 'Modem nieosiagalny', _authenticated: 0 });
H.sample({ _timestamp: T0 + 10, _error: 'Modem nieosiagalny', _authenticated: 0 });
out = H.renderHistory({ _timestamp: T0 + 10, _error: 'Modem nieosiagalny' }, 10);
ok('same puste odczyty -> zaden wykres', H.svgs(out).length === 0);
ok('same puste odczyty -> komunikat o braku metryk',
	/Brak danych o sygnale/.test(H.text(out)));
ok('blad modemu widoczny na zakladce', /nieosiagalny/.test(H.text(out)));

console.log(fails ? '\n' + fails + ' NIEUDANYCH\n' : '\nwszystko przechodzi\n');
process.exit(fails ? 1 : 0);
