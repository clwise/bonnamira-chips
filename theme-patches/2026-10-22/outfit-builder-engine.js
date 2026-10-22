(function (global) {
'use strict';
var CATALOG_SECTION = 'outfit-builder-data';
var _catalogPromise = null;
var CATALOG_RE = /<script type="application\/json" id="outfit-builder-catalog"([^>]*)>([\s\S]*?)<\/script>/;
function fetchCatalogPage(page) {
var url = window.location.pathname.replace(/^\/(?:es|fr|ar|th)(?=\/|$)/, '') + '?section_id=' + CATALOG_SECTION + (page > 1 ? '&page=' + page : '');
return fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
.then(function (res) { return res.text(); })
.then(function (html) {
var m = html.match(CATALOG_RE);
if (!m) return { items: [], pages: 1 };
var pagesAttr = m[1].match(/data-pages="(\d+)"/);
var items = [];
try { items = JSON.parse(m[2]); } catch (e) { console.error('Outfit Builder: catalog JSON failed to parse', e); }
return { items: items, pages: pagesAttr ? parseInt(pagesAttr[1], 10) : 1 };
});
}
function loadCatalog(force) {
if (_catalogPromise && !force) return _catalogPromise;
_catalogPromise = fetchCatalogPage(1)
.then(function (first) {
var rest = [];
for (var p = 2; p <= first.pages; p++) rest.push(fetchCatalogPage(p));
return Promise.all(rest).then(function (pages) {
var seen = {};
var all = [];
[first].concat(pages).forEach(function (pg) {
pg.items.forEach(function (item) {
if (seen[item.id] || !item.variants || !item.variants.length) return;
seen[item.id] = true;
resolveVariantImages(item);
applyChips(item);
all.push(fixBucket(item));
});
});
return all;
});
})
.catch(function (e) {
console.error('Outfit Builder: catalog fetch failed', e);
return [];
});
return _catalogPromise;
}
function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hasWord(text, words) {
return words.some(function (w) {
return new RegExp('(^|[^a-záéíóúñ])' + escapeRe(w) + '($|[^a-záéíóúñ])').test(text);
});
}
function colorNamed(alt, color) {
var a = lc(alt), c = lc(color).trim();
if (!a || !c) return false;
return new RegExp('(^|[^a-z\\u00e0-\\u00ff])' + escapeRe(c) + '($|[^a-z\\u00e0-\\u00ff])').test(a);
}
/* Chips (2026-10-15): a verified white-background photo of the exact variant, from the catalog export
   (variant.chip, product metafield bonnamira.chips) or, while previewing, window.OB_CHIPS_PREVIEW[variantId]. */
function applyChips(item) {
var pre = window.OB_CHIPS_PREVIEW || null;
(item.variants || []).forEach(function (v) {
var u = v.chip || (pre && pre[String(v.id)]) || '';
if (u) { v.chip = String(u).replace(/^\/\//, 'https://'); v.noPhoto = false; } else delete v.chip;
});
}
function resolveVariantImages(item) {
var colors = [];
(item.variants || []).forEach(function (v) { if (v.color && colors.indexOf(v.color) === -1) colors.push(v.color); });
item.colorCount = colors.length;
item.imgColor = '';
if (colors.length > 1) {
var named = colors.filter(function (c) { return colorNamed(item.fa, c); });
named = named.filter(function (c) { return !named.some(function (o) { return o !== c && o.length > c.length && lc(o).indexOf(lc(c)) !== -1; }); });
if (named.length === 1) item.imgColor = named[0];
}
var gal = item.gal || [];
(item.variants || []).forEach(function (v) {
if (v.image || !v.color || colors.length < 2) return;
for (var i = 0; i < gal.length; i++) {
var hit = colors.filter(function (c) { return colorNamed(gal[i].a, c); });
hit = hit.filter(function (c) { return !hit.some(function (o) { return o !== c && o.length > c.length && lc(o).indexOf(lc(c)) !== -1; }); });
if (hit.length === 1 && hit[0] === v.color) { v.image = gal[i].u; v.imgFrom = 'alt'; return; }
}
if (!(item.imgColor && lc(item.imgColor) === lc(v.color))) v.noPhoto = true;
});
delete item.gal;
}
var SIZE_ALIASES = {
'XSMALL': 'XS', 'X-SMALL': 'XS', 'EXTRA SMALL': 'XS',
'SMALL': 'S', 'MEDIUM': 'M', 'LARGE': 'L',
'XLARGE': 'XL', 'X-LARGE': 'XL', 'EXTRA LARGE': 'XL',
'XXLARGE': 'XXL', 'XX-LARGE': 'XXL', '2XL': 'XXL', '2X': 'XXL',
'XXXL': '3XL', '3X': '3XL', '1X': '1XL', '0X': '0XL', '4X': '4XL', '5X': '5XL',
'ONE SIZE': 'ONESIZE', 'ONESIZE': 'ONESIZE', 'OS': 'ONESIZE', 'TALLA UNICA': 'ONESIZE', 'TALLA ÚNICA': 'ONESIZE'
};
var STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
var PLUS_SIZES = ['0XL', '1XL', '14W', '16W', '18W', '20W', '22W', '24W'];
function normalizeSize(s) {
if (s == null) return '';
var t = String(s).trim().toUpperCase().replace(/\s+/g, ' ');
return SIZE_ALIASES[t] || t;
}
function sizeTokens(raw) {
if (!raw) return [];
if (normalizeSize(raw) === 'ONESIZE') return ['ONESIZE'];
return String(raw).split('/').map(normalizeSize).filter(Boolean);
}
function isLetterSize(t) { return STANDARD_SIZES.indexOf(t) !== -1 || PLUS_SIZES.indexOf(t) !== -1; }
var US_TO_EU = { '4': 35, '4.5': 35, '5': 36, '5.5': 36, '6': 37, '6.5': 37, '7': 38, '7.5': 38, '8': 39, '8.5': 39,
'9': 40, '9.5': 40, '10': 41, '10.5': 42, '11': 43, '11.5': 43, '12': 44, '12.5': 44, '13': 45 };
var EU_TO_US = { 34: '3', 35: '4', 36: '5', 37: '6', 38: '7', 39: '8', 40: '9', 41: '10', 42: '10.5', 43: '11', 44: '12', 45: '13', 46: '14' };
function shoeEU(raw) {
var t = String(raw == null ? '' : raw).toUpperCase().replace(/\s+/g, '');
if (!t) return '';
var m = t.match(/^EU?(\d{2}(?:\.5)?)$/) || t.match(/^(\d{2}(?:\.5)?)(?:\(|$|\/)/);
if (m && +m[1] >= 33 && +m[1] <= 48) return String(Math.floor(+m[1]));
m = t.match(/US(\d{1,2}(?:\.5)?)/) || t.match(/^(\d{1,2}(?:\.5)?)$/);
if (m && US_TO_EU[String(+m[1])]) return String(US_TO_EU[String(+m[1])]);
return '';
}
function shoeUS(eu) { return EU_TO_US[+String(eu).replace(/^EU/i, '')] || ''; }
function isShoeKey(size) { return /^EU\d{2}$/.test(String(size || '')); }
function sizeMatches(variant, size) {
if (!size) return true;
if (isShoeKey(size)) return shoeEU(variant.size) === String(size).slice(2);
var want = normalizeSize(size);
var tokens = sizeTokens(variant.size);
if (!tokens.length) return false;
if (tokens.indexOf(want) !== -1) return true;
return tokens.indexOf('ONESIZE') !== -1 && isLetterSize(want);
}
function pickerTokens(variant) {
if (!variant.size) return [];
var toks = sizeTokens(variant.size);
if (/^\d+\s*\/\s*\d+$/.test(String(variant.size).trim())) toks = toks.slice(0, 1);
return toks;
}
var COLOR_FAMILIES = [
{ key: 'black',   label: 'Black',          swatch: '#1a1a1a', words: ['black', 'negro', 'noir', 'onyx', 'jet'] },
{ key: 'white',   label: 'White & Cream',  swatch: '#f7f3ea', words: ['white', 'blanco', 'ivory', 'cream', 'buttercream', 'off white', 'off-white', 'eggshell', 'bone', 'pearl', 'clear', 'transparent'] },
{ key: 'neutral', label: 'Beige & Nude',   swatch: '#d9c3a5', words: ['beige', 'tan', 'khaki', 'nude', 'sand', 'taupe', 'champagne', 'camel', 'stone', 'dust storm', 'oatmeal', 'apricot', 'latte'] },
{ key: 'brown',   label: 'Brown',          swatch: '#6b4423', words: ['brown', 'chocolate', 'cacao', 'mocha', 'caramel', 'cinnamon', 'coffee', 'espresso', 'cafe', 'café', 'cognac'] },
{ key: 'gray',    label: 'Gray',           swatch: '#8a8a8a', words: ['gray', 'grey', 'gris', 'charcoal', 'heather'] },
{ key: 'red',     label: 'Red',            swatch: '#b0262e', words: ['red', 'rojo', 'scarlet', 'burgundy', 'wine', 'maroon', 'cherry', 'crimson', 'ruby', 'garnet'] },
{ key: 'pink',    label: 'Pink',           swatch: '#f2a5bf', words: ['pink', 'rosa', 'rose', 'blush', 'fuchsia', 'magenta', 'barbie', 'cerise'] },
{ key: 'orange',  label: 'Orange & Coral', swatch: '#e8752c', words: ['orange', 'naranja', 'tangerine', 'coral', 'rust', 'terracotta', 'peach', 'sherbet', 'salmon'] },
{ key: 'yellow',  label: 'Yellow',         swatch: '#f1c40f', words: ['yellow', 'amarillo', 'mustard', 'butter', 'lemon'] },
{ key: 'green',   label: 'Green',          swatch: '#3d8b57', words: ['green', 'verde', 'sage', 'olive', 'oliva', 'moss', 'emerald', 'lime', 'mint', 'forest', 'seafoam'] },
{ key: 'blue',    label: 'Blue',   swatch: '#3a6ea5', words: ['blue', 'azul', 'navy', 'teal', 'turquoise', 'cobalt', 'indigo', 'aqua'] },
{ key: 'denim',   label: 'Denim',          swatch: '#4f74a3', words: ['denim', 'chambray', 'wash', 'washed', 'jean', 'jeans'] },
{ key: 'purple',  label: 'Purple',         swatch: '#7d5ba6', words: ['purple', 'morado', 'lilac', 'plum', 'mauve', 'lavender', 'violet', 'amethyst'] },
{ key: 'metallic', label: 'Gold & Silver', swatch: 'linear-gradient(135deg,#cfa435,#f3e2a6 50%,#c0c0c0)', words: ['gold', 'golden', 'dorado', 'silver', 'plata', 'metallic', 'iridescent'] },
{ key: 'multi', label: 'Multicolor', swatch: 'conic-gradient(#e0809f,#f1c40f,#3d8b57,#3a6ea5,#7d5ba6,#e0809f)', words: ['multicolor', 'multicolour', 'multicolored', 'multi-color', 'multi', 'colorful', 'colourful', 'rainbow'] }
];
var CONTRAST = {
black:    ['white', 'red', 'neutral', 'metallic', 'pink', 'gray'],
white:    ['black', 'blue', 'neutral', 'brown', 'red', 'metallic'],
neutral:  ['white', 'black', 'brown', 'blue', 'metallic'],
brown:    ['neutral', 'white', 'blue', 'green', 'black'],
gray:     ['black', 'white', 'pink', 'blue', 'purple'],
red:      ['black', 'white', 'neutral', 'blue', 'gray', 'metallic'],
pink:     ['white', 'gray', 'neutral', 'blue', 'black', 'metallic'],
orange:   ['white', 'neutral', 'blue', 'brown', 'black'],
yellow:   ['white', 'blue', 'gray', 'black', 'neutral'],
green:    ['neutral', 'white', 'brown', 'black', 'metallic'],
blue:     ['white', 'neutral', 'brown', 'gray', 'black'],
purple:   ['gray', 'black', 'white', 'neutral', 'metallic'],
metallic: ['black', 'white', 'neutral', 'red'],
multi:    ['black', 'white', 'neutral', 'denim', 'brown']
};
(function () {
function addDenim(tbl) {
Object.keys(tbl).forEach(function (k) { var i = tbl[k].indexOf('blue'); if (i !== -1 && tbl[k].indexOf('denim') === -1) tbl[k].splice(i + 1, 0, 'denim'); });
tbl.denim = tbl.blue.slice();
}
addDenim(CONTRAST);
})();
var JEWEL_PAIR = {
black:    ['red', 'metallic', 'white', 'green', 'blue', 'pink'],
white:    ['blue', 'metallic', 'green', 'pink', 'red', 'purple'],
neutral:  ['green', 'metallic', 'white', 'blue', 'orange', 'brown'],
brown:    ['orange', 'metallic', 'green', 'neutral', 'white'],
gray:     ['pink', 'metallic', 'purple', 'blue', 'white'],
red:      ['metallic', 'red', 'black', 'white', 'pink'],
pink:     ['white', 'pink', 'metallic', 'purple', 'green'],
orange:   ['blue', 'orange', 'metallic', 'white', 'green'],
yellow:   ['blue', 'yellow', 'metallic', 'white', 'purple'],
green:    ['pink', 'green', 'metallic', 'white', 'orange'],
blue:     ['orange', 'blue', 'metallic', 'white', 'yellow'],
purple:   ['green', 'purple', 'metallic', 'white', 'pink'],
metallic: ['metallic', 'black', 'white', 'red']
};
var JEWEL_BUCKETS = { neck: 1, wrist: 1, ring: 1, ear: 1 };
(function () {
Object.keys(JEWEL_PAIR).forEach(function (k) { var i = JEWEL_PAIR[k].indexOf('blue'); if (i !== -1 && JEWEL_PAIR[k].indexOf('denim') === -1) JEWEL_PAIR[k].splice(i + 1, 0, 'denim'); });
JEWEL_PAIR.denim = JEWEL_PAIR.blue.slice();
})();
function jewelList(heroFams) {
var list = [];
heroFams.forEach(function (f) { (JEWEL_PAIR[f] || ['metallic', 'white']).forEach(function (c) { if (list.indexOf(c) === -1) list.push(c); }); });
['metallic', 'white'].forEach(function (c) { if (list.indexOf(c) === -1) list.push(c); });
return list;
}
function metalIn(t) {
t = String(t || '').toLowerCase();
if (/rose[\s-]?gold/.test(t)) return 'rose';
var silver = /silver|sterling|\b925\b|platinum|rhodium|white gold/.test(t);
var gold = /\bgold|golden|\b(14|18|24)k\b|brass/.test(t.replace(/white gold/g, ''));
if (gold && !silver) return 'gold';
if (silver && !gold) return 'silver';
return '';
}
function metalOf(p, v) {
return metalIn(v && v.color) || (p && p.mt && p.mt !== 'mixed' ? p.mt : '') || metalIn(p && p.title);
}
var MOTIF_WORDS = {
heart: 'heart', hearts: 'heart', flower: 'flower', flowers: 'flower', floral: 'flower', daisy: 'flower', lotus: 'flower', petal: 'flower', petals: 'flower',
pearl: 'pearl', pearls: 'pearl', turquoise: 'turquoise', zircon: 'zircon', cz: 'zircon', pave: 'zircon', moissanite: 'zircon',
crystal: 'crystal', crystals: 'crystal', rhinestone: 'crystal', glass: 'crystal', stone: 'stone', agate: 'stone', quartz: 'stone', jade: 'stone', gemstone: 'stone',
bead: 'bead', beaded: 'bead', beads: 'bead', shell: 'shell', starfish: 'shell', star: 'star', sun: 'sun', moon: 'moon', leaf: 'leaf',
teardrop: 'teardrop', waterdrop: 'teardrop', drop: 'teardrop', geometric: 'geometric', resin: 'resin', enamel: 'enamel', raffia: 'woven', woven: 'woven',
knot: 'knot', tassel: 'tassel', butterfly: 'butterfly', layered: 'layered', 'double-layer': 'layered', 'triple-layer': 'layered', 'three-layer': 'layered'
};
function motifsOf(p) {
var out = [];
String((p && p.title) || '').toLowerCase().split(/[^a-z0-9\-]+/).forEach(function (w) {
var m = MOTIF_WORDS[w];
if (m && out.indexOf(m) === -1) out.push(m);
});
return out;
}
function setNameOf(p) {
var m = String((p && p.title) || '').match(/^([A-Z][a-z]+)\s/);
return m && !MOTIF_WORDS[m[1].toLowerCase()] ? m[1] : '';
}
function anchorScore(p, v, anchors, jewel) {
var fams = variantFamilies(v, p).filter(function (f) { return f !== 'metallic'; });
var metal = jewel ? metalOf(p, v) : '';
var motifs = jewel ? motifsOf(p) : [];
var setName = jewel ? setNameOf(p) : '';
var score = 0;
anchors.forEach(function (a) {
var both = jewel && a.jewel;
var af = variantFamilies(a.v, a.p).filter(function (f) { return f !== 'metallic'; });
var shared = fams.some(function (f) { return af.indexOf(f) !== -1; });
if (shared) score += both ? 4 : 2;
else if (both && fams.length && af.length && jewelList(af).slice(0, 2).indexOf(fams[0]) !== -1) score += 1;
if (!both) return;
var am = metalOf(a.p, a.v);
if (metal && am) score += metal === am ? 4 : -4;
var mm = motifsOf(a.p).filter(function (m) { return motifs.indexOf(m) !== -1; }).length;
score += Math.min(mm, 3) * 2;
if (setName && setName === setNameOf(a.p)) score += 6;
});
return score;
}
var ACCESSORY_NEUTRALS = ['black', 'neutral', 'metallic', 'white', 'brown', 'multi'];
var _famCache = {};
var COLOR_ALIASES = [
[/black forest/g, 'forest'],
[/\bcow( print)?\b/g, 'white black'],
[/\bzebra\b/g, 'black white'],
[/\b(leopard|cheetah)\b/g, 'brown'],
[/\bcamo(uflage)?\b/g, 'olive'],
[/\bgun ?(color|colour|metal)\b/g, 'charcoal'],
[/\bgunmetal\b/g, 'charcoal'],
[/\bhulan\b/g, 'teal'],
[/\baquamarine\b/g, 'sky blue'],
[/\bquicksand\b/g, 'sand'],
[/\bskin( colou?r)?\b/g, 'nude'],
[/\bstrawberry\b/g, 'bright red'],
[/\bmatcha\b/g, 'sage'],
[/\bgum leaf\b/g, 'sage'],
[/\bamber\b/g, 'mustard'],
[/\brhinestones?\b/g, 'silver'],
[/\bfloral\b/g, 'multicolor'],
[/^dark$/, 'dark wash'],
[/^medium$/, 'medium wash'],
[/^light$/, 'light wash']
];
function colorFamilies(color) {
if (!color) return [];
var key = lc(color);
if (_famCache[key]) return _famCache[key];
// 2026-10-22 swatch/chip alignment: print and compound names map to the colour you actually see,
// and families come back in the order the colour name lists them ([0] = PRIMARY, drives the swatch dot).
COLOR_ALIASES.forEach(function (al) { key = key.replace(al[0], al[1]); });
var hits = [];
COLOR_FAMILIES.forEach(function (f, order) {
var at = -1, len = 0;
f.words.forEach(function (w) {
var m = new RegExp('(^|[^a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1])' + escapeRe(w) + '($|[^a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1])').exec(key);
if (!m) return;
var pos = m.index + m[1].length;
if (at === -1 || pos < at || (pos === at && w.length > len)) { at = pos; len = w.length; }
});
if (at !== -1) hits.push({ k: f.key, at: at, len: len, order: order });
});
var out = hits.sort(function (x, y) { return x.at - y.at || y.len - x.len || x.order - y.order; }).map(function (h) { return h.k; });
_famCache[key] = out;
return out;
}
/* Dominant colour rule (2026-10-22): a multicolour piece is filed under its DOMINANT colour first and
   multicolor second. Dominant = a real colour in the variant name (e.g. "Silver/Multi"), else the product's
   dominant-colour field (dc, metafield bonnamira.dominant), else the colour after " in " in the title. */
function titleColorFamilies(product) {
if (!product) return [];
var t = String(product.fullTitle || product.title || ''), m = / in ([^|]+)$/i.exec(t);
var f = m ? colorFamilies(m[1]) : [];
return f.length ? f : colorFamilies(t);
}
function variantFamilies(variant, product) {
var fams = colorFamilies(variant.color);
if (fams.indexOf('multi') !== -1) {
var real = fams.filter(function (f) { return f !== 'multi'; });
if (!real.length && product) {
real = (product.dc ? colorFamilies(product.dc) : titleColorFamilies(product)).filter(function (f) { return f !== 'multi'; });
}
return real.length ? [real[0], 'multi'] : ['multi'];
}
if (!fams.length && product && product.dc) fams = colorFamilies(product.dc);
if (!fams.length && product) fams = titleColorFamilies(product);
return fams;
}
function swatchFor(variant, product) {
var fams = variant ? variantFamilies(variant, product) : [];
if (!fams.length) return '#d8cfc2';
function one(fam) {
var meta = familyMeta(fam), list = SHADES[fam], text = lc(variant.color) + (colorFamilies(variant.color).indexOf(fam) === -1 && product ? ' ' + lc(product.dc || (/ in ([^|]+)$/i.exec(String(product.fullTitle || product.title || '')) || ['', ''])[1]) : ''), best = null, bestLen = 0;
COLOR_ALIASES.forEach(function (al) { text = text.replace(al[0], al[1]); });
(list || []).forEach(function (sh, i) { if (i === 1) return; sh.words.forEach(function (w) { if (w.length > bestLen && hasWord(text, [w])) { best = sh; bestLen = w.length; } }); });
if (!best && list && list[1]) best = list[1];
return best ? best.swatch : (meta ? meta.swatch : '#d8cfc2');
}
var a = one(fams[0]);
if (fams.length > 1 && a.indexOf('gradient') === -1) { var b = one(fams[1]); if (b.indexOf('gradient') === -1 && b !== a) return 'linear-gradient(135deg,' + a + ' 50%,' + b + ' 50%)'; }
return a;
}
function colorMatches(variant, family, product) {
if (!family) return true;
return variantFamilies(variant, product).indexOf(family) !== -1;
}
function familyMeta(key) {
for (var i = 0; i < COLOR_FAMILIES.length; i++) if (COLOR_FAMILIES[i].key === key) return COLOR_FAMILIES[i];
return null;
}
function familyLabel(key) { var f = familyMeta(key); return f ? f.label : key; }
var PATTERNS = [
{ key: 'floral',    label: 'Floral',             words: ['floral', 'flower', 'flowers', 'botanical', 'blossom'] },
{ key: 'animal',    label: 'Animal print',       words: ['leopard', 'zebra', 'snake', 'snakeskin', 'cheetah', 'animal', 'tiger', 'croc'] },
{ key: 'stripes',   label: 'Stripes',            words: ['stripe', 'stripes', 'striped', 'pinstripe'] },
{ key: 'tropical',  label: 'Tropical & resort',  words: ['tropical', 'palm', 'seashell', 'shell print'] },
{ key: 'geometric', label: 'Geometric & plaid',  words: ['geometric', 'abstract', 'polka', 'plaid', 'gingham', 'checkered', 'splatter', 'star-print', 'star print', 'tie-dye'] },
{ key: 'print',     label: 'Other prints',       words: ['print', 'printed', 'pattern', 'multicolor', 'multi', 'mix'] }
];
var _patCache = {};
function variantPattern(variant, product) {
var key = (product ? product.id : '') + '|' + lc(variant.color);
if (_patCache[key] != null) return _patCache[key];
var text = lc(variant.color) + ' | ' + lc(product ? product.title : '');
var hit = '';
for (var i = 0; i < PATTERNS.length; i++) {
if (hasWord(text, PATTERNS[i].words)) { hit = PATTERNS[i].key; break; }
}
_patCache[key] = hit;
return hit;
}
function patternLabel(key) {
for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].key === key) return PATTERNS[i].label;
return key;
}
var ALL_OCCASIONS = ['casual', 'work', 'brunch', 'dinner', 'clubbing', 'after-hours', 'formal', 'gala', 'gym', 'vacation', 'beach'];
var EVENING = ['dinner', 'clubbing', 'after-hours', 'formal', 'gala'];
var ADDON_RULES = [
{ words: ['duffel', 'gym', 'sports', 'racket'],                            occ: ['gym', 'vacation'] },
{ words: ['straw', 'woven', 'crochet', 'raffia', 'rattan'],               occ: ['beach', 'vacation', 'brunch', 'casual'] },
{ words: ['chain', 'quilted', 'clutch', 'metallic', 'iridescent', 'ruched', 'snakeskin', 'embroidered', 'evening'], occ: EVENING.concat(['brunch']) },
{ words: ['top handle', 'top-handle', 'structured', 'buckle', 'tote'],    occ: ['work', 'dinner', 'casual', 'brunch'] },
{ words: ['earrings', 'earring', 'hoop', 'hoops', 'necklace', 'choker', 'pendant', 'bracelet', 'bangle', 'ring', 'pearl'], occ: EVENING.concat(['brunch', 'vacation', 'beach', 'casual', 'work']) },
{ words: ['belt'],                                                         occ: ['work', 'casual', 'dinner', 'brunch'] },
{ words: ['sash', 'obi', 'waist chain', 'body chain', 'belly chain', 'corset belt', 'cincher', 'waist wrap'], occ: EVENING.concat(['brunch', 'vacation', 'beach', 'casual']) },
{ words: ['chain belt', 'charm chain', 'hip chain', 'waist bead', 'waist beads', 'ribbon belt', 'tie belt', 'elastic belt', 'twilly'], occ: EVENING.concat(['brunch', 'vacation', 'beach', 'casual']) },
{ words: ['scarf', 'bandana', 'shawl', 'kerchief'],                        occ: ['work', 'casual', 'brunch', 'dinner', 'vacation', 'beach'] },
{ words: ['headband', 'scrunchie', 'hair'],                                occ: ['gym', 'casual', 'beach', 'vacation', 'brunch'] },
{ words: ['hat', 'hats', 'visor', 'beret', 'cap', 'sun hat', 'bucket hat'], occ: ['casual', 'beach', 'vacation', 'brunch'] },
{ words: ['shawl', 'shawls', 'stole', 'pashmina', 'wrap', 'cape', 'capelet', 'poncho', 'shrug', 'kimono', 'cover up', 'cover-up'], occ: ['work', 'casual', 'brunch', 'dinner', 'vacation', 'beach', 'formal', 'gala'] }
];
function occasionsOf(product) {
if (product._occ) return product._occ;
var occ = (product.occasionTags || []).map(function (t) { return t.replace(/^occasion:/, ''); });
if (!occ.length && product.addon) {
var t = lc(product.title);
var set = {};
ADDON_RULES.forEach(function (r) {
if (hasWord(t, r.words)) r.occ.forEach(function (o) { set[o] = true; });
});
occ = Object.keys(set);
if (!occ.length) occ = ['casual', 'brunch', 'dinner', 'work'];
}
product._occ = occ;
return occ;
}
function hasOccasion(product, occasion) {
return !occasion || occasionsOf(product).indexOf(occasion) !== -1;
}
var CASUAL_ADJ_ON = true;
var CASUAL_ADJ = ['brunch', 'vacation', 'beach', 'work'];
function heroHasOccasion(product, occasion) {
if (hasOccasion(product, occasion)) return true;
if (!CASUAL_ADJ_ON || occasion !== 'casual') return false;
var occ = occasionsOf(product);
return CASUAL_ADJ.some(function (o) { return occ.indexOf(o) !== -1; });
}
var STRICT_OCC = { 'gym': true, 'beach': true };
function isStrictOccasion(o) { return !!STRICT_OCC[o]; }
var OCC_FALLBACK = {
'casual':      ['brunch', 'vacation', 'work'],
'work':        ['dinner'],
'brunch':      ['vacation', 'dinner'],
'dinner':      ['formal', 'clubbing'],
'clubbing':    ['after-hours', 'dinner'],
'after-hours': ['clubbing', 'dinner'],
'formal':      ['gala'],
'gala':        ['formal'],
'gym':         [],  // strict: see STRICT_OCC
'vacation':    ['beach', 'brunch'],
'beach':       ['vacation']
};
var PARTNER_UNION_ON = true;
function partnerPool(catalog, bucket, occasion, accept) {
accept = accept || function () { return true; };
var strict = isStrictOccasion(occasion);
var chain = strict ? [occasion] : [occasion].concat(OCC_FALLBACK[occasion] || []);
var out = [], seen = {};
out.rank = {};  // product id -> position in the occasion chain (0 = exact)
var curRank = 0;
function add(p) { if (!seen[p.id]) { seen[p.id] = true; out.rank[p.id] = curRank; out.push(p); } }
for (var i = 0; i < chain.length; i++) {
var o = chain[i];
curRank = i;
catalog.forEach(function (p) { if (p.bucket === bucket && hasOccasion(p, o) && accept(p)) add(p); });
if (!PARTNER_UNION_ON && out.length >= MIN_OPTIONS + 2) return out;
}
if (occasion === 'casual' && out.length < MIN_OPTIONS) catalog.forEach(function (p) { if (p.bucket === bucket && accept(p)) add(p); });
return out;
}
var WRAP_WORDS = ['sash', 'obi', 'waist chain', 'body chain', 'belly chain', 'hip chain', 'waist bead', 'waist beads', 'corset belt', 'cincher', 'waist wrap', 'tie belt', 'ribbon belt', 'chain belt', 'charm chain', 'elastic belt'];
var SCARF_WORDS = ['scarf', 'scarves', 'bandana', 'twilly', 'kerchief', 'shawl'];
function waistKind(p) {
if (!p || p.bucket === 'bag') return '';
var t = lc(p.title);
if (/\b(belt|waist|fanny)\s+bag\b|\bbelt bag\b/.test(t)) return '';
if (/\b(hair|head|pet|dog|cat|bib|neck gaiter)\b/.test(t)) return '';
if (hasWord(t, WRAP_WORDS)) return 'wrap';
if (/\bbelts?\b/.test(t)) return 'belt';
return '';
}
function jewelKind(p) {
var t = lc(p.title), ty = lc(p.type);
if (ty === 'necklaces' || hasWord(t, ['necklace', 'necklaces', 'choker', 'pendant', 'collar', 'scarf', 'scarves', 'twilly', 'kerchief', 'neckerchief'])) return 'neck';  // v3.4: scarves wear at the neck
if (ty === 'bracelets' || hasWord(t, ['bracelet', 'bracelets', 'bangle', 'bangles', 'cuff', 'watch'])) return 'wrist';
if (ty === 'earrings' || hasWord(t, ['earring', 'earrings', 'hoop', 'hoops', 'studs'])) return 'ear';
if (ty === 'rings' || hasWord(t, ['ring', 'rings'])) return 'ring';
return '';
}
var HEAD_WORDS = ['headband', 'headbands', 'hair', 'scrunchie', 'scrunchies', 'barrette', 'claw clip', 'hair clip', 'bandana', 'headscarf', 'head scarf', 'head wrap', 'headwrap', 'turban', 'hat', 'hats', 'visor', 'beret', 'fascinator', 'sun hat', 'bucket hat'];
var SHOULDER_WORDS = ['shawl', 'shawls', 'stole', 'pashmina', 'cape', 'capelet', 'poncho', 'shrug', 'kimono', 'wrap', 'cover up', 'cover-up', 'bolero'];
function extraKind(p) {
if (!p || p.bucket === 'bag') return '';
var t = lc(p.title);
if (hasWord(t, HEAD_WORDS)) return 'head';
if (hasWord(t, SHOULDER_WORDS) && !hasWord(t, ['ring', 'rings', 'bracelet', 'necklace', 'waist wrap'])) return 'shoulder';
if (hasWord(t, ['scarf', 'scarves']) && /\b(sheer|lace|oversized|long|blanket|maxi)\b/.test(t)) return 'shoulder';
return '';
}
function fixBucket(p) {
if (p && p.bucket === 'accessory') {
if (waistKind(p)) p.bucket = 'waist';
else if (extraKind(p)) p.bucket = 'extra';
else { var jk = jewelKind(p); if (jk) p.bucket = jk; }
}
return p;
}
var SLOT_BUCKET = { wrist2: 'wrist', ring2: 'ring' };
function slotBucket(slot) { return SLOT_BUCKET[slot] || slot; }
var NO_LOOP_WORDS = ['legging', 'leggings', 'jogger', 'joggers', 'sweat', 'sweatpants', 'lounge', 'yoga', 'biker', 'athletic', 'skirt', 'ribbed', 'knit', 'drawstring', 'elastic', 'pull-on', 'pull on', 'chain-waist', 'belted'];
var LOOP_WORDS = ['jeans', 'jean', 'denim', 'trouser', 'trousers', 'chino', 'chinos', 'cargo', 'slacks', 'tailored', 'bermuda'];
function loopsOf(p) {
if (!p) return false;
if (p.lp === 'y') return true;
if (p.bucket === 'look' || p.bucket === 'top') return false;
if (p.bucket !== 'bottom') return false;
if (p.lp === 'n') return false;
if (p.lp === 'h') return true;
var t = lc(p.title);
if (hasWord(t, NO_LOOP_WORDS) && !hasWord(t, ['jeans', 'jean', 'denim'])) return false;
return hasWord(t, LOOP_WORDS);
}
function waistAllowed(p, beltOk) {
var k = waistKind(p);
if (!k) return false;
if (k === 'belt') return !!beltOk;
return true;
}
function heroBuckets(style) { return style === 'separates' ? ['top'] : ['look']; }
function clothingBuckets(style) { return style === 'separates' ? ['top', 'bottom'] : ['look']; }
function variantPasses(v, p, a, opts) {
if (!opts.skipSize && !sizeMatches(v, a.size)) return false;
var pat = variantPattern(v, p);
if (!opts.skipFinish) {
if (a.finish === 'solid' && pat) return false;
if (a.finish === 'print' && !pat) return false;
}
if (!opts.skipColor && a.finish === 'solid' && a.color && !colorMatches(v, a.color, p)) return false;
if (!opts.skipPattern && a.finish === 'print' && a.pattern && pat !== a.pattern) return false;
return true;
}
function heroPool(catalog, a, opts) {
opts = opts || {};
var buckets = heroBuckets(a.style);
return catalog.filter(function (p) {
return buckets.indexOf(p.bucket) !== -1 && heroHasOccasion(p, a.occasion) &&
p.variants.some(function (v) { return variantPasses(v, p, a, opts); });
});
}
function options(catalog, a, step) {
if (step === 'occasion') {
return ALL_OCCASIONS.filter(function (o) {
return options(catalog, assign(a, { occasion: o }), 'style').length > 0;
});
}
if (step === 'style') {
return ['dress', 'separates'].filter(function (s) {
var b = assign(a, { style: s, size: '', finish: '', color: '', pattern: '' });
if (!heroPool(catalog, b).length) return false;
return s !== 'separates' || partnerPool(catalog, 'bottom', a.occasion).length > 0;
});
}
if (step === 'size') {
var perBucket = clothingBuckets(a.style).map(function (b) {
var present = {};
var pool = heroBuckets(a.style).indexOf(b) !== -1
? catalog.filter(function (p) { return p.bucket === b && heroHasOccasion(p, a.occasion); })
: partnerPool(catalog, b, a.occasion);
pool.forEach(function (p) {
p.variants.forEach(function (v) { pickerTokens(v).forEach(function (t) { present[t] = true; }); });
});
if (present.ONESIZE) STANDARD_SIZES.forEach(function (s) { present[s] = present[s] || 'onesize'; });
return present;
});
var ok = function (t) { return perBucket.every(function (pr) { return pr[t]; }); };
var real = function (t) { return perBucket.some(function (pr) { return pr[t] === true; }); };
var keys = Object.keys(perBucket[0] || {});
return {
standard: STANDARD_SIZES.filter(function (s) { return ok(s) && real(s); }),
plus: PLUS_SIZES.filter(function (s) { return ok(s) && real(s); }),
numeric: keys.filter(function (t) { return /^\d{1,2}$/.test(t) && parseInt(t, 10) <= 20 && ok(t); })
.sort(function (x, y) { return parseInt(x, 10) - parseInt(y, 10); })
};
}
if (step === 'finish') {
return {
solid: heroPool(catalog, assign(a, { finish: 'solid', color: '', pattern: '' })).length,
print: heroPool(catalog, assign(a, { finish: 'print', color: '', pattern: '' })).length
};
}
if (step === 'color') {
var pool = heroPool(catalog, assign(a, { finish: 'solid', color: '' }));
var counts = {};
var shades = {};
pool.forEach(function (p) {
var fams = {};
p.variants.forEach(function (v) {
if (!variantPasses(v, p, assign(a, { finish: 'solid', color: '' }), {})) return;
variantFamilies(v, p).forEach(function (f) {
fams[f] = true;
var name = v.color || '';
if (name) { shades[f] = shades[f] || {}; shades[f][name] = true; }
});
});
Object.keys(fams).forEach(function (f) { counts[f] = (counts[f] || 0) + 1; });
});
return COLOR_FAMILIES.filter(function (f) { return counts[f.key]; }).map(function (f) {
return { key: f.key, label: f.label, swatch: f.swatch, products: counts[f.key], shades: Object.keys(shades[f.key] || {}).slice(0, 4) };
});
}
if (step === 'pattern') {
var ppool = heroPool(catalog, assign(a, { finish: 'print', pattern: '' }));
var byPat = {};
ppool.forEach(function (p) {
var pats = {};
p.variants.forEach(function (v) {
if (!variantPasses(v, p, assign(a, { finish: 'print', pattern: '' }), {})) return;
pats[variantPattern(v, p)] = true;
});
Object.keys(pats).forEach(function (k) {
byPat[k] = byPat[k] || { products: 0, image: null };
byPat[k].products++;
if (!byPat[k].image && p.image) byPat[k].image = p.image;
});
});
return PATTERNS.filter(function (pt) { return byPat[pt.key]; }).map(function (pt) {
return { key: pt.key, label: pt.label, products: byPat[pt.key].products, image: byPat[pt.key].image };
});
}
return null;
}
function assign(a, b) {
var o = {};
Object.keys(a).forEach(function (k) { o[k] = a[k]; });
Object.keys(b).forEach(function (k) { o[k] = b[k]; });
return o;
}
function heroFamilies(product, variant, a) {
if (a.finish === 'solid' && a.color) return [a.color];
var v = variant || product.variants[0];
var fams = variantFamilies(v, product);
return fams.length ? fams : ['black'];
}
function contrastList(heroFams, forAccessory) {
var list = [];
heroFams.forEach(function (f) { (CONTRAST[f] || []).forEach(function (c) { if (list.indexOf(c) === -1) list.push(c); }); });
var tail = forAccessory ? ACCESSORY_NEUTRALS : ['black', 'white', 'neutral', 'blue', 'brown', 'gray'];
if (forAccessory) list = ACCESSORY_NEUTRALS.filter(function (n) { return list.indexOf(n) !== -1; }).concat(list);
tail.forEach(function (c) { if (list.indexOf(c) === -1) list.push(c); });
if (forAccessory) return list;
return list.filter(function (c) { return heroFams.indexOf(c) === -1; });
}
function variantScore(v, p, list, heroIsPrint) {
var fams = variantFamilies(v, p);
var best = 50;
fams.forEach(function (f) { var i = list.indexOf(f); if (i !== -1 && i < best) best = i; });
if (!fams.length) best = 20;
var pat = variantPattern(v, p);
if (pat && heroIsPrint) best += 30;
if (pat && !heroIsPrint) best += 8;
return best;
}
function sizeFor(a, bucket) {
if (bucket === 'bottom') return a.sizeBottom !== undefined ? a.sizeBottom : a.size;
if (bucket === 'shoes') return a.sizeShoe || '';
if (bucket === 'top' || bucket === 'look') return a.size;
return '';
}
function sizeChoices(catalog, a, bucket) {
var pool = heroBuckets(a.style).indexOf(bucket) !== -1
? catalog.filter(function (p) { return p.bucket === bucket && heroHasOccasion(p, a.occasion); })
: partnerPool(catalog, bucket, a.occasion);
var present = {};
pool.forEach(function (p) {
p.variants.forEach(function (v) {
sizeTokens(v.size).forEach(function (t) { present[t] = true; });
pickerTokens(v).forEach(function (t) { present[t] = true; });
});
});
var clothing = bucket !== 'shoes';
if (!clothing) {
var eu = {};
pool.forEach(function (p) { p.variants.forEach(function (v) { var n = shoeEU(v.size); if (n) eu[n] = true; }); });
return Object.keys(eu).sort(function (x, y) { return x - y; }).map(function (n) { return 'EU' + n; });
}
if (clothing && present.ONESIZE) STANDARD_SIZES.forEach(function (x) { present[x] = true; });
delete present.ONESIZE;
var keys = Object.keys(present);
var letters = STANDARD_SIZES.filter(function (x) { return present[x]; });
var plus = PLUS_SIZES.filter(function (x) { return present[x]; });
var rest = keys.filter(function (k) { return letters.indexOf(k) === -1 && plus.indexOf(k) === -1; })
.sort(function (x, y) { return parseFloat(x) - parseFloat(y) || (x < y ? -1 : 1); });
return letters.concat(plus, rest);
}
var SHADES = {
white:   [{ key: 'snow', label: 'Bright white', swatch: '#fbfaf7', words: ['white', 'snow', 'optic'] }, { key: 'ivory', label: 'Ivory', swatch: '#f3ead6', words: ['ivory', 'off white', 'off-white', 'eggshell', 'bone'] }, { key: 'cream', label: 'Cream', swatch: '#ecdcb8', words: ['cream', 'buttercream', 'pearl'] }],
neutral: [{ key: 'nude', label: 'Nude', swatch: '#dcbca1', words: ['nude', 'apricot', 'oatmeal'] }, { key: 'sand', label: 'Sand', swatch: '#d8c3a2', words: ['beige', 'sand', 'stone', 'khaki', 'tan', 'latte'] }, { key: 'taupe', label: 'Taupe', swatch: '#a8927a', words: ['taupe', 'camel', 'champagne', 'dust storm'] }],
brown:   [{ key: 'caramel', label: 'Caramel', swatch: '#b98a52', words: ['caramel', 'cognac', 'cinnamon', 'light brown'] }, { key: 'brown', label: 'Brown', swatch: '#7a5238', words: ['brown', 'mocha', 'coffee', 'cafe', 'café'] }, { key: 'espresso', label: 'Espresso', swatch: '#44291f', words: ['chocolate', 'espresso', 'cacao', 'dark brown'] }],
gray:    [{ key: 'light', label: 'Light gray', swatch: '#c9c9c9', words: ['light gray', 'light grey', 'heather', 'ash'] }, { key: 'gray', label: 'Gray', swatch: '#8c8c8c', words: ['gray', 'grey', 'gris'] }, { key: 'charcoal', label: 'Charcoal', swatch: '#3b3b3d', words: ['charcoal', 'dark gray', 'dark grey', 'graphite'] }],
red:     [{ key: 'bright', label: 'Bright red', swatch: '#d4303a', words: ['cherry', 'scarlet', 'cerise', 'bright red', 'crimson'] }, { key: 'red', label: 'Classic red', swatch: '#b0262e', words: ['red', 'rojo', 'ruby'] }, { key: 'wine', label: 'Burgundy', swatch: '#6d1f2f', words: ['burgundy', 'wine', 'maroon', 'garnet', 'dark red'] }],
pink:    [{ key: 'blush', label: 'Blush', swatch: '#f0c4c4', words: ['blush', 'baby pink', 'light pink', 'pale pink'] }, { key: 'rose', label: 'Rose', swatch: '#e0809f', words: ['pink', 'rosa', 'rose', 'barbie'] }, { key: 'hot', label: 'Hot pink', swatch: '#d6286f', words: ['hot pink', 'fuchsia', 'magenta', 'cerise'] }],
orange:  [{ key: 'peach', label: 'Peach', swatch: '#f4b98f', words: ['peach', 'salmon', 'sherbet'] }, { key: 'orange', label: 'Orange & coral', swatch: '#ec7a3c', words: ['orange', 'naranja', 'tangerine', 'coral'] }, { key: 'rust', label: 'Rust', swatch: '#a64a24', words: ['rust', 'terracotta', 'burnt orange'] }],
yellow:  [{ key: 'lemon', label: 'Lemon', swatch: '#f5e26a', words: ['lemon', 'butter', 'pale yellow'] }, { key: 'yellow', label: 'Sunny yellow', swatch: '#f1c40f', words: ['yellow', 'amarillo'] }, { key: 'mustard', label: 'Mustard', swatch: '#c9981a', words: ['mustard', 'honey'] }],
green:   [{ key: 'sage', label: 'Sage & mint', swatch: '#a9c4a0', words: ['sage', 'mint', 'seafoam', 'light green', 'pistachio'] }, { key: 'green', label: 'Emerald', swatch: '#2f8a5a', words: ['green', 'verde', 'emerald', 'lime', 'kelly'] }, { key: 'olive', label: 'Olive & forest', swatch: '#4d5a32', words: ['olive', 'oliva', 'forest', 'moss', 'dark green', 'hunter'] }],
blue:    [{ key: 'sky', label: 'Sky blue', swatch: '#8fc3e8', words: ['sky', 'baby blue', 'light blue', 'powder', 'ice', 'aqua'] }, { key: 'blue', label: 'Royal blue', swatch: '#2b50b0', words: ['blue', 'azul', 'royal', 'cobalt', 'turquoise', 'teal'] }, { key: 'navy', label: 'Navy', swatch: '#1f2f55', words: ['navy', 'midnight', 'dark blue', 'indigo'] }],
denim:   [{ key: 'lightwash', label: 'Light wash', swatch: '#a9c3de', words: ['light wash', 'light denim', 'bleach', 'bleached'] }, { key: 'mid', label: 'Medium wash', swatch: '#5b7fa8', words: ['denim', 'medium wash', 'mid wash', 'chambray', 'wash', 'washed', 'jean', 'jeans'] }, { key: 'darkwash', label: 'Dark wash', swatch: '#273a5c', words: ['dark wash', 'dark denim', 'raw denim'] }],
purple:  [{ key: 'lilac', label: 'Lavender', swatch: '#c8a8d8', words: ['lavender', 'lilac', 'light purple', 'mauve'] }, { key: 'purple', label: 'Violet', swatch: '#7d5ba6', words: ['purple', 'violet', 'morado', 'amethyst'] }, { key: 'plum', label: 'Plum', swatch: '#5a2a50', words: ['plum', 'eggplant', 'dark purple', 'grape'] }],
metallic: [{ key: 'gold', label: 'Gold', swatch: '#d9a72a', words: ['gold', 'golden', 'dorado'] }, { key: 'silver', label: 'Silver', swatch: '#c4c7cc', words: ['silver', 'plata'] }, { key: 'rosegold', label: 'Rose gold & mixed', swatch: '#d8a58f', words: ['rose gold', 'mixed', 'two-tone', 'iridescent', 'metallic'] }]
};
function shadeOf(v, p, fam) {
var list = SHADES[fam];
if (!list || variantFamilies(v, p).indexOf(fam) === -1) return '';
var text = lc(v && v.color) + ' | ' + lc(p && p.title), best = '', bestLen = 0;
list.forEach(function (sh) { sh.words.forEach(function (w) { if (w.length > bestLen && hasWord(text, [w])) { best = sh.key; bestLen = w.length; } }); });
return best || list[1].key;
}
var COLOR_LOOP_ON = true;
var COLOR_AVOID_PENALTY = 40;
var CORE_SLOTS = { dress: ['look', 'shoes', 'bag'], separates: ['top', 'bottom', 'shoes'] };
function colorPrefs(a) {
if (!COLOR_LOOP_ON) return null;
var p = (a && a.colorPrefs) || (global && global.OB_COLOR_PREFS);
if (!p) return null;
var ok = function (k) { return k && familyMeta(k) ? k : ''; };
var cp = { fav: ok(p.fav), tooMuch: ok(p.tooMuch), today: ok(p.today), mode: p.mode === 'match' ? 'match' : p.mode === 'contrast' ? 'contrast' : '' };
if (cp.tooMuch && (cp.tooMuch === cp.fav || cp.tooMuch === cp.today)) cp.tooMuch = '';
cp.shadeFam = ok(p.shadeFam); cp.shades = [];
if (cp.shadeFam && SHADES[cp.shadeFam] && (p.shades || []).length) {
var keys = SHADES[cp.shadeFam].map(function (x) { return x.key; });
cp.shades = p.shades.filter(function (k) { return keys.indexOf(k) !== -1; }).slice(0, 2);
}
return (cp.fav || cp.tooMuch || cp.today || cp.mode) ? cp : null;
}
function famIn(fams, k) { return !!k && fams.indexOf(k) !== -1; }
function uniqList(l) { var o = []; l.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
function colorPlan(a, cp, heroFams) {
var others = CORE_SLOTS[a.style === 'separates' ? 'separates' : 'dress'].slice(1), plan = {}, needs = [];
var heroFav = famIn(heroFams, cp.fav), heroToday = famIn(heroFams, cp.today);
if (cp.fav && cp.fav === cp.today) {
var have = heroFav ? 1 : 0;
for (var n = have; n < 2; n++) needs.push(cp.fav);
} else {
if (cp.today && !heroToday) needs.push(cp.today);
if (cp.fav && !heroFav) needs.push(cp.fav);
}
others.forEach(function (s, i) { if (needs[i]) plan[s] = [needs[i]]; });
return plan;
}
function colorCx(a, cp, plan, heroFams, slot) {
var core = CORE_SLOTS[a.style === 'separates' ? 'separates' : 'dress'];
var clothing = slot === 'top' || slot === 'bottom' || slot === 'look';
var t = plan[slot] || null;
var cx = { list: null, targets: t, avoid: [], shadeFam: cp.shadeFam, shades: cp.shades };
if (cp.tooMuch && !(t && t.indexOf(cp.tooMuch) !== -1)) cx.avoid = [cp.tooMuch];
if (t) cx.list = uniqList(t.concat(contrastList(heroFams, !clothing)));
else if (core.indexOf(slot) !== -1 && cp.mode === 'match') {
cx.list = uniqList(heroFams.filter(function (f) { return f !== 'metallic'; }).concat(['neutral', 'white', 'black', 'gray', 'brown', 'metallic']));
}
return cx;
}
function candHasFam(c, targets) {
return variantFamilies(c.variant, c.product).some(function (f) { return targets.indexOf(f) !== -1; });
}
function promoteColor(cands, targets, cx) {
if (!targets || !cands.length) return cands;
var yes = [], no = [];
cands.forEach(function (c) { (candHasFam(c, targets) ? yes : no).push(c); });
if (cx && cx.shades && cx.shades.length && targets.indexOf(cx.shadeFam) !== -1) {
var pref = [], rest = [];
yes.forEach(function (c) { (cx.shades.indexOf(shadeOf(c.variant, c.product, cx.shadeFam)) !== -1 ? pref : rest).push(c); });
yes = pref.concat(rest);
}
return yes.concat(no);
}
function rescueColor(pre, tiered, targets, cx) {
if (!targets) return tiered;
if (tiered.some(function (c) { return candHasFam(c, targets); })) return promoteColor(tiered, targets, cx);
var hit = pre.filter(function (c) { return candHasFam(c, targets); }).slice(0, 4);
if (!hit.length) return tiered;
var ids = {}; hit.forEach(function (c) { ids[c.product.id] = 1; });
return hit.concat(tiered.filter(function (c) { return !ids[c.product.id]; }));
}
function heroColorScore(v, p, cp) {
var f = variantFamilies(v, p), s = 0;
if (famIn(f, cp.today)) s -= 3;
if (famIn(f, cp.fav)) s -= 2;
if (famIn(f, cp.tooMuch)) s += 3;
if (cp.shades.length && famIn(f, cp.shadeFam)) s += cp.shades.indexOf(shadeOf(v, p, cp.shadeFam)) !== -1 ? -1.5 : 0.5;  // v3.4: her shades
return s;
}
function partnerCandidates(catalog, bucket, a, heroFams, heroIsPrint, extra, cx) {
var clothing = bucket === 'top' || bucket === 'bottom' || bucket === 'look';
var list = (cx && cx.list) || (JEWEL_BUCKETS[bucket] ? jewelList(heroFams) : contrastList(heroFams, !clothing));
var sameFams = (clothing && a.sameShade) ? heroFams.filter(function (f) { return f !== 'metallic'; }) : [];
var sz = sizeFor(a, bucket);
function build(useSize) {
var out = [];
var fits = function (p) {
if (extra && !extra(p)) return false;
return !useSize || p.variants.some(function (v) { return sizeMatches(v, sz); });
};
var ppool = partnerPool(catalog, bucket, a.occasion, fits);
var prank = ppool.rank || {};
ppool.forEach(function (p) {
var best = null;
var bestScore = Infinity;
p.variants.forEach(function (v) {
if (useSize && !sizeMatches(v, sz)) return;
var s = variantScore(v, p, list, heroIsPrint);
if (sameFams.length && variantFamilies(v, p).some(function (f) { return sameFams.indexOf(f) !== -1; })) s -= 100;  // same shade first
if (cx && cx.avoid.length && variantFamilies(v, p).some(function (f) { return cx.avoid.indexOf(f) !== -1; })) s += COLOR_AVOID_PENALTY;  // v3.3: color she has too much of
if (cx && cx.shades && cx.shades.length && variantFamilies(v, p).indexOf(cx.shadeFam) !== -1) s += cx.shades.indexOf(shadeOf(v, p, cx.shadeFam)) !== -1 ? -3 : 1;  // v3.4: her shades
if (s < bestScore) { bestScore = s; best = v; }
});
if (best) out.push({ product: p, variant: best, score: bestScore, rank: prank[p.id] || 0 });
});
out.sort(function (x, y) { return x.score - y.score || (PARTNER_UNION_ON ? x.rank - y.rank : 0) || (x.product.id - y.product.id); });
return out;
}
var useSize = !!sz && (clothing || bucket === 'shoes');
var out = build(useSize);
if (!out.length && useSize && bucket === 'shoes') out = build(false);
return out;
}
var NEAR_SIZE_ON = false;
var NEAR_SIZE_MIN = 6;
function nearSizes(size) {
var t = normalizeSize(size), out = [];
[STANDARD_SIZES, PLUS_SIZES].forEach(function (lad) {
var i = lad.indexOf(t);
if (i === -1) return;
if (i > 0) out.push(lad[i - 1]);
if (i < lad.length - 1) out.push(lad[i + 1]);
});
if (/^\d{1,2}$/.test(t)) { var n = parseInt(t, 10); [n - 2, n - 1, n + 1, n + 2].forEach(function (x) { if (x > 0) out.push(String(x)); }); }
return out;
}
function nearVariant(p, a) {
var ns = nearSizes(a.size);
for (var k = 0; k < ns.length; k++) {
for (var i = 0; i < p.variants.length; i++) {
if (sizeMatches(p.variants[i], ns[k]) && variantPasses(p.variants[i], p, a, { skipSize: true })) return p.variants[i];
}
}
return null;
}
function heroCandidates(catalog, a) {
var pool = heroPool(catalog, a);
if (NEAR_SIZE_ON) catalog.forEach(function (p) { if (p.nearSize) p.nearSize = false; });
var cpH = colorPrefs(a);
var out = pool.map(function (p) {
var v = null, vs = 0;
for (var i = 0; i < p.variants.length; i++) {
if (variantPasses(p.variants[i], p, a, {})) {
if (!cpH) { v = p.variants[i]; break; }
var sc = heroColorScore(p.variants[i], p, cpH);  // v3.3: show the variant in her colors
if (!v || sc < vs) { v = p.variants[i]; vs = sc; }
}
}
return { product: p, variant: v, score: cpH && v ? vs : 0 };
});
if (out.length > 1) {
var off = ((a.occasion || '').length + (a.color || a.pattern || '').length) % out.length;
out = out.slice(off).concat(out.slice(0, off));
}
if (cpH && out.length > 1) {  // v3.3: today's color, then favorite, then neutral; too-much color last (stable)
out = out.map(function (c, i) { return { c: c, i: i }; }).sort(function (x, y) { return x.c.score - y.c.score || x.i - y.i; }).map(function (x) { return x.c; });
}
if (NEAR_SIZE_ON && a.size && out.length < NEAR_SIZE_MIN) {
var haveN = {};
out.forEach(function (c) { haveN[c.product.id] = true; });
heroPool(catalog, assign(a, { size: '' })).forEach(function (p) {
if (haveN[p.id]) return;
var nv = nearVariant(p, a);
if (!nv) return;
p.nearSize = true;
out.push({ product: p, variant: nv, score: 50, nearSize: true });
});
}
if (out.length < MIN_OPTIONS) {
var have = {};
out.forEach(function (c) { have[c.product.id] = true; });
heroPool(catalog, assign(a, { color: '', pattern: '', finish: '' })).forEach(function (p) {
if (have[p.id] || out.length >= MIN_OPTIONS + 2) return;
var v = null;
for (var i = 0; i < p.variants.length; i++) if (sizeMatches(p.variants[i], a.size)) { v = p.variants[i]; break; }
if (!v && a.size) return;
out.push({ product: p, variant: v || p.variants[0], score: 99 });
});
}
return out;
}
function candidatesFor(catalog, bucket, a, heroCtx) {
var slot = bucket;
bucket = slotBucket(bucket);
heroCtx = heroCtx || { fams: ['black'], isPrint: false };
if (heroBuckets(a.style).indexOf(bucket) !== -1) return heroCandidates(catalog, a);
var extra = bucket === 'waist' ? function (p) { return waistAllowed(p, !!heroCtx.loops); } : null;
var cpC = colorPrefs(a), cxC = cpC ? colorCx(a, cpC, colorPlan(a, cpC, heroCtx.realFams || heroCtx.fams), heroCtx.fams, slot) : null;
var preC = partnerCandidates(catalog, bucket, a, heroCtx.fams, heroCtx.isPrint, extra, cxC);
var outC = applyTiers(preC, slot, heroCtx.baseTier);
return cxC && cxC.targets ? rescueColor(preC, outC, cxC.targets, cxC) : outC;
}
var PRICE_TIER_MAX = [2300, 5200, 9300];          // cents, upper bounds of T1-T3
function priceTier(cents) {
for (var i = 0; i < PRICE_TIER_MAX.length; i++) if (cents <= PRICE_TIER_MAX[i]) return i + 1;
return 4;
}
function pieceCents(p, v) {
v = v || (p && p.variants && p.variants[0]);
if (v && typeof v.price === 'number') return v.price;
var n = parseFloat(String((v && v.price) || (p && p.price) || '0').replace(/[^0-9.]/g, ''));
return isNaN(n) ? 0 : Math.round(n * 100);
}
var SLOT_TIER_ROLE = { bag: 'top', neck: 'top', shoes: 'up', wrist: 'up', wrist2: 'base', ring: 'base', ring2: 'base', waist: 'base', extra: 'base' };
function slotTargetTier(slot, base) {
var r = SLOT_TIER_ROLE[slot];
if (!r || !base) return 0;
return r === 'top' ? 4 : r === 'up' ? Math.min(4, base + 1) : base;
}
var TIER_FLOOR_DROP = 1;
function tierRank(slot, p, v, base) {
var target = slotTargetTier(slot, base);
if (!target) return 0;
var t = priceTier(pieceCents(p, v));
if (t === target) return 100;
if (t >= base) return 50 - 10 * Math.abs(t - target);
if (t >= base - TIER_FLOOR_DROP) return 25;  // within the relaxed floor: ranks after every at-or-above-base piece (>= 25 survives applyTiers)
return t;
}
function baseTierOf(garments) {
var cents = garments.filter(function (g) { return g && g.product; }).map(function (g) { return pieceCents(g.product, g.variant); });
if (!cents.length) return 0;
return priceTier(cents.reduce(function (s, c) { return s + c; }, 0) / cents.length);
}
function applyTiers(cands, slot, base) {
if (!base || !SLOT_TIER_ROLE[slot] || cands.length < 2) return cands;
var ranked = cands.map(function (c, i) { return { c: c, k: tierRank(slot, c.product, c.variant, base), i: i }; });
var ok = ranked.filter(function (x) { return x.k >= (TIER_FLOOR_DROP > 0 ? 25 : 30); });
if (ok.length) ranked = ok;
return ranked.sort(function (x, y) { return y.k - x.k || x.i - y.i; }).map(function (x) { return x.c; });
}
var MIN_OPTIONS = 6;  // a piece plus at least 5 others to choose from
var MAX_ALTS = 19;  // v3.2 TUNING 5 (was 9)
function slotFrom(cands) {
return {
primary: cands[0] ? cands[0].product : null,
variant: cands[0] ? cands[0].variant : null,
alternates: cands.slice(1, MAX_ALTS + 1).map(function (c) { return c.product; }),
note: cands.length ? null : 'Nothing in stock for this yet.'
};
}
function slotOrder(style) {
var rest = ['shoes', 'bag', 'neck', 'wrist', 'wrist2', 'ring', 'ring2', 'waist', 'extra'];
return (style === 'separates' ? ['top', 'bottom'] : ['look']).concat(rest);
}
function match(catalog, a, heroOverride, partnerOverrides) {
catalog.forEach(fixBucket);
partnerOverrides = partnerOverrides || {};
var slots = {};
var heroBucket = heroBuckets(a.style)[0];
var heroCands = heroCandidates(catalog, a);
var hero = heroOverride || (heroCands[0] && { product: heroCands[0].product, variant: heroCands[0].variant });
slots[heroBucket] = slotFrom(heroCands);
if (heroOverride) { slots[heroBucket].primary = heroOverride.product; slots[heroBucket].variant = heroOverride.variant; }
var ctx = { fams: ['black'], isPrint: false };
if (hero && hero.product) {
var hv = hero.variant || hero.product.variants[0];
ctx = { fams: heroFamilies(hero.product, hv, a), isPrint: !!variantPattern(hv, hero.product), realFams: a.finish === 'solid' && a.color ? [a.color] : variantFamilies(hv, hero.product) };
}
function setBase() {
if (ctx.baseTier !== undefined) return;
var g = [hero];
if (a.style === 'separates') {
var bo = partnerOverrides.bottom || (slots.bottom && slots.bottom.primary && { product: slots.bottom.primary, variant: slots.bottom.variant });
g.push(bo);
}
ctx.baseTier = baseTierOf(g);
}
var cpM = colorPrefs(a), planM = cpM ? colorPlan(a, cpM, ctx.realFams || ctx.fams) : null;
ctx.colorPlan = planM;
slotOrder(a.style).forEach(function (b) {
if (b === heroBucket || b === 'waist' || b === 'extra') return;
var bk = slotBucket(b);
var cxM = cpM ? colorCx(a, cpM, planM, ctx.fams, b) : null;
var cands = partnerCandidates(catalog, bk, a, ctx.fams, ctx.isPrint, null, cxM);
var preM = cands;
if (b !== 'bottom') { setBase(); cands = applyTiers(cands, b, ctx.baseTier); }
if (cxM && cxM.targets) cands = rescueColor(preM, cands, cxM.targets, cxM);
if (bk !== b) {
var first = slots[bk] && slots[bk].primary;
if (first) {
cands = cands.filter(function (c) { return c.product.id !== first.id; });
var fv = slots[bk].variant || first.variants[0];
var anchor = [{ p: first, v: fv, jewel: true }], n = cands.length;
cands = cands.map(function (c, i) {
var best = c.variant, bs = -1e9;
c.product.variants.forEach(function (v) {
var s = anchorScore(c.product, v, anchor, true);
if (s > bs) { bs = s; best = v; }
});
return { product: c.product, variant: best, score: bs + (n - i) / n };
}).sort(function (x, y) { return y.score - x.score; });
cands = applyTiers(cands, b, ctx.baseTier);
}
var s2 = slotFrom(cands);
if (!cands.length) {
s2 = { primary: null, variant: null, alternates: cands.slice(0, MAX_ALTS + 1).map(function (c) { return c.product; }), note: null, optIn: true };
}
slots[b] = s2;
return;
}
slots[b] = slotFrom(cands);
});
var base = a.style === 'separates'
? (partnerOverrides.bottom ? partnerOverrides.bottom.product : slots.bottom && slots.bottom.primary)
: slots.look && slots.look.primary;
var loops = loopsOf(base);
var dressLike = !!(base && (base.type === 'Dresses' || base.type === 'Jumpsuits') && base.lp !== 'n' && !/belted|tie[- ]waist|\bsash\b|\bwrap\b|drawstring|elastic/.test(lc(base.title)));
var beltOk = loops || dressLike;
ctx.loops = beltOk;
setBase();
var wc = applyTiers(partnerCandidates(catalog, 'waist', a, ctx.fams, ctx.isPrint, function (p) { return waistAllowed(p, beltOk); }, cpM ? colorCx(a, cpM, planM, ctx.fams, 'waist') : null), 'waist', ctx.baseTier);
wc = wc.filter(function (c) { return waistKind(c.product) !== 'belt'; }).concat(wc.filter(function (c) { return waistKind(c.product) === 'belt'; }));
slots.waist = { primary: null, variant: null, alternates: wc.slice(0, MAX_ALTS + 1).map(function (c) { return c.product; }), note: null, optIn: true };
if (!wc.length) delete slots.waist;
var xc = applyTiers(partnerCandidates(catalog, 'extra', a, ctx.fams, ctx.isPrint, null, cpM ? colorCx(a, cpM, planM, ctx.fams, 'extra') : null), 'extra', ctx.baseTier);
slots.extra = { primary: null, variant: null, alternates: xc.slice(0, MAX_ALTS + 1).map(function (c) { return c.product; }), note: null, optIn: true };
if (!xc.length) delete slots.extra;
if (!a.jewelryOn) {
['neck', 'wrist', 'wrist2', 'ring', 'ring2'].forEach(function (k) {
var sl = slots[k]; if (!sl) return;
slots[k] = { primary: null, variant: null, alternates: (sl.primary ? [sl.primary] : []).concat(sl.alternates), note: null, optIn: true };
});
}
return { slots: slots, hero: ctx, waistLoops: beltOk, order: slotOrder(a.style).filter(function (b) { return slots[b]; }) };
}
var BUNDLE = { minPieces: 3, tiers: [{ min: 3, percent: 10 }, { min: 5, percent: 15 }, { min: 9, percent: 20 }] };
BUNDLE.percent = BUNDLE.tiers[0].percent;
function tierFor(count) {
var t = null;
BUNDLE.tiers.forEach(function (x) { if (count >= x.min) t = x; });
return t;
}
function nextTier(count) {
for (var i = 0; i < BUNDLE.tiers.length; i++) if (count < BUNDLE.tiers[i].min) return BUNDLE.tiers[i];
return null;
}
function lineDiscount(cents, percent) { return Math.floor(Math.round(cents) * percent / 100); }
function bundleMath(pieces) {
var eligible = pieces.filter(function (p) { return p.core || p.addon; });
var tier = tierFor(eligible.length), next = nextTier(eligible.length);
var save = 0, lines = [];
pieces.forEach(function (p) {
var d = (tier && (p.core || p.addon)) ? lineDiscount(p.price, tier.percent) : 0;
lines.push({ bucket: p.bucket, save: d });
save += d;
});
var subtotal = pieces.reduce(function (s, p) { return s + Math.round(p.price); }, 0);
return {
qualifies: !!tier,
percent: tier ? tier.percent : 0,
count: eligible.length,
coreCount: eligible.length,
needed: Math.max(0, BUNDLE.minPieces - eligible.length),
nextPercent: next ? next.percent : 0,
nextNeeded: next ? next.min - eligible.length : 0,
subtotal: subtotal,
save: save,
coreSave: save,
addonSave: 0,
lines: lines,
total: subtotal - save
};
}
global.OutfitBuilder = {
loadCatalog: loadCatalog,
match: match,
options: options,
candidatesFor: candidatesFor,
heroPool: heroPool,
variantPasses: variantPasses,
sizeMatches: sizeMatches,
sizeChoices: sizeChoices,
shoeEU: shoeEU,
shoeUS: shoeUS,
isShoeKey: isShoeKey,
sizeFor: sizeFor,
normalizeSize: normalizeSize,
colorFamilies: colorFamilies,
variantFamilies: variantFamilies,
swatchFor: swatchFor,
colorMatches: colorMatches,
variantPattern: variantPattern,
familyLabel: familyLabel,
familyMeta: familyMeta,
patternLabel: patternLabel,
occasionsOf: occasionsOf,
waistKind: waistKind,
extraKind: extraKind,
SHADES: SHADES,
shadeOf: shadeOf,
waistAllowed: waistAllowed,
loopsOf: loopsOf,
fixBucket: fixBucket,
slotBucket: slotBucket,
jewelKind: jewelKind,
priceTier: priceTier,
pieceCents: pieceCents,
tierRank: tierRank,
slotTargetTier: slotTargetTier,
contrastList: contrastList,
jewelList: jewelList,
anchorScore: anchorScore,
metalOf: metalOf,
motifsOf: motifsOf,
bundleMath: bundleMath,
lineDiscount: lineDiscount,
isStrictOccasion: isStrictOccasion,
STRICT_OCC: STRICT_OCC,
resolveVariantImages: resolveVariantImages,
colorNamed: colorNamed,
BUNDLE: BUNDLE,
COLOR_FAMILIES: COLOR_FAMILIES,
PATTERNS: PATTERNS,
CONTRAST: CONTRAST
};
})(window);

