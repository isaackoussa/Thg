// Tests de robustesse de l'app : à lancer avec `npm test` (construit dist/ puis le teste dans Chromium).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const NM = new URL('../node_modules/', import.meta.url).pathname;
// Les bibliothèques chargées depuis les CDN sont servies depuis node_modules (mêmes versions)
const CDN_MAP = [
  [/xlsx\/0\.18\.5\/xlsx\.full\.min\.js$/, 'xlsx/dist/xlsx.full.min.js'],
  [/mammoth@1\.8\.0\/mammoth\.browser\.min\.js$/, 'mammoth/mammoth.browser.min.js'],
  [/pdf\.js\/3\.11\.174\/pdf\.min\.js$/, 'pdfjs-dist/build/pdf.min.js'],
  [/pdf\.js\/3\.11\.174\/pdf\.worker\.min\.js$/, 'pdfjs-dist/build/pdf.worker.min.js'],
  [/tesseract\.js@5\.1\.1\/dist\/(.+)$/, 'tesseract.js/dist/$1'],
  [/tesseract\.js-core@5\.1\.1\/(.+)$/, 'tesseract.js-core/$1'],
  [/@tesseract\.js-data\/fra@1\.0\.0\/4\.0\.0_best_int\/(.+)$/, '@tesseract.js-data/fra/4.0.0_best_int/$1'],
  [/jszip@3\.10\.1\/dist\/jszip\.min\.js$/, 'jszip/dist/jszip.min.js']
];
async function routeCdn(ctx) {
  await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, route => {
    const url = route.request().url();
    for (const [re, rel] of CDN_MAP) {
      const m = url.match(re);
      if (m) {
        const f = NM + rel.replace('$1', m[1] || '');
        if (existsSync(f)) return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'Content-Type': f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.gz') ? 'application/gzip' : 'text/javascript', 'Access-Control-Allow-Origin': '*' } });
      }
    }
    return route.fulfill({ status: 404, body: 'absent' });
  });
}

const DIST = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = DIST + (p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://localhost:' + server.address().port + '/';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' → ' + JSON.stringify(detail) : '')); }
}
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const TABS = ['synthese', 'saisie', 'dynamique', 'structure', 'renta', 'faillite', 'bale', 'import', 'params', 'rapport', 'historique', 'methode', 'r'];

const FAKE_CR = { R1:[20000,21000,23000], R2:[8000,8200,9000], R3:[100,120,90], R4:[4822,4889,5570], R5:[500,520,600], R6:[200,-50,300], R7:[100,100,100], R8:[300,350,400], R9:[200,220,240], R10:[0,0,0], R11:[9000,9300,9800], R12:[1500,1600,1700], R13:[1200,900,2100], R14:[10,0,-20], R15:[400,500,600] };

const browser = await chromium.launch();

async function openApp({ storage, width = 400, dark = false, breakStorage = false, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  await routeCdn(ctx);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  if (storage !== undefined) await page.addInitScript(s => { try { localStorage.setItem('umoa-analyste-v1', s); } catch (e) {} }, typeof storage === 'string' ? storage : JSON.stringify(storage));
  if (breakStorage) await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('bloqué'); }; Storage.prototype.setItem = () => { throw new Error('bloqué'); }; });
  await page.goto(BASE);
  await page.waitForSelector('#view .section-head');
  return { page, ctx, errors };
}
async function visitAllTabs(page, label, errors) {
  for (const t of TABS) {
    await page.click('[data-tab="' + t + '"]');
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(w[0] <= w[1], label + ' · ' + t + ' : pas de défilement horizontal', w);
    const txt = await page.evaluate(() => document.querySelector('#view').innerText);
    ok(!/undefined|NaN|\[object Object\]/.test(txt), label + ' · ' + t + ' : aucun « undefined » ou « NaN » affiché', (txt.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]);
  }
  ok(errors.length === 0, label + ' : aucune erreur JavaScript', errors.slice(0, 3));
}

/* ---------- 1. Build ---------- */
{
  const html = readFileSync(DIST + 'index.html', 'utf8');
  ok(html.startsWith('<!doctype html>'), 'build : doctype présent');
  ok(/<html lang="fr">/.test(html), 'build : langue française');
  ok(html.indexOf('<title>') < html.indexOf('</head>'), 'build : titre dans <head>');
  ok(/rel="manifest"/.test(html) && /apple-touch-icon/.test(html), 'build : manifeste et icône iPhone référencés');
  const m = JSON.parse(readFileSync(DIST + 'manifest.webmanifest', 'utf8'));
  ok(m.icons.every(i => existsSync(DIST + i.src.slice(1))), 'build : toutes les icônes du manifeste existent');
  ok(m.display === 'standalone' && m.start_url === '/', 'build : manifeste installable');
  ok(existsSync(DIST + 'sw.js'), 'build : service worker présent');
}

/* ---------- 2. Calculs sur l'exemple BAB ---------- */
{
  const { page, ctx, errors } = await openApp();
  const r = await page.evaluate(() => ({
    years: Y(), ta: Y().map((_, y) => qv('TA', y)), tp: Y().map((_, y) => qv('TP', y)), cp: Y().map((_, y) => qv('CP', y)),
    transfo: series(I.transfo), roe: series(I.roe), roa: series(I.roa), levier: series(I.levier), liq: series(I.liq), pnb: qv('PNB', 2)
  }));
  ok(JSON.stringify(r.years) === '[2021,2022,2023]', 'BAB : exercices 2021-2023', r.years);
  ok(JSON.stringify(r.ta) === '[301931,269088,295660]', 'BAB : total actif = fascicule', r.ta);
  ok(JSON.stringify(r.tp) === JSON.stringify(r.ta), 'BAB : actif = passif', r.tp);
  ok(JSON.stringify(r.cp) === '[20787,24381,27289]', 'BAB : capitaux propres = fascicule', r.cp);
  ok(near(r.transfo[2], 150766 / 196626), 'BAB : transformation 2023');
  ok(near(r.roe[2], 2908 / 27289) && near(r.roe[0], 3112 / 20787), 'BAB : ROE');
  ok(near(r.roa[1], 3595 / 269088), 'BAB : ROA 2022');
  ok(near(r.levier[2], 27289 / 295660), 'BAB : levier 2023');
  ok(near(r.liq[0], (11953 + 105891 + 16570) / (0 + 55259 + 218985)), 'BAB : liquidité 2021');
  ok(Number.isNaN(r.pnb), 'BAB : PNB non calculé sans compte de résultat (pas de zéro inventé)');

  /* parseNum */
  const pn = await page.evaluate(() => [['131 072', 131072], ['−10 548', -10548], ['(1 234)', -1234], ['1,5', 1.5], ['1.234.567', 1234567], ['1 234,56', 1234.56], ['12,5 %', 12.5], ['abc', null], ['', null], ['1-2', null], ['1e3', 1000], ['3\u202f056', 3056]].map(([s, e]) => [s, parseNum(s), e]));
  pn.forEach(([s, got, exp]) => ok(got === exp, 'parseNum(' + JSON.stringify(s) + ')', got));

  /* splitNumbers */
  const sp = await page.evaluate(() => [
    [['131', '072', '130', '602', '150', '766'], 3, [131072, 130602, 150766]],
    [['1', '812', '1', '510', '1', '073'], 3, [1812, 1510, 1073]],
    [['0', '0', '0'], 3, [0, 0, 0]],
    [['-10', '548', '-7', '437', '3', '056'], 3, [-10548, -7437, 3056]],
    [['2', '59', '61'], 3, [2, 59, 61]],
    [['11', '953', '14', '456', '21', '982'], 3, [11953, 14456, 21982]]
  ].map(([t, w, e]) => [t.join(' '), splitNumbers(t, w), e]));
  sp.forEach(([t, got, exp]) => ok(JSON.stringify(got) === JSON.stringify(exp), 'découpage des montants « ' + t + ' »', got));
  ok(await page.evaluate(() => splitNumbers(Array(80).fill('1'), 3)) === null, 'découpage : ligne trop longue ignorée sans blocage');

  /* Statuts aux bornes */
  const st = await page.evaluate(() => { state.params.marge = 10; return [status(I.solva, 0.115), status(I.solva, 0.1149), status(I.solva, 0.13), status(I.coef, 0.61), status(I.coef, 0.57), status(I.coef, 0.5), status(I.roe, NaN), status(I.mi_pnb, 0.7)]; });
  ok(JSON.stringify(st) === '["warn","bad","ok","bad","warn","ok","na","info"]', 'statuts : seuils et zones de vigilance', st);

  /* Identités comptables avec un compte de résultat complet */
  const id = await page.evaluate(cr => {
    Object.assign(bank().v, cr);
    return Y().map((_, y) => ({
      roe: val(nodeOf(I.roe), y), roa: val(nodeOf(I.roa), y), mult: val(nodeOf(I.mult), y),
      pnb: qv('PNB', y), pnbc: qv('PNBC', y), rai: qv('RAI', y), cp: qv('CP', y), rn: qv('RNCR', y), is: raw('R15', y),
      fpt: qv('FPT', y), rwa: qv('RWA', y), lmax: qv('LMAX', y), s: state.params.seuil_solva / 100,
      cdrc: qv('CDRC', y), r13: raw('R13', y), rbe: qv('RBE', y), r14: raw('R14', y), rwao: qv('RWAO', y)
    }));
  }, FAKE_CR);
  id.forEach((x, y) => {
    ok(near(x.roe, x.roa * x.mult), 'Du Pont : ROE = ROA × multiplicateur (' + y + ')');
    ok(near(x.pnb - x.pnbc, x.rai + x.cp), 'faillite : PNB − PNB* = RAI + CP (' + y + ')');
    ok(near(x.rn, x.rai - x.is), 'cascade : RN = RAI − impôt (' + y + ')');
    ok(near((x.fpt - x.lmax) / (x.rwa - x.lmax), x.s), 'perte avant seuil : (FP − L)/(RWA − L) = seuil (' + y + ')');
    ok(near(x.rbe - x.cdrc + x.r14, -x.cp), 'coût du risque critique : il mène exactement à RAI = −CP (' + y + ')');
    ok(x.rwao > 0, 'risque opérationnel inclus quand le PNB existe (' + y + ')');
  });
  ok(near(id[1].rwao, 12.5 * 0.15 * ((id[0].pnb + id[1].pnb) / 2)), 'risque opérationnel : moyenne des PNB disponibles');
  ok(near(id[2].rwao, 12.5 * 0.15 * ((id[0].pnb + id[1].pnb + id[2].pnb) / 3)), 'risque opérationnel : moyenne sur 3 ans');

  /* Base moyenne : premier exercice indisponible, suivants corrects */
  const moy = await page.evaluate(() => { state.base = 'moy'; const r = series(I.roe); state.base = 'fin'; return r; });
  ok(Number.isNaN(moy[0]) && near(moy[2], 2908 / ((24381 + 27289) / 2)), 'ROE sur capitaux propres moyens', moy);

  /* Valeur déclarée prioritaire sur l'estimation */
  const decl = await page.evaluate(() => { bank().v.RWA = [null, null, 200000]; const r = [qv('RWA', 2), qv('RWA', 1)]; delete bank().v.RWA; return r; });
  ok(decl[0] === 200000 && decl[1] !== 200000, 'RWA déclarés remplacent l’estimation pour l’année saisie seulement', decl);

  /* Import du texte du fascicule */
  const imp = await page.evaluate(() => parseImport(`BENIN
BANQUE ATLANTIQUE BENIN
2021 2022 2023
ACTIF
CAISSE, BANQUE CENTRALE, CCP 11 953 14 456 21 982
COMPTES DE REGULARISATION 1 186 898 626
IMMOBILISATIONS INCORPORELLES 2 59 61
TOTAL DE L'ACTIF 301 931 269 088 295 660
PASSIF
BANQUE CENTRALE, CCP 0 0 0
COMPTES DE REGULARISATION 2 403 1 702 2 167
PROVISIONS 1 549 842 965
PROVISIONS REGLEMENTEES 0 0 0
REPORT A NOUVEAU (+/-) -10 548 -7 437 3 056
HORS - BILAN
ENGAGEMENTS DONNES 32 875 43 799 29 590
ENGAGEMENTS DE FINANCEMENT 15 104 22 671 23 533
ENGAGEMENTS RECUS 332 663 360 755 401 445
ENGAGEMENTS DE GARANTIE 332 663 360 755 401 445
COMMISSIONS (PRODUITS) 4 822 4 889 5 570
RESULTAT BRUT D'EXPLOITATION 6 000 6 500 6 800
COUT DU RISQUE -1 200 -900 -2 100
RESULTAT D'EXPLOITATION 4 800 5 600 4 700
RESULTAT AVANT IMPOT 4 810 5 600 4 680
IMPOTS SUR LES BENEFICES 400 500 600
RESULTAT NET 4 410 5 100 4 080`));
  const v = imp.vals;
  ok(JSON.stringify(imp.years) === '[2021,2022,2023]', 'import : ligne d’années détectée', imp.years);
  ok(imp.bankName === 'BANQUE ATLANTIQUE BENIN', 'import : nom de la banque détecté', imp.bankName);
  ok(JSON.stringify(v.A1) === '[11953,14456,21982]', 'import : caisse', v.A1);
  ok(JSON.stringify(v.A9) === '[1186,898,626]' && JSON.stringify(v.P6) === '[2403,1702,2167]', 'import : comptes de régularisation actif / passif distingués', [v.A9, v.P6]);
  ok(JSON.stringify(v.A13) === '[2,59,61]', 'import : petits montants', v.A13);
  ok(JSON.stringify(v.P1) === '[0,0,0]' && !v.A1x, 'import : banque centrale au passif', v.P1);
  ok(JSON.stringify(v.P7) === '[1549,842,965]' && JSON.stringify(v.P9e) === '[0,0,0]', 'import : provisions / provisions réglementées', [v.P7, v.P9e]);
  ok(JSON.stringify(v.P9f) === '[-10548,-7437,3056]', 'import : montants négatifs', v.P9f);
  ok(JSON.stringify(v.HB1) === '[15104,22671,23533]' && JSON.stringify(v.HB5) === '[332663,360755,401445]', 'import : hors bilan donné / reçu', [v.HB1, v.HB5]);
  ok(JSON.stringify(v.R4) === '[4822,4889,5570]', 'import : commissions', v.R4);
  ok(JSON.stringify(v.R13) === '[1200,900,2100]', 'import : coût du risque déduit des soldes (signe sûr)', v.R13);
  ok(JSON.stringify(v.R14) === '[10,0,-20]', 'import : gains sur immobilisations déduits', v.R14);
  ok(JSON.stringify(v.R15) === '[400,500,600]', 'import : impôt', v.R15);
  ok(imp.unknown.length === 0, 'import : aucune ligne chiffrée ignorée', imp.unknown);

  /* Aller-retour CSV et JSON */
  const rt = await page.evaluate(() => { const before = JSON.stringify(bank().v); const csv = toCsv(false); const p = parseImport(csv); const back = {}; Object.keys(p.vals).forEach(k => back[k] = p.vals[k]); const ok1 = Object.keys(bank().v).every(k => JSON.stringify(bank().v[k]) === JSON.stringify(back[k] ?? bank().years.map(() => null)) || bank().v[k].every(x => x === null)); const j = parseImport(JSON.stringify({ banks: state.banks, cur: state.cur, params: state.params })); return [ok1, !!j.json, JSON.stringify(j.json.banks[state.cur].v) === before, p.years]; });
  ok(rt[0], 'export CSV puis import : mêmes valeurs');
  ok(rt[1] && rt[2], 'sauvegarde JSON : relue à l’identique');
  ok(JSON.stringify(rt[3]) === '[2021,2022,2023]', 'export CSV : années relues depuis l’en-tête', rt[3]);
  const badJson = await page.evaluate(() => [parseImport('{"banks": 3}').unknown.length, parseImport('{ pas du json').unknown.length, parseImport('{"banks":{"x":{"years":["abc"],"v":{}}}}').unknown.length]);
  ok(badJson.every(n => n === 1), 'import : JSON invalide refusé proprement', badJson);
  await visitAllTabs(page, 'BAB + compte de résultat', errors);
  await ctx.close();
}

/* ---------- 3. Données abîmées ou extrêmes ---------- */
const yrsN = n => Array.from({ length: n }, (_, i) => 2010 + i);
const rnd = (n, a, b) => Array.from({ length: n }, () => Math.round(a + Math.random() * (b - a)));
const fullBank = (n, f) => { const v = {}; ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13','A14','P1','P2','P3','P4','P5','P6','P7','P8','P9a','P9b','P9c','P9d','P9e','P9f','P9g','HB1','HB2','HB3','HB4','HB5','HB6','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','R13','R14','R15'].forEach(k => v[k] = f(k, n)); return v; };
const cases = [
  ['stockage illisible', 'ceci n’est pas du JSON'],
  ['structure inattendue', { banks: { x: { years: 'abc', v: 5 } }, params: { seuil_solva: 'abc' }, tab: 'inexistant' }],
  ['un seul exercice', { banks: { a: { id: 'a', name: 'Une année', years: [2023], v: fullBank(1, () => [1000]) } }, cur: 'a' }],
  ['12 exercices', { banks: { a: { id: 'a', name: 'Longue série', years: yrsN(12), v: fullBank(12, (k, n) => rnd(n, -500, 90000)) } }, cur: 'a' }],
  ['tout à zéro', { banks: { a: { id: 'a', name: 'Zéros', years: [2021, 2022, 2023], v: fullBank(3, () => [0, 0, 0]) } }, cur: 'a' }],
  ['fonds propres négatifs', { banks: { a: { id: 'a', name: 'En faillite', years: [2021, 2022], v: Object.assign(fullBank(2, () => [100, 120]), { P9f: [-5000, -9000], P9g: [-3000, -4000] }) } }, cur: 'a' }],
  ['banque vide', { banks: { a: { id: 'a', name: 'Vide', years: [2022, 2023], v: {} } }, cur: 'a' }],
  ['années désordonnées et doublons', { banks: { a: { id: 'a', name: 'Désordre', years: [2023, 2021, 2023, 2022], v: { A4: [3, 1, 99, 2], P3: [6, 2, 99, 4] } } }, cur: 'a' }],
  ['nom piégé', { banks: { a: { id: 'a', name: '<img src=x onerror="window.__xss=1">', country: '"><script>window.__xss=2</script>', years: [2023], v: { A4: [1] } } }, cur: 'a' }],
  ['période enregistrée hors limites', { banks: { a: { id: 'a', name: 'Période', years: [2021, 2022, 2023], range: [1990, 2050], v: { A4: [1, 2, 3] } } }, cur: 'a', tab: 'renta' }]
];
for (const [label, storage] of cases) {
  const { page, ctx, errors } = await openApp({ storage });
  await visitAllTabs(page, label, errors);
  ok(!(await page.evaluate(() => window.__xss)), label + ' : aucun code injecté exécuté');
  if (label === 'années désordonnées et doublons') {
    const r = await page.evaluate(() => [bank().years, bank().v.A4]);
    ok(JSON.stringify(r) === '[[2021,2022,2023],[1,2,3]]', 'années triées, doublon retiré, données suivent', r);
  }
  if (label === 'structure inattendue') ok(await page.evaluate(() => bank().name.startsWith('Banque Atlantique') && state.params.seuil_solva === 11.5), 'données invalides : retour à l’exemple et aux seuils par défaut');
  await ctx.close();
}

/* ---------- 4. Stockage bloqué (navigation privée) ---------- */
{
  const { page, ctx, errors } = await openApp({ breakStorage: true });
  await page.click('[data-tab="saisie"]');
  await page.fill('#i-A4-2', '160 000'); await page.press('#i-A4-2', 'Tab');
  ok(await page.evaluate(() => raw('A4', 2)) === 160000, 'stockage bloqué : la saisie fonctionne quand même');
  await visitAllTabs(page, 'stockage bloqué', errors);
  await ctx.close();
}

/* ---------- 5. Parcours utilisateur ---------- */
{
  const { page, ctx, errors } = await openApp();
  await page.click('[data-tab="saisie"]');
  await page.fill('#i-A4-2', 'abc'); await page.press('#i-A4-2', 'Tab');
  ok(await page.evaluate(() => document.querySelector('#i-A4-2').classList.contains('bad') && raw('A4', 2) === 150766), 'saisie invalide signalée et non enregistrée');
  await page.fill('#i-A4-2', '160 000'); await page.press('#i-A4-2', 'Tab');
  ok(await page.evaluate(() => document.querySelector('td.calc[data-q="TA"][data-y="2"]').textContent.replace(/\s/g, '')) === '304894', 'saisie : total actif recalculé immédiatement');
  ok(await page.evaluate(() => /Écart/.test(document.querySelector('#checks').innerText)), 'saisie : déséquilibre actif / passif signalé');
  await page.fill('#i-A4-2', '150766'); await page.press('#i-A4-2', 'Tab');
  await page.click('#yPrev');
  ok(JSON.stringify(await page.evaluate(() => bank().years)) === '[2020,2021,2022,2023]', 'ajout d’un exercice antérieur');
  await page.fill('#yAny', '2018'); await page.click('#yAnyBtn');
  ok(JSON.stringify(await page.evaluate(() => bank().years)) === '[2018,2020,2021,2022,2023]', 'ajout d’une année non consécutive');
  await page.fill('#m-y0', '2021'); await page.press('#m-y0', 'Tab');
  ok(JSON.stringify(await page.evaluate(() => bank().years)) === '[2018,2020,2021,2022,2023]', 'renommage vers une année existante refusé');
  await page.fill('#m-y0', '2019'); await page.press('#m-y0', 'Tab');
  ok(JSON.stringify(await page.evaluate(() => bank().years)) === '[2019,2020,2021,2022,2023]', 'renommage d’une année');
  await page.click('[data-rmy="0"]'); await page.click('#yRmYes');
  await page.click('[data-rmy="0"]'); await page.click('#yRmYes');
  ok(JSON.stringify(await page.evaluate(() => [bank().years, bank().v.A4])) === '[[2021,2022,2023],[131072,130602,150766]]', 'retrait d’exercices sans décaler les données');
  await page.click('[data-tab="renta"]');
  await page.selectOption('#fromSel', '2022');
  ok(JSON.stringify(await page.evaluate(() => [Y(), series(I.roe).length])) === '[[2022,2023],2]', 'choix de la période');
  ok(await page.evaluate(() => document.querySelectorAll('#c-roe .res').length) === 2, 'les fiches suivent la période');
  await page.click('#baseMoy');
  ok(near(await page.evaluate(() => series(I.roe)[0]), 3595 / ((20787 + 24381) / 2)), 'moyenne utilise l’exercice précédent hors période');
  await page.click('#baseFin');
  await page.selectOption('#fromSel', '2021');
  await page.click('[data-tab="params"]');
  await page.fill('#p-seuil_solva', '-5'); await page.press('#p-seuil_solva', 'Tab');
  ok(await page.evaluate(() => state.params.seuil_solva) === 11.5, 'paramètre négatif refusé');
  await page.fill('#p-seuil_solva', '12'); await page.press('#p-seuil_solva', 'Tab');
  ok(await page.evaluate(() => state.params.seuil_solva) === 12, 'paramètre modifié');
  await page.click('#pReset');
  await page.click('[data-tab="import"]');
  await page.fill('#impText', 'ENGAGEMENTS DONNES 1 2 3\nENGAGEMENTS DE FINANCEMENT 15 104 22 671 23 533\nINTERETS ET PRODUITS ASSIMILES 20 100 21 300 23 900\nINTERETS ET CHARGES ASSIMILEES 8 000 8 200 9 000');
  await page.click('#impParse'); await page.click('#impApply');
  ok(await page.evaluate(() => raw('R1', 2) === 23900 && raw('HB1', 0) === 15104 && raw('A4', 2) === 150766), 'import appliqué sans écraser les autres postes');
  await page.click('[data-tab="import"]');
  await page.fill('#impText', '2019 2020 2021\nCREANCES SUR LA CLIENTELE 90 000 100 000 131 072');
  await page.click('#impParse'); await page.click('#impApply');
  ok(JSON.stringify(await page.evaluate(() => [bank().years, bank().v.A4])) === '[[2019,2020,2021,2022,2023],[90000,100000,131072,130602,150766]]', 'import avec d’autres années : colonnes ajoutées au bon endroit');
  await page.evaluate(() => Object.assign(bank().v, { R1:[null,null,20000,21000,23000], R2:[null,null,8000,8200,9000], R3:[null,null,0,0,0], R4:[null,null,4822,4889,5570], R5:[null,null,500,520,600], R6:[null,null,0,0,0], R7:[null,null,0,0,0], R8:[null,null,0,0,0], R9:[null,null,0,0,0], R10:[null,null,0,0,0], R11:[null,null,9000,9300,9800], R12:[null,null,1500,1600,1700], R13:[null,null,1200,900,2100], R14:[null,null,0,0,0], R15:[null,null,400,500,600] }));
  await page.click('[data-tab="faillite"]');
  await page.fill('#sPnb', '100'); await page.dispatchEvent('#sPnb', 'input');
  ok(await page.evaluate(() => /Faillite|Fonds propres divisés|Absorbé/.test(document.querySelector('#sim').innerText)), 'simulateur de choc réagit');
  await page.click('[data-tab="saisie"]');
  await page.click('#bDup');
  ok(await page.evaluate(() => Object.keys(state.banks).length) === 2, 'duplication d’une banque');
  await page.click('#bDel'); await page.click('#bDelYes');
  ok(await page.evaluate(() => Object.keys(state.banks).length) === 1, 'suppression avec confirmation');
  await page.reload(); await page.waitForSelector('#view .section-head');
  ok(await page.evaluate(() => bank().years.length === 5 && raw('R1', 4) === 23000), 'données conservées après rechargement');
  // import comme nouvelle analyse : nom détecté, modifiable, banque actuelle intacte
  await page.click('[data-tab="import"]');
  await page.fill('#impText', 'BANQUE ATLANTIQUE BENIN\n2022 2023\nCREANCES SUR LA CLIENTELE 5 000 6 000');
  await page.click('#impParse');
  ok(await page.inputValue('#impName') === 'BANQUE ATLANTIQUE BENIN', 'import : nom de la banque pré-rempli depuis le texte', await page.inputValue('#impName'));
  const before = await page.evaluate(() => [state.cur, JSON.stringify(bank().v), Object.keys(state.banks).length]);
  await page.fill('#impName', ''); await page.click('#impApplyNew');
  ok(await page.evaluate(n => Object.keys(state.banks).length === n, before[2]), 'import : nom vide refusé');
  await page.fill('#impName', 'BANQUE DE DAKAR'); await page.click('#impApplyNew');
  const after = await page.evaluate(() => [bank().name, bank().years, bank().v.A4, state.tab, state.history[0].label, state.history[0].kind]);
  ok(after[0] === 'BANQUE DE DAKAR' && JSON.stringify(after[1]) === '[2022,2023]' && JSON.stringify(after[2]) === '[5000,6000]' && after[3] === 'synthese', 'import : nouvelle analyse créée avec le nom saisi, ouverte sur la synthèse', after);
  ok(/^BANQUE DE DAKAR · 2022–2023$/.test(after[4]) && after[5] === 'import', 'import : l’historique porte le nom de la banque', after[4]);
  ok(await page.evaluate(b => JSON.stringify(state.banks[b[0]].v) === b[1], before), 'import : la banque précédente n’est pas modifiée');
  await page.selectOption('#bankSel', before[0]);
  ok(errors.length === 0, 'parcours : aucune erreur JavaScript', errors.slice(0, 3));
  await ctx.close();
}

/* ---------- 6. Thème sombre et grand écran ---------- */
for (const [label, opt] of [['sombre', { dark: true }], ['ordinateur 1280px', { width: 1280 }], ['petit téléphone 320px', { width: 320 }]]) {
  const { page, ctx, errors } = await openApp(opt);
  await visitAllTabs(page, label, errors);
  await ctx.close();
}

/* ---------- 7. Le script R donne les mêmes résultats que l'app ---------- */
let rscript = null;
try { execFileSync('Rscript', ['--version'], { stdio: 'ignore' }); rscript = 'Rscript'; } catch (e) {}
if (!rscript) console.log('⚠ Rscript absent : test de parité R ignoré');
else {
  for (const [label, storage] of [['BAB + CR', null], ['un seul exercice', cases[2][1]], ['12 exercices', cases[3][1]], ['banque vide', cases[6][1]]]) {
    const { page, ctx } = await openApp(storage ? { storage } : {});
    if (!storage) await page.evaluate(cr => Object.assign(bank().v, cr), FAKE_CR);
    for (const base of ['fin', 'moy']) {
      const { code, js } = await page.evaluate(b => { state.base = b; const o = {}; IND.forEach(i => o[i.id] = bank().years.map((_, y) => val(nodeOf(i), y))); return { code: rScript(), js: o }; }, base);
      const dir = mkdtempSync(join(tmpdir(), 'umoa-r-'));
      writeFileSync(join(dir, 'script.R'), code);
      writeFileSync(join(dir, 'check.R'), `pdf(NULL)\ninvisible(capture.output(source("script.R")))\nids <- c(${Object.keys(js).map(k => '"' + k + '"').join(',')})\nfor (id in ids) cat(id, paste(ifelse(is.na(d[[id]]), "NA", sprintf("%.17g", d[[id]])), collapse = ";"), "\\n")\n`);
      let out = '';
      try { out = execFileSync(rscript, ['check.R'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { ok(false, 'R ' + label + ' (' + base + ') : le script s’exécute', String(e.stderr || e.message).slice(0, 300)); continue; }
      let worst = 0, mism = [];
      out.trim().split('\n').forEach(line => {
        const [id, vals] = line.trim().split(' ');
        const rv = vals.split(';').map(x => x === 'NA' ? NaN : Number(x));
        js[id].forEach((v, i) => {
          const a = Number.isFinite(v) ? v : NaN, b = rv[i];
          const same = (Number.isNaN(a) && (Number.isNaN(b) || !Number.isFinite(b))) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
          if (!same) mism.push(id + '[' + i + '] app=' + a + ' R=' + b);
        });
      });
      ok(mism.length === 0, 'R ' + label + ' (' + base + ') : mêmes résultats que l’app', mism.slice(0, 5));
      ok(!/[^\x00-\x7f]/.test(code), 'R ' + label + ' (' + base + ') : script 100 % ASCII (lisible quel que soit l’encodage)', (code.match(/.{0,30}[^\x00-\x7f].{0,10}/) || [])[0]);
      if (base === 'fin') {
        const gd = readdirSync(dir).find(f => f.startsWith('graphiques_'));
        const files = gd ? readdirSync(join(dir, gd)) : [];
        ok(files.filter(f => f.endsWith('.png')).length === 14 && files.includes('graphiques.pdf'), 'R ' + label + ' : 14 graphiques PNG et un PDF produits', files);
        let hasOfficer = false; try { hasOfficer = execFileSync(rscript, ['-e', 'cat(requireNamespace("officer", quietly=TRUE))'], { encoding: 'utf8' }).trim() === 'TRUE'; } catch (e) {}
        if (hasOfficer) ok(files.includes('graphiques_R.docx'), 'R ' + label + ' : document Word des graphiques créé par officer', files);
      }
    }
    await ctx.close();
  }
}

/* ---------- 8. Import de fichiers : Excel, Word, PDF, photo ---------- */
{
  const XLSX = require('xlsx');
  const JSZip = require('jszip');
  // Fichier Excel : en-tête d'années, une case vide au milieu, une feuille de compte de résultat
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Poste', 2021, 2022, 2023],
    ['CREANCES SUR LA CLIENTELE', 131072, 130602, 150766],
    ['Prêts subordonnés', 238, '', 258],
    ['Dettes à l’égard de la clientèle', 218985, 187843, 196626]
  ]), 'Bilan');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Rubrique', 2021, 2022, 2023],
    ['Intérêts et produits assimilés', 20000, 21000, 23000],
    ['Intérêts et charges assimilées', 8000, 8200, 9000]
  ]), 'Compte de résultat');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  // Fichier Word : un paragraphe et un tableau
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const cell = t => '<w:tc><w:p><w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p></w:tc>';
  const row = cs => '<w:tr>' + cs.map(cell).join('') + '</w:tr>';
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bilan de la banque (millions FCFA)</w:t></w:r></w:p><w:tbl>'
    + row(['Poste', '2021', '2022', '2023']) + row(['Caisse, banque centrale, CCP', '11 953', '14 456', '21 982']) + row(['Effets publics et valeurs assimilées', '105 891', '87 754', '78 393']) + row(['Report à nouveau (+/-)', '-10 548', '-7 437', '3 056'])
    + '</w:tbl></w:body></w:document>');
  const docxBuf = await zip.generateAsync({ type: 'nodebuffer' });
  // PDF et image fabriqués à partir d'une page au format du fascicule
  const table = rows => '<table style="font:16px Arial;border-collapse:collapse">' + rows.map(r => '<tr>' + r.map((c, i) => '<td style="padding:4px 14px;text-align:' + (i ? 'right' : 'left') + '">' + c + '</td>').join('') + '</tr>').join('') + '</table>';
  const rowsBilan = [['', '2021', '2022', '2023'], ['CREANCES SUR LA CLIENTELE', '131 072', '130 602', '150 766'], ['DETTES A L\'EGARD DE LA CLIENTELE', '218 985', '187 843', '196 626'], ['EFFETS PUBLICS ET VALEURS ASSIMILEES', '105 891', '87 754', '78 393']];
  const maker = await browser.newPage();
  await maker.setContent('<h3 style="font:16px Arial">BANQUE ATLANTIQUE BENIN</h3>' + table(rowsBilan));
  const pdfBuf = await maker.pdf({ format: 'A4' });
  await maker.setViewportSize({ width: 900, height: 260 });
  const pngBuf = await maker.screenshot({ fullPage: true });
  let long = '';
  for (let i = 1; i <= 10; i++) long += '<div style="page-break-after:always;font:16px Arial">' + (i === 9 ? '<h3>BANQUE TEST SAHEL</h3>' + table([['', '2022', '2023'], ['CREANCES SUR LA CLIENTELE', '5 000', '6 000']]) : '<p>Page ' + i + ' autre banque</p>') + '</div>';
  await maker.setContent(long);
  const longPdf = await maker.pdf({ format: 'A4' });
  await maker.close();

  const { page, ctx, errors } = await openApp();
  await page.click('[data-tab="import"]');
  const upload = async (name, mimeType, buffer, sel = '#impFile') => { await page.setInputFiles(sel, { name, mimeType, buffer }); };
  const waitPreview = async () => { await page.waitForFunction(() => /reconnu|Sauvegarde|Banque détectée/.test(document.querySelector('#impPreview')?.innerText || '') || document.querySelector('#fileStatus.err'), null, { timeout: 120000 }); };
  const parsed = () => page.evaluate(() => parseImport(document.querySelector('#impText').value));

  await upload('Bilan_CITIBANK_2021-2023.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBuf); await waitPreview();
  let r = await parsed();
  ok(await page.inputValue('#impName') === 'CITIBANK', 'Excel : nom de la banque tiré du nom du fichier', await page.inputValue('#impName'));
  ok(JSON.stringify(r.years) === '[2021,2022,2023]' && JSON.stringify(r.vals.A4) === '[131072,130602,150766]' && JSON.stringify(r.vals.P3) === '[218985,187843,196626]', 'Excel : bilan lu', r.vals);
  ok(JSON.stringify(r.vals.A12) === '[238,null,258]', 'Excel : case vide gardée à sa place', r.vals.A12);
  ok(JSON.stringify(r.vals.R1) === '[20000,21000,23000]' && JSON.stringify(r.vals.R2) === '[8000,8200,9000]', 'Excel : deuxième feuille lue', [r.vals.R1, r.vals.R2]);
  await page.click('#impApply');
  ok(await page.evaluate(() => raw('A12', 1) === 248 && raw('A12', 2) === 258 && raw('R1', 2) === 23000), 'Excel : case vide ne remplace pas la valeur existante');
  await page.click('[data-tab="import"]');

  await upload('etats.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBuf); await waitPreview();
  r = await parsed();
  ok(JSON.stringify(r.vals.A1) === '[11953,14456,21982]' && JSON.stringify(r.vals.A2) === '[105891,87754,78393]' && JSON.stringify(r.vals.P9f) === '[-10548,-7437,3056]', 'Word : tableau lu', r.vals);

  await upload('fascicule-extrait.pdf', 'application/pdf', pdfBuf); await waitPreview();
  r = await parsed();
  ok(JSON.stringify(r.vals.A4) === '[131072,130602,150766]' && JSON.stringify(r.vals.P3) === '[218985,187843,196626]' && JSON.stringify(r.vals.A2) === '[105891,87754,78393]', 'PDF : tableau lu ligne par ligne', r.vals);

  await upload('fascicule.pdf', 'application/pdf', longPdf);
  await page.waitForSelector('#pdfQuery');
  ok(/10 pages/.test(await page.innerText('#pdfPick')), 'PDF long : choix des pages proposé');
  await page.fill('#pdfQuery', 'banque test sahel'); await page.click('#pdfFind');
  await page.waitForFunction(() => document.querySelector('#pdfPages').value !== '', null, { timeout: 60000 });
  ok(await page.inputValue('#pdfPages') === '9', 'PDF long : banque retrouvée par son nom', await page.inputValue('#pdfPages'));
  await page.click('#pdfRead'); await waitPreview();
  r = await parsed();
  ok(JSON.stringify(r.vals.A4) === '[5000,6000]' && JSON.stringify(r.years) === '[2022,2023]', 'PDF long : seule la page choisie est lue', r);

  await upload('photo.png', 'image/png', pngBuf); await waitPreview();
  r = await parsed();
  const okA4 = JSON.stringify(r.vals.A4) === '[131072,130602,150766]', okP3 = JSON.stringify(r.vals.P3) === '[218985,187843,196626]';
  ok(okA4 && okP3, 'photo (reconnaissance de texte) : chiffres lus', { A4: r.vals.A4, P3: r.vals.P3, texte: (await page.inputValue('#impText')).slice(0, 300) });

  await upload('vieux.doc', 'application/msword', Buffer.from('x'));
  await page.waitForSelector('#fileStatus.err');
  ok(/\.docx/.test(await page.innerText('#fileStatus')), 'Word .doc : message clair');
  await upload('image-cassee.jpg', 'image/jpeg', Buffer.from('pas une image'));
  await page.waitForSelector('#fileStatus.err');
  ok(/illisible/i.test(await page.innerText('#fileStatus')), 'image illisible : message clair');
  await upload('donnees.zip', 'application/zip', Buffer.from('x'));
  await page.waitForSelector('#fileStatus.err');
  ok(/Format non reconnu/.test(await page.innerText('#fileStatus')), 'format inconnu : message clair');
  ok(errors.length === 0, 'import de fichiers : aucune erreur JavaScript', errors.slice(0, 3));
  await ctx.close();

  // Module indisponible (hors connexion) : message, pas de blocage
  {
    const c2 = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await c2.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, rt => rt.abort());
    const p2 = await c2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await p2.goto(BASE); await p2.click('[data-tab="import"]');
    await p2.setInputFiles('#impFile', { name: 'etats.xlsx', mimeType: 'application/octet-stream', buffer: xlsxBuf });
    await p2.waitForSelector('#fileStatus.err');
    ok(/connexion/.test(await p2.innerText('#fileStatus')), 'hors connexion : message clair');
    ok(e2.length === 0, 'hors connexion : aucune erreur JavaScript', e2);
    await c2.close();
  }

  // Photo lue par Claude (capacité simulée comme dans l'aperçu claude.ai)
  {
    const { page: p3, ctx: c3, errors: e3 } = await openApp({ init: () => {
      const s = async () => ({ text: '' });
      s.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 2e7, mediaTypes: ['image/jpeg', 'image/png'] } });
      s.json = async (prompt, opts) => { window.__claudeCalls = (window.__claudeCalls || 0) + 1; window.__claudeImgs = opts.images.length; return { annees: [2021, 2022, 2023], lignes: [{ libelle: 'CREANCES SUR LA CLIENTELE', valeurs: [131072, 130602, 150766] }, { libelle: 'COUT DU RISQUE', valeurs: [1200, null, 2100] }, { libelle: 'Bizarre\tavec;séparateurs', valeurs: ['x'] }] }; };
      window.claude = { use: async n => n === 'sample' ? s : null };
    } });
    await p3.click('[data-tab="import"]');
    await p3.setInputFiles('#impFile', [{ name: 'p1.png', mimeType: 'image/png', buffer: pngBuf }, { name: 'p2.png', mimeType: 'image/png', buffer: pngBuf }]);
    await p3.waitForFunction(() => /reconnu/.test(document.querySelector('#impPreview')?.innerText || ''), null, { timeout: 30000 });
    const r3 = await p3.evaluate(() => [parseImport(document.querySelector('#impText').value).vals, window.__claudeCalls, window.__claudeImgs]);
    ok(JSON.stringify(r3[0].A4) === '[131072,130602,150766]' && JSON.stringify(r3[0].R13) === '[1200,null,2100]', 'photo lue par Claude : valeurs reprises, case illisible laissée vide', r3[0]);
    ok(r3[1] === 1 && r3[2] === 2, 'photo lue par Claude : un seul appel pour deux photos', r3.slice(1));
    ok(e3.length === 0, 'photo lue par Claude : aucune erreur JavaScript', e3);
    await c3.close();
  }
}

/* ---------- 9. Historique d'analyse ---------- */
{
  const { page, ctx, errors } = await openApp();
  await page.click('[data-tab="historique"]');
  ok(/Aucune analyse enregistrée/.test(await page.innerText('#view')), 'historique : état vide expliqué');
  await page.fill('#hLabel', 'BAB version initiale'); await page.fill('#hNote', 'avant compte de résultat');
  await page.click('#hSave');
  let h = await page.evaluate(() => state.history.map(e => [e.label, e.note, e.kind, e.res.vals.roe[2], e.bank.v.A4[2]]));
  ok(h.length === 1 && h[0][0] === 'BAB version initiale' && h[0][1] === 'avant compte de résultat' && h[0][2] === 'manuel', 'historique : analyse enregistrée avec nom et note', h);
  ok(near(h[0][3], 2908 / 27289) && h[0][4] === 150766, 'historique : résultats et données figés au moment de l’enregistrement', h[0]);
  // la période choisie n'altère pas l'instantané : tous les exercices sont gardés
  await page.click('[data-tab="renta"]'); await page.selectOption('#fromSel', '2022');
  await page.click('[data-tab="synthese"]'); await page.click('[data-hsave]');
  h = await page.evaluate(() => [state.history.length, state.history[0].res.years, state.history[0].period]);
  ok(h[0] === 2 && JSON.stringify(h[1]) === '[2021,2022,2023]' && JSON.stringify(h[2]) === '[2022,2023]', 'historique : enregistrement depuis la synthèse, période notée, tous les exercices gardés', h);
  await page.selectOption('#fromSel', '2021');
  // modification puis comparaison
  await page.click('[data-tab="saisie"]');
  await page.fill('#i-P9g-2', '1 000'); await page.press('#i-P9g-2', 'Tab');
  await page.click('[data-tab="historique"]');
  const first = await page.evaluate(() => state.history[state.history.length - 1].id);
  await page.click('[data-hcmp="' + first + '"]');
  const cmp = await page.innerText('[data-hbox="' + first + '"]');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'historique : comparaison ouverte sans débordement horizontal');
  ok(/Comparaison sur l’exercice 2023/.test(cmp) && /Résultat net/.test(cmp) && /−1\s?908/.test(cmp), 'historique : comparaison à l’état actuel (écart de résultat net)', cmp.slice(0, 400));
  await page.selectOption('#hA', first); await page.selectOption('#hB', 'current'); await page.click('#hCmp');
  ok(/ROE/.test(await page.innerText('#hCmpOut')), 'historique : comparaison de deux analyses');
  await page.click('[data-hdet="' + first + '"]');
  ok(/2021[\s\S]*2022[\s\S]*2023/.test(await page.innerText('[data-hbox="' + first + '"]')), 'historique : détails par exercice');
  // restauration : l'état actuel est sauvegardé avant
  await page.click('[data-hres="' + first + '"]'); await page.click('[data-hresok]');
  h = await page.evaluate(() => [raw('P9g', 2), state.history.length, state.history[0].kind, state.history[0].bank.v.P9g[2], state.tab]);
  ok(h[0] === 2908 && h[1] === 3 && h[2] === 'auto' && h[3] === 1000 && h[4] === 'synthese', 'historique : restauration, avec sauvegarde automatique de l’état remplacé', h);
  // restauration d'une banque supprimée
  await page.click('[data-tab="saisie"]'); await page.click('#bDup'); await page.click('[data-tab="historique"]');
  await page.fill('#hLabel', 'copie'); await page.click('#hSave');
  const copyBank = await page.evaluate(() => state.cur);
  await page.click('[data-tab="saisie"]'); await page.click('#bDel'); await page.click('#bDelYes');
  await page.click('[data-tab="historique"]');
  const copyEntry = await page.evaluate(id => state.history.find(e => e.bankId === id).id, copyBank);
  await page.click('[data-hcmp="' + copyEntry + '"]');
  ok(/n’existe plus/.test(await page.innerText('[data-hbox="' + copyEntry + '"]')), 'historique : banque supprimée signalée');
  await page.click('[data-hres="' + copyEntry + '"]'); await page.click('[data-hresok]');
  ok(await page.evaluate(id => !!state.banks[id] && state.cur === id, copyBank), 'historique : banque supprimée recréée');
  // import ajoute une entrée
  await page.click('[data-tab="import"]');
  await page.fill('#impText', 'INTERETS ET PRODUITS ASSIMILES 20 100 21 300 23 900'); await page.click('#impParse'); await page.click('#impApply');
  ok(await page.evaluate(() => state.history[0].kind === 'import'), 'historique : entrée automatique après import');
  // persistance, filtre, suppression
  const n = await page.evaluate(() => state.history.length);
  await page.reload(); await page.waitForSelector('#view .section-head');
  ok(await page.evaluate(() => state.history.length) === n, 'historique : conservé après rechargement');
  await page.click('[data-tab="historique"]');
  ok(await page.$('#hFilter') !== null, 'historique : filtre par banque quand plusieurs banques');
  const del = await page.evaluate(() => state.history[0].id);
  await page.click('[data-hdel="' + del + '"]'); await page.click('[data-hdelok]');
  ok(await page.evaluate(() => state.history.length) === n - 1, 'historique : suppression d’une entrée');
  // sauvegarde JSON emporte l'historique
  const back = await page.evaluate(() => { const j = parseImport(JSON.stringify({ banks: state.banks, cur: state.cur, params: state.params, history: state.history })); return j.json.history.length; });
  ok(back === n - 1, 'historique : inclus dans la sauvegarde JSON', back);
  // plafond
  const cap = await page.evaluate(() => { for (let i = 0; i < 70; i++) addHistory(i % 2 ? 'import' : 'manuel', 'x' + i, ''); return [state.history.length, state.history.filter(e => e.kind === 'manuel').length]; });
  ok(cap[0] === 60 && cap[1] >= 35, 'historique : plafonné à 60, les entrées automatiques partent en premier', cap);
  await page.click('[data-tab="synthese"]'); await page.click('[data-tab="historique"]');
  await page.click('#hClear'); await page.click('#hClearOk');
  ok(await page.evaluate(() => state.history.length === 0 && Object.keys(state.banks).length >= 1), 'historique : vidé sans toucher aux banques');
  ok(errors.length === 0, 'historique : aucune erreur JavaScript', errors.slice(0, 3));
  await ctx.close();
}
{
  const { page, ctx, errors } = await openApp({ storage: { banks: { a: { id: 'a', name: 'A', years: [2023], v: { A4: [1] } } }, cur: 'a', history: [null, 5, { label: 'cassée' }, { id: 'ok', label: 'valide', bank: { name: 'B', years: [2022], v: { A4: [2] } }, res: { years: [2022], vals: { roe: ['x'] } } }] } });
  ok(await page.evaluate(() => state.history.length === 1 && state.history[0].label === 'valide' && state.history[0].res.vals.roe[0] === null), 'historique abîmé : entrées invalides retirées');
  await visitAllTabs(page, 'historique abîmé', errors);
  await ctx.close();
}

/* ---------- 10. Rapport Word ---------- */
{
  {
    const { page, ctx } = await openApp();
    const tk = await page.evaluate(() => [niceTicks(0, 27613), niceTicks(-37258, 27613), niceTicks(0, 0.3), niceTicks(0, 1.2)]);
    ok(tk.every((t, i) => t[t.length - 1] >= [27613, 27613, 0.3, 1.2][i] && t[0] <= [0, -37258, 0, 0][i]), 'graphiques du rapport : l’axe couvre toutes les valeurs', tk);
    await ctx.close();
  }
  const JSZip = require('jszip');
  const hasSoffice = (() => { try { execFileSync('soffice', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
  const checkDocx = async (buf, label, expect) => {
    const dir = mkdtempSync(join(tmpdir(), 'umoa-docx-'));
    const file = join(dir, 'rapport.docx');
    writeFileSync(file, buf);
    const zip = await JSZip.loadAsync(buf);
    const parts = Object.keys(zip.files).filter(f => /\.(xml|rels)$/.test(f));
    let wellFormed = true, bad = '';
    for (const f of parts) {
      const x = await zip.file(f).async('string');
      writeFileSync(join(dir, 'part.xml'), x);
      try { execFileSync('python3', ['-c', 'import sys,xml.dom.minidom as m; m.parse(sys.argv[1])', join(dir, 'part.xml')], { stdio: 'pipe' }); }
      catch (e) { wellFormed = false; bad = f + ' : ' + String(e.stderr).slice(-200); }
    }
    ok(wellFormed, label + ' : toutes les parties XML sont bien formées', bad);
    const doc = await zip.file('word/document.xml').async('string');
    let info = '';
    try { info = execFileSync('python3', ['-c', 'import docx,sys; d=docx.Document(sys.argv[1]); print(len(d.paragraphs), len(d.tables), len(d.inline_shapes))', file], { encoding: 'utf8' }).trim(); } catch (e) { info = 'ERREUR ' + String(e.stderr).slice(-300); }
    ok(/^\d+ \d+ \d+$/.test(info), label + ' : le document s’ouvre (python-docx)', info);
    if (hasSoffice) {
      try {
        execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, file], { stdio: 'pipe', timeout: 120000 });
        const txt = execFileSync('pdftotext', ['-layout', join(dir, 'rapport.pdf'), '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const pages = Number((execFileSync('pdfinfo', [join(dir, 'rapport.pdf')], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/) || [])[1]);
        ok(pages >= 1, label + ' : LibreOffice le convertit en PDF (' + pages + ' pages)');
        const missing = expect.filter(e => !(e instanceof RegExp ? e.test(txt) : txt.includes(e)));
        ok(missing.length === 0, label + ' : contenu attendu présent dans le PDF', missing.map(String));
        return { doc, info, txt, pages, dir };
      } catch (e) { ok(false, label + ' : conversion LibreOffice', String(e.stderr || e.message).slice(-300)); }
    }
    return { doc, info, dir };
  };
  const ALL_SECTIONS = ['synthese', 'dynamique', 'structure', 'renta', 'faillite', 'bale', 'methode'];
  const { page, ctx, errors } = await openApp();
  await page.evaluate(cr => Object.assign(bank().v, cr), FAKE_CR);
  const b64 = await page.evaluate(async () => { const blob = await buildReport({ title: 'Analyse BAB', author: 'Isaac', sections: REPORT_SECTIONS.map(s => s[0]), charts: true, allYears: true, comment: 'Banque en redressement.\nÀ suivre.' }); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; u.forEach(c => s += String.fromCharCode(c)); return btoa(s); });
  const full = await checkDocx(Buffer.from(b64, 'base64'), 'rapport complet', ['Analyse BAB', 'Réalisé par Isaac', 'Synthèse et points clés', 'Banque en redressement.', 'Dynamique du bilan', 'Ratio de transformation', 'Test de faillite', 'Bâle III', 'Méthodologie', '76,68 %', '10,66 %', /150\s?766/, /196\s?626/, 'Figure 1', /Ratio de transformation\s*=/, /ROE\s*=/]);
  ok(/<m:f>/.test(full.doc) && (full.doc.match(/<m:oMathPara>/g) || []).length > 40, 'rapport : formules en équations Word (fractions)', (full.doc.match(/<m:oMathPara>/g) || []).length);
  ok(Number(full.info.split(' ')[2]) >= 25 && Number(full.info.split(' ')[1]) >= 20, 'rapport : graphiques et tableaux inclus', full.info);
  if (full.pages) ok(full.pages >= 15, 'rapport complet : plusieurs pages', full.pages);
  // rapport minimal, sans graphiques, une seule partie, banque vide et un seul exercice
  for (const [label, storage, opt, expect] of [
    ['rapport sans graphiques', null, { sections: ['renta'], charts: false, allYears: false }, ['Rentabilité', 'ROE']],
    ['rapport banque vide', { banks: { a: { id: 'a', name: 'Vide & <Cie>', years: [2022, 2023], v: {} } }, cur: 'a' }, { sections: ALL_SECTIONS, charts: true }, ['Vide & <Cie>', 'Données manquantes']],
    ['rapport un exercice', { banks: { a: { id: 'a', name: 'Une année', years: [2023], v: fullBank(1, () => [1000]) } }, cur: 'a' }, { sections: ALL_SECTIONS, charts: true, allYears: true }, ['Une année', 'Test de faillite']]
  ]) {
    const { page: p2, ctx: c2, errors: e2 } = await openApp(storage ? { storage } : {});
    const r = await p2.evaluate(async o => { try { const blob = await buildReport(o); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; u.forEach(c => s += String.fromCharCode(c)); return btoa(s); } catch (e) { return 'ERR ' + e.message; } }, opt);
    ok(!r.startsWith('ERR'), label + ' : généré sans erreur', r.slice(0, 200));
    if (!r.startsWith('ERR')) { const res = await checkDocx(Buffer.from(r, 'base64'), label, expect); if (label === 'rapport sans graphiques') ok(res.info.endsWith(' 0'), label + ' : aucune image', res.info); }
    ok(e2.length === 0, label + ' : aucune erreur JavaScript', e2);
    await c2.close();
  }
  // bouton : téléchargement réel sur le site
  await page.click('[data-tab="rapport"]');
  await page.uncheck('#rCharts');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#rGo')]);
  ok(/^Analyse_Banque_Atlantique_Benin_BAB_2021-2023\.docx$/.test(dl.suggestedFilename()), 'rapport : téléchargement du fichier .docx', dl.suggestedFilename());
  ok(/Rapport prêt/.test(await page.innerText('#rStatus')), 'rapport : état affiché');
  ok(await page.evaluate(() => state.report && state.report.charts === false), 'rapport : options mémorisées');
  await page.evaluate(() => { document.querySelectorAll('[data-rsec]').forEach(c => { c.checked = false; }); });
  await page.click('#rGo');
  ok(/au moins une partie/.test(await page.innerText('#rStatus')), 'rapport : aucune partie cochée signalée');
  ok(errors.length === 0, 'rapport : aucune erreur JavaScript', errors.slice(0, 3));
  await ctx.close();
  // dans claude.ai (page dans un cadre) : passage par la capacité « downloads »
  {
    const c3 = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await routeCdn(c3);
    await c3.addInitScript(() => { if (window.self !== window.top) window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved = [filename, data instanceof Blob, data.size]; return { status: 'saved' }; } } : null }; });
    const p3 = await c3.newPage(); const e3 = []; p3.on('pageerror', e => e3.push(e.message));
    await p3.route(BASE + 'cadre', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<iframe src="' + BASE + '" style="width:400px;height:900px;border:0"></iframe>' }));
    await p3.goto(BASE + 'cadre');
    const fr = p3.frames().find(f => f !== p3.mainFrame());
    await fr.waitForSelector('#view .section-head');
    await fr.click('[data-tab="rapport"]'); await fr.uncheck('#rCharts'); await fr.click('#rGo');
    await fr.waitForFunction(() => window.__saved, null, { timeout: 60000 });
    const sv = await fr.evaluate(() => window.__saved);
    ok(/\.docx$/.test(sv[0]) && sv[1] && sv[2] > 5000, 'rapport dans claude.ai : fichier remis à la capacité de téléchargement', sv);
    ok(e3.length === 0, 'rapport dans claude.ai : aucune erreur JavaScript', e3);
    await c3.close();
  }
  if (full.dir) console.log('Rapport d’exemple : ' + full.dir);
}

/* ---------- 11. Compte par e-mail : fonction serveur et synchronisation entre appareils ---------- */
{
  const { handleHistorique, mergeHistory, HIST_MAX } = await import('../server/historique.mjs');
  const memStore = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true }; } }; };
  const entry = (id, at, kind = 'manuel') => ({ id, at, kind, label: id, bank: { name: 'B', years: [2023], v: {} }, res: { years: [2023], vals: {} } });
  const call = (store, user, method, body, origin = 'https://app.test') => handleHistorique(new Request('https://app.test/api/historique', { method, headers: origin ? { origin, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), { getUser: async () => user, store });
  const st = memStore(), alice = { id: 'a1', email: 'alice@test.sn' }, bob = { id: 'b2', email: 'bob@test.ci' };
  let r = await call(st, null, 'GET');
  ok(r.status === 401, 'serveur : connexion requise', r.status);
  r = await call(st, alice, 'GET'); let d = await r.json();
  ok(r.status === 200 && d.history.length === 0, 'serveur : historique vide au départ');
  r = await call(st, alice, 'PUT', { history: [entry('h1', '2026-10-01T10:00:00Z'), entry('h2', '2026-10-02T10:00:00Z')], deleted: [] }); d = await r.json();
  ok(r.status === 200 && d.history.map(e => e.id).join() === 'h2,h1', 'serveur : enregistrement, plus récent d’abord', d.history.map(e => e.id));
  r = await call(st, alice, 'PUT', { history: [entry('h3', '2026-10-03T10:00:00Z')], deleted: ['h1'] }); d = await r.json();
  ok(d.history.map(e => e.id).join() === 'h3,h2' && d.deleted.includes('h1'), 'serveur : fusion d’un autre appareil et suppression propagée', d.history.map(e => e.id));
  r = await call(st, alice, 'PUT', { history: [entry('h1', '2026-10-01T10:00:00Z')], deleted: [] }); d = await r.json();
  ok(!d.history.some(e => e.id === 'h1'), 'serveur : une entrée supprimée ne revient pas depuis un appareil en retard');
  r = await call(st, bob, 'GET'); d = await r.json();
  ok(d.history.length === 0, 'serveur : chaque compte a son propre historique');
  r = await call(st, alice, 'PUT', { history: [] }, 'https://pirate.test');
  ok(r.status === 403, 'serveur : écriture refusée depuis un autre site', r.status);
  r = await call(st, alice, 'PUT', { history: [] }, null);
  ok(r.status === 403, 'serveur : écriture refusée sans origine', r.status);
  r = await call(st, alice, 'PUT', '{ cassé');
  ok(r.status === 400, 'serveur : JSON invalide refusé', r.status);
  r = await call(st, alice, 'PUT', { history: 'x' });
  ok(r.status === 400, 'serveur : format invalide refusé', r.status);
  r = await call(st, alice, 'PUT', 'x'.repeat(3_600_000));
  ok(r.status === 413, 'serveur : envoi trop volumineux refusé', r.status);
  r = await call(st, alice, 'DELETE');
  ok(r.status === 405, 'serveur : méthode non prévue refusée', r.status);
  r = await call(st, alice, 'PUT', { history: [{ id: 'bad' }, null, 5, entry('h4', '2026-10-04T10:00:00Z')] }); d = await r.json();
  ok(d.history.map(e => e.id).join() === 'h4,h3,h2', 'serveur : entrées mal formées ignorées', d.history.map(e => e.id));
  const many = Array.from({ length: 80 }, (_, i) => entry('m' + i, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), i % 3 ? 'manuel' : 'import'));
  const mg = mergeHistory({ history: [] }, { history: many });
  ok(mg.history.length === HIST_MAX && mg.history.filter(e => e.kind === 'import').length < many.filter(e => e.kind === 'import').length, 'serveur : plafond, les imports partent d’abord', mg.history.length);

  // Banques : fusion
  {
    const { mergeBanks } = await import('../server/historique.mjs');
    const bk = (name, mod) => ({ name, years: [2023], v: { A4: [1] }, mod });
    let m = mergeBanks({ banks: { a: bk('A v1', 100), b: bk('B', 100) } }, { banks: { a: bk('A v2', 200), c: bk('C', 50) } });
    ok(Object.keys(m.banks).sort().join() === 'a,b,c' && m.banks.a.name === 'A v2', 'banques : union, la version la plus récente l’emporte', m.banks);
    m = mergeBanks(m, { banks: { a: bk('A vieux', 150) }, banksDeleted: { b: 300 } });
    ok(!m.banks.b && m.banks.a.name === 'A v2' && m.banksDeleted.b === 300, 'banques : suppression propagée, version ancienne ignorée', Object.keys(m.banks));
    m = mergeBanks(m, { banks: { b: bk('B recréée', 400) } });
    ok(m.banks.b && m.banks.b.name === 'B recréée', 'banques : une banque modifiée après sa suppression revient');
    m = mergeBanks({}, { banks: { x: { name: 'sans années', years: [], v: {} }, y: 'cassé', z: bk('Z') } });
    ok(Object.keys(m.banks).join() === 'z', 'banques : entrées invalides ignorées', Object.keys(m.banks));
    const r = await call(st, alice, 'PUT', { history: [], banks: [1, 2] });
    ok(r.status === 400, 'banques : format invalide refusé', r.status);
  }
  // Comptes : fonction serveur seule
  const { handleCompte, userFromRequest } = await import('../server/compte.mjs');
  const kv = () => { const m = new Map(); return { m,
    async get(k, o = {}) { if (!m.has(k)) return null; return o.type === 'json' ? JSON.parse(m.get(k)) : m.get(k); },
    async set(k, v, o = {}) { if (o.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, String(v)); return { modified: true }; },
    async setJSON(k, v, o = {}) { if (o.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, JSON.stringify(v)); return { modified: true }; } }; };
  const acc = kv();
  const post = (action, body, extra = {}) => handleCompte(new Request('https://app.test/api/compte/' + action, { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json', ...(extra.headers || {}) }, body: JSON.stringify(body) }), action, { store: acc });
  const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
  let rc = await post('inscription', { email: ' Isaac@Test.CI ', password: 'motdepasse1' });
  ok(rc.status === 201 && /^umoa_session=.+/.test(cookieOf(rc)) && /HttpOnly/.test(rc.headers.get('set-cookie')) && /Secure/.test(rc.headers.get('set-cookie')), 'compte : inscription sans vérification, session ouverte (cookie HttpOnly, Secure)', rc.status);
  const ck = cookieOf(rc);
  const storedUser = [...acc.m.entries()].find(([k]) => k.startsWith('u/'));
  ok(storedUser && !storedUser[1].includes('motdepasse1') && JSON.parse(storedUser[1]).email === 'isaac@test.ci', 'compte : mot de passe jamais stocké en clair, e-mail normalisé');
  rc = await post('inscription', { email: 'isaac@test.ci', password: 'autremotdepasse' });
  ok(rc.status === 409, 'compte : une adresse ne peut être inscrite deux fois', rc.status);
  rc = await post('inscription', { email: 'pas-un-mail', password: 'motdepasse1' });
  ok(rc.status === 400, 'compte : adresse invalide refusée', rc.status);
  rc = await post('inscription', { email: 'x@test.sn', password: 'court' });
  ok(rc.status === 400, 'compte : mot de passe trop court refusé', rc.status);
  rc = await post('connexion', { email: 'ISAAC@test.ci', password: 'motdepasse1' });
  ok(rc.status === 200 && cookieOf(rc).length > 20, 'compte : connexion (adresse sans tenir compte des majuscules)', rc.status);
  rc = await post('connexion', { email: 'inconnu@test.ci', password: 'motdepasse1' });
  ok(rc.status === 401, 'compte : adresse inconnue refusée', rc.status);
  const me = await handleCompte(new Request('https://app.test/api/compte/moi', { headers: { cookie: ck } }), 'moi', { store: acc });
  ok(me.status === 200 && (await me.json()).email === 'isaac@test.ci', 'compte : session reconnue');
  const forged = ck.replace(/.$/, c => c === 'A' ? 'B' : 'A');
  ok(await userFromRequest(new Request('https://app.test/', { headers: { cookie: forged } }), acc) === null, 'compte : cookie falsifié refusé');
  rc = await handleCompte(new Request('https://app.test/api/compte/connexion', { method: 'POST', headers: { origin: 'https://pirate.test' }, body: '{}' }), 'connexion', { store: acc });
  ok(rc.status === 403, 'compte : requête venant d’un autre site refusée', rc.status);
  for (let i = 0; i < 5; i++) await post('connexion', { email: 'isaac@test.ci', password: 'mauvais' + i });
  rc = await post('connexion', { email: 'isaac@test.ci', password: 'motdepasse1' });
  ok(rc.status === 429, 'compte : blocage temporaire après 5 essais ratés', rc.status);
  rc = await post('deconnexion', {});
  ok(/Max-Age=0/.test(rc.headers.get('set-cookie') || ''), 'compte : déconnexion efface le cookie');

  // Deux appareils dans le navigateur, même compte : vraies fonctions serveur (compte + historique)
  const shared = memStore(), accStore = kv();
  const device = async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await routeCdn(ctx);
    await ctx.route(/\/api\/(compte\/[a-z]+|historique)$/, async route => {
      const rq = route.request(), h = await rq.allHeaders();
      const req = new Request(rq.url(), { method: rq.method(), headers: { origin: h.origin || '', cookie: h.cookie || '', 'content-type': 'application/json' }, body: ['POST', 'PUT'].includes(rq.method()) ? rq.postData() || '' : undefined });
      const m = rq.url().match(/compte\/([a-z]+)$/);
      const res = m ? await handleCompte(req, m[1], { store: accStore }) : await handleHistorique(req, { getUser: () => userFromRequest(req, accStore), store: shared });
      const headers = { 'content-type': 'application/json' }; if (res.headers.get('set-cookie')) headers['set-cookie'] = res.headers.get('set-cookie');
      route.fulfill({ status: res.status, headers, body: await res.text() });
    });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE); await page.waitForSelector('#view .section-head');
    return { ctx, page, errors };
  };
  const A = await device(), B = await device();
  await A.page.click('[data-tab="historique"]');
  ok(/Se connecter/.test(await A.page.innerText('#accountCard')), 'compte : formulaire de connexion affiché');
  await A.page.click('#accSwitch');
  await A.page.fill('#accEmail', 'isaac@test.ci'); await A.page.fill('#accPw', 'court'); await A.page.click('#accGo');
  await A.page.waitForSelector('#accStatus.err');
  ok(/8 caractères/.test(await A.page.innerText('#accStatus')), 'compte : mot de passe trop court signalé');
  await A.page.fill('#accPw', 'motdepasse1'); await A.page.click('#accGo');
  await A.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
  ok(/Compte créé/.test(await A.page.innerText('#accountCard')), 'compte : inscription et connexion immédiates, sans e-mail de vérification');
  await A.page.fill('#hLabel', 'Analyse depuis l’iPhone'); await A.page.click('#hSave');
  for (let i = 0; i < 100 && ![...shared.m.values()].some(v => v.includes('Analyse depuis l’iPhone')); i++) await A.page.waitForTimeout(100);
  const stored = [...shared.m.values()].map(v => JSON.parse(v));
  ok(stored.length === 1 && stored[0].history.some(e => e.label === 'Analyse depuis l’iPhone') && stored[0].email === 'isaac@test.ci', 'compte : analyse enregistrée sur le compte', stored.map(x => x.history.length));
  // appareil B : mauvais mot de passe puis connexion, retrouve l'analyse
  await B.page.click('[data-tab="historique"]');
  await B.page.fill('#accEmail', 'isaac@test.ci'); await B.page.fill('#accPw', 'mauvais'); await B.page.click('#accGo');
  await B.page.waitForSelector('#accStatus.err');
  ok(/incorrect/.test(await B.page.innerText('#accStatus')), 'compte : mauvais mot de passe signalé');
  await B.page.fill('#accPw', 'motdepasse1'); await B.page.click('#accGo');
  await B.page.waitForFunction(() => state.history.some(e => e.label === 'Analyse depuis l’iPhone'), null, { timeout: 15000 });
  ok(/Analyse depuis l’iPhone/.test(await B.page.innerText('.hist-list')), 'compte : l’analyse apparaît sur le deuxième appareil');
  // banques : A crée « BANQUE DE DAKAR », B la retrouve dans le menu Banque
  await A.page.click('[data-tab="saisie"]'); await A.page.click('#bNew');
  await A.page.fill('#m-name', 'BANQUE DE DAKAR'); await A.page.press('#m-name', 'Tab');
  await A.page.fill('#i-A4-0', '1 000'); await A.page.press('#i-A4-0', 'Tab');
  for (let i = 0; i < 100 && ![...shared.m.values()].some(v => v.includes('BANQUE DE DAKAR')); i++) await A.page.waitForTimeout(100);
  ok([...shared.m.values()].some(v => v.includes('BANQUE DE DAKAR')), 'banques : nouvelle banque envoyée sur le compte');
  await B.page.click('#accSync');
  await B.page.waitForFunction(() => [...document.querySelectorAll('#bankSel option')].some(o => o.textContent === 'BANQUE DE DAKAR'), null, { timeout: 15000 });
  ok(await B.page.evaluate(() => Object.values(state.banks).find(b => b.name === 'BANQUE DE DAKAR').v.A4[0]) === 1000, 'banques : la banque et ses chiffres apparaissent sur l’autre appareil');
  // B supprime la banque, A ne l'a plus après synchronisation
  await B.page.selectOption('#bankSel', { label: 'BANQUE DE DAKAR' });
  await B.page.click('[data-tab="saisie"]'); await B.page.click('#bDel'); await B.page.click('#bDelYes');
  for (let i = 0; i < 100 && [...shared.m.values()].some(v => JSON.parse(v).banks && Object.values(JSON.parse(v).banks).some(b => b.name === 'BANQUE DE DAKAR')); i++) await B.page.waitForTimeout(100);
  await A.page.click('[data-tab="historique"]'); await A.page.click('#accSync');
  await A.page.waitForFunction(() => !Object.values(state.banks).some(b => b.name === 'BANQUE DE DAKAR'), null, { timeout: 15000 });
  ok(await A.page.evaluate(() => ![...document.querySelectorAll('#bankSel option')].some(o => o.textContent === 'BANQUE DE DAKAR')), 'banques : suppression propagée à l’autre appareil');
  await B.page.click('[data-tab="historique"]');
  // B supprime, A le voit à la synchronisation suivante
  const hid = await B.page.evaluate(() => state.history.find(e => e.label === 'Analyse depuis l’iPhone').id);
  await B.page.click('[data-hdel="' + hid + '"]'); await B.page.click('[data-hdelok]');
  for (let i = 0; i < 100 && [...shared.m.values()].some(v => v.includes('Analyse depuis l’iPhone')); i++) await B.page.waitForTimeout(100);
  await A.page.click('#accSync');
  await A.page.waitForFunction(id => !state.history.some(e => e.id === id), hid, { timeout: 15000 });
  ok(true, 'compte : une suppression faite sur un appareil se propage à l’autre');
  // un troisième appareil neuf retrouve toutes les banques à la connexion
  await A.page.click('[data-tab="saisie"]'); await A.page.click('#bNew'); await A.page.fill('#m-name', 'CORIS BANK'); await A.page.press('#m-name', 'Tab');
  for (let i = 0; i < 100 && ![...shared.m.values()].some(v => v.includes('CORIS BANK')); i++) await A.page.waitForTimeout(100);
  await A.page.click('[data-tab="historique"]');
  const Cd = await device();
  await Cd.page.click('[data-tab="historique"]');
  await Cd.page.fill('#accEmail', 'isaac@test.ci'); await Cd.page.fill('#accPw', 'motdepasse1'); await Cd.page.click('#accGo');
  await Cd.page.waitForFunction(() => [...document.querySelectorAll('#bankSel option')].some(o => o.textContent === 'CORIS BANK'), null, { timeout: 15000 });
  const namesA = await A.page.evaluate(() => Object.values(state.banks).map(b => b.name).sort().join('|'));
  const namesC = await Cd.page.evaluate(() => Object.values(state.banks).map(b => b.name).sort().join('|'));
  ok(namesA === namesC, 'banques : à la connexion, toutes les banques du compte s’affichent', [namesA, namesC]);
  ok(/banque/.test(await Cd.page.innerText('#accStatus')), 'banques : message de connexion indique les banques retrouvées', await Cd.page.innerText('#accStatus'));
  await Cd.ctx.close();
  // session retrouvée au rechargement
  await A.page.reload(); await A.page.waitForSelector('#view .section-head'); await A.page.click('[data-tab="historique"]');
  await A.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
  ok(true, 'compte : session retrouvée au rechargement');
  // déconnexion avec effacement local
  await A.page.fill('#hLabel', 'Deuxième analyse'); await A.page.click('#hSave');
  for (let i = 0; i < 100 && ![...shared.m.values()].some(v => v.includes('Deuxième analyse')); i++) await A.page.waitForTimeout(100);
  await A.page.click('#accLogoutWipe');
  await A.page.waitForFunction(() => /Déconnecté/.test(document.querySelector('#accountCard').innerText));
  ok(await A.page.evaluate(() => state.history.length === 0), 'compte : déconnexion avec effacement de l’historique local');
  ok([...shared.m.values()].map(v => JSON.parse(v))[0].history.length > 0, 'compte : l’historique reste sur le compte après effacement local');
  ok(await A.page.evaluate(async () => (await fetch('/api/compte/moi')).status) === 401, 'compte : session fermée côté serveur après déconnexion');
  // inscription d'une adresse déjà prise
  await A.page.click('#accSwitch'); await A.page.fill('#accEmail', 'isaac@test.ci'); await A.page.fill('#accPw', 'encoreunautre'); await A.page.click('#accGo');
  await A.page.waitForSelector('#accStatus.err');
  ok(/existe déjà/.test(await A.page.innerText('#accStatus')), 'compte : adresse déjà inscrite signalée');
  ok(A.errors.length === 0 && B.errors.length === 0, 'compte : aucune erreur JavaScript', [...A.errors, ...B.errors].slice(0, 3));
  ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'compte : pas de débordement sur téléphone');
  await A.ctx.close(); await B.ctx.close();
  // service de connexion injoignable : message clair
  {
    const { page, ctx, errors } = await openApp({ storage: undefined });
    await page.click('[data-tab="historique"]');
    await page.fill('#accEmail', 'isaac@test.ci'); await page.fill('#accPw', 'x'); await page.click('#accGo');
    await page.waitForSelector('#accStatus.err');
    ok(/pas encore disponibles|ne répond pas/.test(await page.innerText('#accStatus')), 'compte : site sans partie serveur signalé clairement', await page.innerText('#accStatus'));
    ok(errors.length === 0, 'compte injoignable : aucune erreur JavaScript', errors);
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(`\n${pass} tests réussis, ${fail} en échec`);
if (fail) { console.log('\nÉchecs :\n- ' + failures.join('\n- ')); process.exit(1); }
