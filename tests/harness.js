/* Atrapa DOM + E() z LuCI, zeby wolac funkcje widoku w node.
 *
 * Widok jest modulem LuCI, nie CommonJS: konczy sie `return view.extend({...})`
 * i liczy na globalne `E`, `_`, `rpc`. Tniemy plik przed tym `return`, resztę
 * odpalamy przez `new Function` i oddajemy same funkcje wewnetrzne - dzieki
 * temu testy nie potrzebuja ani LuCI, ani przegladarki, ani zaleznosci z npm.
 *
 * Uruchomienie:  node tests/status.test.js
 */
'use strict';

var fs   = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'luci-app-zte-modem-light',
	'files/www/luci-static/resources/view/zte-modem/status.js');

/* Minimalny wezel: tyle DOM-u, ile widok naprawde wola. */
function Node(tag, ns) {
	this.tag  = tag;
	this.ns   = ns || null;
	this.attr = {};
	this.kids = [];
}

Node.prototype.setAttribute = function(k, v) {
	/* Atrybuty ida do SVG jako tekst - `undefined` albo `NaN` w wartosci to
	   zawsze blad wyliczenia geometrii, wiec niech wysypie sie tutaj, a nie
	   cicho na routerze. */
	if (/undefined|NaN/.test(String(v)))
		throw new Error('zla wartosc atrybutu ' + this.tag + '@' + k + '="' + v + '"');
	this.attr[k] = String(v);
};

Node.prototype.appendChild = function(c) { this.kids.push(c); return c; };

Node.prototype.find = function(tag) {
	var out = (this.tag === tag) ? [this] : [];
	this.kids.forEach(function(k) {
		if (k instanceof Node) out = out.concat(k.find(tag));
	});
	return out;
};

Node.prototype.text = function() {
	return this.kids.map(function(k) {
		return (k instanceof Node) ? k.text() : String(k);
	}).join(' ');
};

Node.prototype.dump = function(ind) {
	ind = ind || '';
	var a = Object.keys(this.attr).map(function(k) {
		return ' ' + k + '="' + this.attr[k] + '"';
	}, this).join('');

	var s = ind + '<' + this.tag + a + '>' +
	        this.kids.filter(function(k) { return !(k instanceof Node); }).join('');

	this.kids.filter(function(k) { return k instanceof Node; })
	         .forEach(function(k) { s += '\n' + k.dump(ind + '  '); });

	return s;
};

global.Node = Node;

global.document = {
	createElement:   function(t)     { return new Node(t); },
	createElementNS: function(ns, t) { return new Node(t, ns); },
	createTextNode:  function(t)     { return t; },
	body:            new Node('body')
};

/* Widok rozpoznaje ciemny motyw po jasnosci koloru tekstu - `setTheme()`
   pozwala testom udawac jeden i drugi. */
var themeColor = 'rgb(33, 37, 41)';
global.getComputedStyle = function() { return { color: themeColor }; };

/* E(tag, attr?, data?) - zakres uzywany przez widok. Drugi argument jest
   atrybutami tylko wtedy, gdy jest obiektem i nie tablica; inaczej to dzieci. */
global.E = function(tag, attr, data) {
	if (!(attr instanceof Object) || Array.isArray(attr)) {
		data = attr;
		attr = null;
	}

	var el = new Node(tag);

	for (var k in (attr || {}))
		el.setAttribute(k, attr[k]);

	var list = (data === undefined || data === null) ? []
	         : (Array.isArray(data) ? data : [data]);

	list.forEach(function(c) {
		if (c !== null && c !== undefined) el.appendChild(c);
	});

	return el;
};

global._ = function(s) { return s; };

global.rpc = { declare: function() { return function() { return Promise.resolve({}); }; } };

/* LuCI dokłada to do String.prototype; widok uzywa .format() w komunikatach. */
String.prototype.format = function() {
	var args = arguments, i = 0;
	return this.replace(/%[sd]/g, function() { return String(args[i++]); });
};

var lines = fs.readFileSync(SRC, 'utf8').split('\n');
var cut   = lines.findIndex(function(l) { return l.indexOf('return view.extend(') === 0; });

if (cut < 0)
	throw new Error('nie znalazlem `return view.extend(` w ' + SRC);

var body = lines.slice(0, cut).join('\n') + '\nreturn {' +
	['sample', 'renderHistory', 'chartCard', 'chartBlock', 'quality',
	 'darkTheme', 'bandOpacity', 'BAND_OPACITY',
	 'renderStatus', 'dataLimit', 'limitBytes', 'bytes', 'resetDate', 'until',
	 'carriers', 'carrierRows', 'scellSig', 'bandOf', 'renderDevice',
	 'HISTORY', 'MAX_SAMPLES', 'LTE_SERIES', 'NR_SERIES'].join(', ') + '};';

module.exports = new Function(body)();
module.exports.Node = Node;

module.exports.setTheme = function(which) {
	themeColor = (which === 'dark') ? 'rgb(233, 236, 239)' : 'rgb(33, 37, 41)';
};

/* Wszystkie <svg> w liscie wezlow zwroconej przez render*(). */
module.exports.svgs = function(nodes) {
	return nodes.reduce(function(a, n) { return a.concat(n.find('svg')); }, []);
};

/* Caly tekst widoczny w liscie wezlow - do sprawdzania komunikatow. */
module.exports.text = function(nodes) {
	return nodes.map(function(n) { return n.text(); }).join(' ');
};
