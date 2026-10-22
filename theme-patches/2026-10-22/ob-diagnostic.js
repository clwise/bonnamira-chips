/* BonnaMira Outfit Builder diagnostic (2026-10-22).
   Open the outfit builder page with ?ob-diag=1 (works in a theme preview too).
   Read-only: it fetches the catalog and product JSON and runs the engine; it never adds to cart or writes anything. */
(function () {
'use strict';
if (!/[?&]ob-diag=1/.test(location.search)) return;

var OCCASIONS = ['casual', 'work', 'brunch', 'dinner', 'clubbing', 'after-hours', 'formal', 'gala', 'gym', 'vacation', 'beach'];
var STYLES = ['dress', 'separates'];
var BUCKETS = ['look', 'top', 'bottom', 'shoes', 'bag', 'waist', 'accessory'];
var results = [];
var errorsSeen = window.__obErr || (window.__obErr = []);
window.addEventListener('error', function (e) { errorsSeen.push((e.message || 'error') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '')); });
window.addEventListener('unhandledrejection', function (e) { errorsSeen.push('Unhandled promise: ' + String(e.reason)); });

function add(group, name, status, detail, items) { results.push({ group: group, name: name, status: status, detail: detail || '', items: items || [] }); }
function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function timeout(p, ms) { return Promise.race([p, sleep(ms).then(function () { throw new Error('timed out after ' + ms + 'ms'); })]); }
function loadImg(u) {
  return new Promise(function (res) {
    var i = new Image(), done = false;
    var t = setTimeout(function () { if (!done) { done = true; res(false); } }, 12000);
    i.onload = function () { if (!done) { done = true; clearTimeout(t); res(i.naturalWidth > 0); } };
    i.onerror = function () { if (!done) { done = true; clearTimeout(t); res(false); } };
    i.src = u;
  });
}
async function pool(list, n, fn) {
  var out = new Array(list.length), idx = 0;
  async function worker() { while (idx < list.length) { var k = idx++; out[k] = await fn(list[k], k); } }
  var ws = []; for (var w = 0; w < n; w++) ws.push(worker());
  await Promise.all(ws); return out;
}
function sample(list, n) { var a = list.slice(), out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; }

/* 1. Page & scripts */
function checkScripts() {
  var bad = [];
  document.querySelectorAll('script:not([src])').forEach(function (s, i) {
    if (/json|ld\+json|template/i.test(s.type || '')) return;
    var c = s.textContent; if (!c.trim()) return;
    try { new Function(c); } catch (e) {
      var m = String(e);
      if (/await is only valid|import declarations|Cannot use import/.test(m)) return; // module-style Shopify loaders
      var host = s.closest('[id^="shopify-section"]');
      bad.push('script #' + i + (host ? ' in ' + host.id.replace('shopify-section-', '') : '') + ': ' + m);
    }
  });
  add('Page', 'Inline scripts parse', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.length + ' script(s) will not run' : 'All inline scripts compile', bad);
  document.querySelectorAll('script[type="application/json"]').forEach(function (s) {
    if (!s.id || s.id === 'outfit-builder-catalog') return;
    try { JSON.parse(s.textContent); } catch (e) { add('Page', 'JSON block #' + s.id, 'FAIL', String(e)); }
  });
  var th = (window.Shopify && Shopify.theme) || {};
  add('Page', 'Theme', 'INFO', (th.name || '?') + ' (id ' + (th.id || '?') + ', ' + (th.role || 'role ?') + ')');
  add('Page', 'Language', 'INFO', ((window.Shopify && Shopify.locale) || document.documentElement.lang || '?'));
  var note = document.querySelector('.ob-ai-note');
  add('Page', 'AI photo note visible', note && note.offsetHeight ? 'PASS' : 'WARN', note ? note.innerText.trim() : 'Note section not on this page');
}

/* 2. Engine */
function checkEngine() {
  var OB = window.OutfitBuilder;
  if (!OB) { add('Engine', 'Engine loaded', 'FAIL', 'window.OutfitBuilder is missing: the builder cannot run (usually a script parse error above)'); return null; }
  var need = ['loadCatalog', 'match', 'options', 'candidatesFor', 'variantFamilies', 'COLOR_FAMILIES'];
  var missing = need.filter(function (k) { return !OB[k]; });
  add('Engine', 'Engine loaded', missing.length ? 'FAIL' : 'PASS', missing.length ? 'Missing: ' + missing.join(', ') : 'All core functions present' + (OB.engineVersion ? ' (v ' + OB.engineVersion + ')' : ''));
  add('Engine', 'Swatch function', OB.swatchFor ? 'PASS' : 'WARN', OB.swatchFor ? 'Swatch dots use the engine colour (swatchFor)' : 'swatchFor missing: dots fall back to photo crops and may not match chips');
  var probes = [['Powder Blue/White', 'blue'], ['Green/Brown', 'green'], ['Black Forest', 'green'], ['Cerise', 'pink'], ['Cream', 'white'], ['Navy', 'blue']];
  var wrong = probes.filter(function (pr) { return (OB.variantFamilies({ color: pr[0] }, { title: '' })[0] || '') !== pr[1]; })
    .map(function (pr) { return pr[0] + ' -> ' + (OB.variantFamilies({ color: pr[0] }, { title: '' })[0] || 'none') + ' (expected ' + pr[1] + ')'; });
  add('Engine', 'Primary colour rules', wrong.length ? 'WARN' : 'PASS', wrong.length ? 'Engine reads some colour names differently from the chip' : 'Two-colour and special names resolve to the colour you see', wrong);
  return OB;
}

/* 3. Catalog export */
async function checkCatalog() {
  var CAT_RE = /<script type="application\/json" id="outfit-builder-catalog"([^>]*)>([\s\S]*?)<\/script>/;
  var base = location.pathname.replace(/^\/(?:es|fr|ar|th)(?=\/|$)/, '');
  async function page(n) {
    var t0 = performance.now();
    var res = await timeout(fetch(base + '?section_id=outfit-builder-data' + (n > 1 ? '&page=' + n : ''), { headers: { 'X-Requested-With': 'XMLHttpRequest' } }), 20000);
    var html = await res.text(), ms = Math.round(performance.now() - t0);
    var m = html.match(CAT_RE);
    if (!m) return { n: n, status: res.status, ms: ms, kb: Math.round(html.length / 1024), err: 'catalog script tag not found' };
    var pages = (m[1].match(/data-pages="(\d+)"/) || [])[1];
    try { return { n: n, status: res.status, ms: ms, kb: Math.round(html.length / 1024), items: JSON.parse(m[2]), pages: +pages || 1 }; }
    catch (e) { return { n: n, status: res.status, ms: ms, kb: Math.round(html.length / 1024), err: 'JSON parse: ' + e.message }; }
  }
  var first;
  try { first = await page(1); } catch (e) { add('Catalog', 'Catalog page 1', 'FAIL', String(e)); return null; }
  var pages = [first];
  for (var n = 2; n <= (first.pages || 1); n++) { try { pages.push(await page(n)); } catch (e) { pages.push({ n: n, err: String(e) }); } }
  var all = [], seen = {}, dups = 0;
  pages.forEach(function (pg) {
    add('Catalog', 'Catalog page ' + pg.n, pg.err ? 'FAIL' : (pg.ms > 6000 ? 'WARN' : 'PASS'),
      pg.err ? pg.err : (pg.items.length + ' products, ' + pg.kb + ' KB, ' + pg.ms + ' ms' + (pg.ms > 6000 ? ' (slow)' : '')));
    (pg.items || []).forEach(function (p) { if (seen[p.id]) dups++; else { seen[p.id] = 1; all.push(p); } });
  });
  add('Catalog', 'Products exported', all.length ? 'PASS' : 'FAIL', all.length + ' unique products across ' + pages.length + ' page(s)' + (dups ? ', ' + dups + ' duplicates dropped' : ''));
  var probs = [];
  all.forEach(function (p) {
    if (!p.variants || !p.variants.length) probs.push(p.title + ': no variants');
    if (BUCKETS.indexOf(p.bucket) === -1) probs.push(p.title + ': unknown slot "' + p.bucket + '"');
    if (p.core && !(p.occasionTags || []).length) probs.push(p.title + ': clothing/shoe with no occasion tag');
    if (!p.image) probs.push(p.title + ': no main image');
    (p.variants || []).forEach(function (v) { if (!(v.price > 0)) probs.push(p.title + ' / ' + (v.color || '') + ' ' + (v.size || '') + ': price ' + v.price); });
  });
  add('Catalog', 'Product data complete', probs.length ? 'WARN' : 'PASS', probs.length ? probs.length + ' issue(s)' : 'Every product has variants, a slot, a price and a photo', probs);
  var byB = {}; all.forEach(function (p) { byB[p.bucket] = (byB[p.bucket] || 0) + 1; });
  add('Catalog', 'Slot counts', BUCKETS.some(function (b) { return !byB[b]; }) ? 'WARN' : 'INFO', BUCKETS.map(function (b) { return b + ' ' + (byB[b] || 0); }).join(' · '));
  return all;
}

/* 4. Occasion coverage + match smoke test */
function checkCoverage(OB, raw) {
  var cat = raw;
  var offered = [];
  try { offered = OB.options(cat, {}, 'occasion'); } catch (e) { add('Coverage', 'Occasion list', 'FAIL', 'options() threw: ' + e.message); }
  var missing = OCCASIONS.filter(function (o) { return offered.indexOf(o) === -1; });
  add('Coverage', 'Occasions offered', missing.length ? 'WARN' : 'PASS', offered.length + ' of ' + OCCASIONS.length + ' occasions have stock' + (missing.length ? '; hidden: ' + missing.join(', ') : ''));
  var rows = [], fails = [], slow = [];
  offered.forEach(function (o) {
    var styles = [];
    try { styles = OB.options(cat, { occasion: o }, 'style'); } catch (e) { fails.push(o + ': style options threw ' + e.message); }
    STYLES.forEach(function (s) {
      if (styles.indexOf(s) === -1) { rows.push(o + ' / ' + s + ': not offered'); return; }
      var a = { occasion: o, style: s, size: '', finish: '', color: '', pattern: '' };
      var t0 = performance.now(), r;
      try { r = OB.match(cat, a); } catch (e) { fails.push(o + ' / ' + s + ': match() threw ' + e.message); return; }
      var ms = Math.round(performance.now() - t0);
      if (ms > 1500) slow.push(o + ' / ' + s + ': ' + ms + ' ms');
      var core = s === 'separates' ? ['top', 'bottom', 'shoes'] : ['look', 'shoes'];
      var empty = core.filter(function (b) { return !(r && r.slots && r.slots[b] && (r.slots[b].primary || (r.slots[b].alternates || []).length)); });
      var hero = r && r.slots && r.slots[s === 'separates' ? 'top' : 'look'];
      var heroAlts = hero ? (hero.alternates || []).length + (hero.primary ? 1 : 0) : 0;
      if (empty.length) fails.push(o + ' / ' + s + ': no ' + empty.join(', '));
      rows.push(o + ' / ' + s + ': ' + heroAlts + ' hero choices, filled ' + (r.order || []).join(', ') + ' (' + ms + ' ms)');
    });
  });
  add('Coverage', 'Outfit built for every occasion', fails.length ? 'FAIL' : 'PASS', fails.length ? fails.length + ' combination(s) come back incomplete' : 'Every offered occasion and style returns a full outfit', fails.concat(rows));
  if (slow.length) add('Coverage', 'Match speed', 'WARN', 'Slow outfit builds', slow);
  var thin = [];
  offered.forEach(function (o) {
    ['look', 'top'].forEach(function (b) {
      var n = cat.filter(function (p) { return p.bucket === b && (p.occasionTags || []).some(function (t) { return t.toLowerCase() === 'occasion:' + o; }); }).length;
      if (n && n < 4) thin.push(o + ': only ' + n + ' ' + (b === 'look' ? 'dresses/sets' : 'tops'));
    });
  });
  add('Coverage', 'Choice depth', thin.length ? 'WARN' : 'PASS', thin.length ? 'Shoppers will see repeats here' : 'At least 4 hero pieces wherever a hero is offered', thin);
}

/* 5. Colour, swatch and chip alignment */
async function checkColour(OB, cat) {
  var unmapped = {}, multi = [], viaTitle = [], noDominant = [];
  cat.forEach(function (p) {
    var seen = {};
    p.variants.forEach(function (v) {
      if (!v.color || seen[v.color]) return; seen[v.color] = 1;
      var fams = OB.variantFamilies(v, p);
      var own = OB.colorFamilies ? OB.colorFamilies(v.color) : fams;
      if (fams[0] === 'multi') noDominant.push(p.title + ' / ' + v.color);
      if (!fams.length) unmapped[v.color] = (unmapped[v.color] || []).concat(p.title);
      else if (!own.length) viaTitle.push('"' + v.color + '" on ' + p.title + ' -> ' + fams[0] + ' (from the title)');
      if (own.length > 1) multi.push(v.color + ' -> ' + own.join(' + ') + ' (dot: ' + own[0] + ')');
    });
  });
  var um = Object.keys(unmapped);
  add('Colour', 'Colour names the engine understands', um.length ? 'WARN' : 'PASS', um.length ? um.length + ' colour name(s) have no colour family: no dot colour, never matched by colour' : 'Every colour maps to a family',
    um.map(function (c) { return '"' + c + '" on ' + unmapped[c].slice(0, 2).join('; ') + (unmapped[c].length > 2 ? ' +' + (unmapped[c].length - 2) : ''); }));
  add('Colour', 'Multicolour pieces have a dominant colour', noDominant.length ? 'WARN' : 'PASS', noDominant.length ? 'Set the product metafield bonnamira.dominant, or name the colour in the title ("... in Black")' : 'Every multicolour piece is filed under its dominant colour, multicolor second', noDominant);
  if (viaTitle.length) add('Colour', 'Colour names read from the title', 'INFO', viaTitle.length + ' colour name(s) carry no colour, so the product title decides', viaTitle);
  var uniqMulti = multi.filter(function (x, i) { return multi.indexOf(x) === i; });
  add('Colour', 'Two-colour names (check the primary)', 'INFO', uniqMulti.length + ' distinct two-colour names; the first colour drives the dot and matching', uniqMulti);

  var chips = [], partial = [];
  cat.forEach(function (p) {
    var byC = {};
    p.variants.forEach(function (v) { if (!v.color) return; (byC[v.color] = byC[v.color] || []).push(v); });
    Object.keys(byC).forEach(function (c) {
      var vs = byC[c], with_ = vs.filter(function (v) { return v.chip; });
      if (with_.length && with_.length < vs.length) partial.push(p.title + ' / ' + c + ': ' + with_.length + ' of ' + vs.length + ' sizes have the chip');
      if (with_.length) chips.push({ p: p, c: c, u: with_[0].chip });
    });
  });
  var withChip = cat.filter(function (p) { return p.variants.some(function (v) { return v.chip; }); }).length;
  add('Chips', 'Chip coverage', 'INFO', withChip + ' of ' + cat.length + ' products (' + pct(withChip, cat.length) + ') use chips; ' + chips.length + ' product-colour chips');
  add('Chips', 'Chip covers every size of its colour', partial.length ? 'WARN' : 'PASS', partial.length ? 'Tile and dot can disagree when a size without the chip is picked' : 'No partial chips', partial);
  var ok = await pool(chips, 6, function (x) { return loadImg(String(x.u).split('?')[0] + '?width=120'); });
  var broken = chips.filter(function (x, i) { return !ok[i]; }).map(function (x) { return x.p.title + ' / ' + x.c + ': ' + x.u; });
  add('Chips', 'Chip images load', broken.length ? 'FAIL' : 'PASS', broken.length ? broken.length + ' chip image(s) fail to load' : 'All ' + chips.length + ' chip images load', broken);
  return chips;
}

/* 6. Product photos */
async function checkPhotos(cat) {
  var urls = [];
  cat.forEach(function (p) {
    if (p.image) urls.push({ t: p.title + ' (main)', u: p.image });
    var seen = {};
    p.variants.forEach(function (v) { if (v.image && !seen[v.image]) { seen[v.image] = 1; urls.push({ t: p.title + ' / ' + (v.color || ''), u: v.image }); } });
  });
  var pick = sample(urls, 120);
  var ok = await pool(pick, 6, function (x) { return loadImg(String(x.u).replace(/^\/\//, 'https://')); });
  var broken = pick.filter(function (x, i) { return !ok[i]; }).map(function (x) { return x.t + ': ' + x.u; });
  add('Photos', 'Product photos load (sample of ' + pick.length + ')', broken.length ? 'FAIL' : 'PASS', broken.length ? broken.length + ' broken' : 'All sampled photos load', broken);
  var noPhoto = [];
  cat.forEach(function (p) { var seen = {}; p.variants.forEach(function (v) { if (v.color && !seen[v.color] && !v.image && !v.chip) { seen[v.color] = 1; noPhoto.push(p.title + ' / ' + v.color); } }); });
  add('Photos', 'Colours with no photo and no chip', noPhoto.length ? 'WARN' : 'PASS', noPhoto.length ? noPhoto.length + ' colour(s) show a flat swatch instead of a photo' : 'Every colour has a photo or chip', noPhoto);
}

/* 7. Store data still matches the export (stock, price, handles) */
async function checkStore(cat) {
  var pick = sample(cat, 25), issues = [];
  await pool(pick, 4, async function (p) {
    try {
      var res = await timeout(fetch(String(p.url).split('?')[0] + '.js'), 15000);
      if (!res.ok) { issues.push(p.title + ': product page returns ' + res.status); return; }
      var live = await res.json(), byId = {};
      live.variants.forEach(function (v) { byId[v.id] = v; });
      p.variants.forEach(function (v) {
        var lv = byId[v.id];
        if (!lv) issues.push(p.title + ' / ' + (v.color || '') + ' ' + (v.size || '') + ': variant no longer exists');
        else if (!lv.available) issues.push(p.title + ' / ' + (v.color || '') + ' ' + (v.size || '') + ': out of stock but still offered');
        else if (lv.price !== v.price) issues.push(p.title + ' / ' + (v.color || '') + ': price ' + v.price + ' in builder vs ' + lv.price + ' live');
      });
    } catch (e) { issues.push(p.title + ': ' + e.message); }
  });
  add('Store', 'Builder matches live stock and prices (sample of ' + pick.length + ')', issues.length ? 'WARN' : 'PASS', issues.length ? issues.length + ' mismatch(es): usually a cached page, re-run in a minute' : 'Variants, stock and prices agree', issues);
  try {
    var cr = await timeout(fetch('/cart.js'), 10000);
    add('Store', 'Cart reachable', cr.ok ? 'PASS' : 'FAIL', '/cart.js returned ' + cr.status);
  } catch (e) { add('Store', 'Cart reachable', 'FAIL', e.message); }
}

/* 8. Layout */
function checkLayout() {
  var w = window.innerWidth, sw = document.documentElement.scrollWidth;
  add('Layout', 'No sideways scroll', sw > w + 2 ? 'FAIL' : 'PASS', 'Viewport ' + w + ' px, page ' + sw + ' px' + (w < 768 ? ' (mobile width)' : ' (desktop width: also run on a phone)'));
  var wide = [];
  if (sw > w + 2) document.querySelectorAll('body *').forEach(function (el) { var r = el.getBoundingClientRect(); if (r.right > w + 2 && r.width > 0 && wide.length < 8) wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]) + ' right edge ' + Math.round(r.right)); });
  if (wide.length) add('Layout', 'Elements past the right edge', 'WARN', '', wide);
}

/* Report UI */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function render(state) {
  var box = document.getElementById('ob-diag') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ob-diag' }));
  var c = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 }; results.forEach(function (r) { c[r.status]++; });
  var col = { PASS: '#1e7a46', WARN: '#a86a00', FAIL: '#b3261e', INFO: '#5b6470' };
  var groups = []; results.forEach(function (r) { if (groups.indexOf(r.group) === -1) groups.push(r.group); });
  box.innerHTML = '<style>#ob-diag{position:fixed;inset:0;z-index:2147483646;background:#faf8f4;color:#1d1b18;overflow:auto;font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:16px}' +
    '#ob-diag h1{font-size:20px;margin:0 0 4px}#ob-diag .sum{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}#ob-diag .pill{padding:4px 10px;border-radius:99px;color:#fff;font-weight:600;font-size:13px}' +
    '#ob-diag h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6258;margin:18px 0 6px}#ob-diag .row{background:#fff;border:1px solid #e6e0d6;border-radius:8px;padding:8px 10px;margin:6px 0}' +
    '#ob-diag .st{display:inline-block;min-width:44px;font-weight:700;font-size:12px}#ob-diag details summary{cursor:pointer;color:#6b6258;font-size:12px;margin-top:4px}#ob-diag ul{margin:4px 0 0 18px;padding:0;font-size:12px;max-height:240px;overflow:auto}' +
    '#ob-diag .bar{display:flex;gap:8px;flex-wrap:wrap}#ob-diag button{font:inherit;padding:8px 12px;border-radius:6px;border:1px solid #1d1b18;background:#1d1b18;color:#fff;cursor:pointer}#ob-diag button.alt{background:#fff;color:#1d1b18}</style>' +
    '<h1>Outfit Builder diagnostic</h1><div style="color:#6b6258">' + esc(state) + '</div>' +
    '<div class="sum">' + ['FAIL', 'WARN', 'PASS', 'INFO'].map(function (k) { return '<span class="pill" style="background:' + col[k] + '">' + c[k] + ' ' + k + '</span>'; }).join('') + '</div>' +
    '<div class="bar"><button id="ob-diag-copy">Copy report</button><button class="alt" id="ob-diag-rerun">Run again</button><button class="alt" id="ob-diag-close">Close</button></div>' +
    groups.map(function (g) {
      return '<h2>' + esc(g) + '</h2>' + results.filter(function (r) { return r.group === g; }).sort(function (a, b) { return ['FAIL', 'WARN', 'PASS', 'INFO'].indexOf(a.status) - ['FAIL', 'WARN', 'PASS', 'INFO'].indexOf(b.status); }).map(function (r) {
        return '<div class="row"><span class="st" style="color:' + col[r.status] + '">' + r.status + '</span> <b>' + esc(r.name) + '</b>' + (r.detail ? ' — ' + esc(r.detail) : '') +
          (r.items.length ? '<details' + (r.status === 'FAIL' ? ' open' : '') + '><summary>' + r.items.length + ' detail line(s)</summary><ul>' + r.items.slice(0, 300).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></details>' : '') + '</div>';
      }).join('');
    }).join('');
  document.getElementById('ob-diag-close').onclick = function () { box.remove(); };
  document.getElementById('ob-diag-rerun').onclick = function () { run(); };
  document.getElementById('ob-diag-copy').onclick = function () {
    var txt = 'BonnaMira Outfit Builder diagnostic — ' + new Date().toISOString() + '\n' + location.href + '\n' + state + '\n\n' +
      results.map(function (r) { return '[' + r.status + '] ' + r.group + ' · ' + r.name + (r.detail ? ' — ' + r.detail : '') + (r.items.length ? '\n    - ' + r.items.slice(0, 60).join('\n    - ') : ''); }).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { this_ok(); }, function () { window.prompt('Copy the report:', txt); });
    function this_ok() { var b = document.getElementById('ob-diag-copy'); b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy report'; }, 1500); }
  };
}

async function run() {
  results = [];
  var t0 = performance.now();
  render('Running…');
  try {
    checkScripts();
    var OB = checkEngine();
    if (errorsSeen.length) add('Page', 'Errors since page load', 'FAIL', errorsSeen.length + ' error(s)', errorsSeen.slice());
    else add('Page', 'Errors since page load', 'PASS', 'None recorded');
    render('Fetching the catalog…');
    var cat = await checkCatalog();
    if (OB && cat && cat.length) {
      var engCat = await OB.loadCatalog();
      add('Engine', 'Engine catalog = export', engCat.length === cat.length ? 'PASS' : 'WARN', 'Engine sees ' + engCat.length + ', export has ' + cat.length);
      render('Building test outfits…'); await sleep(30);
      checkCoverage(OB, engCat);
      render('Checking colours and chips…');
      await checkColour(OB, engCat);
      render('Checking photos…');
      await checkPhotos(engCat);
      render('Checking live stock and prices…');
      await checkStore(cat);
    }
    checkLayout();
  } catch (e) { add('Diagnostic', 'Diagnostic crashed', 'FAIL', String(e && e.stack || e)); }
  render('Finished in ' + Math.round((performance.now() - t0) / 1000) + ' s · ' + new Date().toLocaleString());
  window.OB_DIAG = results;
}
function start() { setTimeout(run, 1500); }
if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
