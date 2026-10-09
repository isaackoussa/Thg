// Tests de robustesse de l'app : à lancer avec `npm test` (construit dist/ puis le teste dans Chromium).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

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
const TABS = ['synthese', 'saisie', 'dynamique', 'structure', 'renta', 'faillite', 'bale', 'import', 'params', 'methode', 'r'];

const FAKE_CR = { R1:[20000,21000,23000], R2:[8000,8200,9000], R3:[100,120,90], R4:[4822,4889,5570], R5:[500,520,600], R6:[200,-50,300], R7:[100,100,100], R8:[300,350,400], R9:[200,220,240], R10:[0,0,0], R11:[9000,9300,9800], R12:[1500,1600,1700], R13:[1200,900,2100], R14:[10,0,-20], R15:[400,500,600] };

const browser = await chromium.launch();

async function openApp({ storage, width = 400, dark = false, breakStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
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
    }
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log(`\n${pass} tests réussis, ${fail} en échec`);
if (fail) { console.log('\nÉchecs :\n- ' + failures.join('\n- ')); process.exit(1); }
