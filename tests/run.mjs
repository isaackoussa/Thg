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
  const f = DIST + (p === '/' ? 'index.html' : p === '/admin' ? 'admin.html' : p.slice(1));
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
  { const sw = readFileSync(DIST + 'sw.js', 'utf8'); ok(/url\.pathname\.startsWith\('\/api\/'\)\) return;/.test(sw) && sw.indexOf("startsWith('/api/')") < sw.indexOf('caches.match(req)'), 'service worker : les réponses du serveur (/api/) ne sont jamais mises en cache (verrous, comptes, console toujours à jour)'); }
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

  /* Fichiers réels : intitulés courants, chiffres sur plusieurs lignes, colonnes en trop, CSV virgules, dates, numérotation, unités */
  const variants = await page.evaluate(() => {
    const P = t => parseImport(t);
    return {
      synonymes: P(`Exercice 2022 2023
1. Caisse et banque centrale 1 000 2 000
2. Crédits à la clientèle 50 000 60 000
3. Prêts et créances sur les établissements de crédit 3 000 4 000
Dépôts de la clientèle 70 000 80 000
Dettes envers les établissements de crédit 5 000 6 000
Capital social 10 000 10 000
Produit net bancaire 9 000 9 500
Frais généraux 4 000 4 200
Impôt sur le résultat 300 400`),
      multiligne: P(`2021 2022 2023
CREANCES SUR LA CLIENTELE
131 072
130 602
150 766
DETTES A L'EGARD DE LA CLIENTELE
218 985
187 843
196 626`),
      colonnes: P(['Poste\t31/12/2022\t31/12/2023\tVariation\t%', 'Créances sur la clientèle\t130 602\t150 766\t20 164\t15,4 %', 'Dettes à l’égard de la clientèle\t187 843\t196 626\t8 783\t4,7 %'].join('\n')),
      csv: P(['Poste,2022,2023', 'Créances sur la clientèle,"130 602","150 766"', 'Capital social,28000,20563'].join('\n')),
      milliers: P(`Bilan au 31 décembre (en milliers de FCFA)
2022 2023
Créances sur la clientèle 130 602 000 150 766 000`),
      detail: P(`2022 2023
Dépôts de la clientèle 187 843 196 626
Dépôts à vue 100 000 110 000
Dépôts à terme 87 843 86 626`)
    };
  });
  const sv = variants.synonymes.vals;
  ok(JSON.stringify(variants.synonymes.years) === '[2022,2023]' && JSON.stringify(sv.A1) === '[1000,2000]' && JSON.stringify(sv.A4) === '[50000,60000]' && JSON.stringify(sv.A3) === '[3000,4000]', 'lecture : intitulés courants et lignes numérotées (actif)', sv);
  ok(JSON.stringify(sv.P3) === '[70000,80000]' && JSON.stringify(sv.P2) === '[5000,6000]' && JSON.stringify(sv.P9a) === '[10000,10000]', 'lecture : intitulés courants (passif)', [sv.P3, sv.P2, sv.P9a]);
  ok(JSON.stringify(sv.R11) === '[4000,4200]' && JSON.stringify(sv.R15) === '[300,400]' && JSON.stringify(variants.synonymes.chk.PNB) === '[9000,9500]', 'lecture : intitulés courants (compte de résultat)', [sv.R11, sv.R15, variants.synonymes.chk]);
  ok(JSON.stringify(variants.multiligne.vals.A4) === '[131072,130602,150766]' && JSON.stringify(variants.multiligne.vals.P3) === '[218985,187843,196626]' && variants.multiligne.unknown.length === 0, 'lecture : chiffres sur les lignes suivant l’intitulé (copie depuis un PDF)', variants.multiligne);
  ok(JSON.stringify(variants.colonnes.years) === '[2022,2023]' && JSON.stringify(variants.colonnes.vals.A4) === '[130602,150766]' && JSON.stringify(variants.colonnes.vals.P3) === '[187843,196626]', 'lecture : en-têtes de dates et colonnes en trop ignorées', variants.colonnes);
  ok(JSON.stringify(variants.csv.vals.A4) === '[130602,150766]' && JSON.stringify(variants.csv.vals.P9a) === '[28000,20563]', 'lecture : CSV séparé par des virgules', variants.csv.vals);
  ok(variants.milliers.unit === 'milliers' && JSON.stringify(variants.milliers.vals.A4) === '[130602000,150766000]', 'lecture : unité « milliers » détectée', variants.milliers);
  ok(JSON.stringify(variants.detail.vals.P3) === '[187843,196626]', 'lecture : lignes de détail n’écrasent pas le total', variants.detail.vals.P3);
  /* Intitulés coupés sur deux lignes (fascicule PDF) : pas de confusion avec un poste du bilan */
  const wrap = await page.evaluate(() => parseImport(`2021\t2022\t2023
IMMOBILISATIONS INCORPORELLES\t2\t59\t61
COMPTES DE RESULTAT
GAINS OU PERTES NETS SUR OPERATIONS DES
PORTEFEUILLES DE PLACEMENT ET ASSIMILES\t46\t509\t7
CHARGES GENERALES D'EXPLOITATION\t4 091\t4 849\t6 362
DOTATIONS AUX AMORTISSEMENTS ET AUX DEPRECIATIONS DES
IMMOBILISATIONS INCORPORELLES ET CORPORELLES\t225\t194\t221
GAINS OU PERTES NETS SUR ACTIFS
IMMOBILISES\t48\t0\t13`));
  ok(JSON.stringify(wrap.vals.A13) === '[2,59,61]' && JSON.stringify(wrap.vals.R12) === '[225,194,221]', 'lecture : intitulé des dotations coupé en deux, sans écraser les immobilisations', wrap.vals);
  ok(JSON.stringify(wrap.vals.R7) === '[46,509,7]' && JSON.stringify(wrap.vals.R14) === '[48,0,13]', 'lecture : autres intitulés coupés recollés', [wrap.vals.R7, wrap.vals.R14]);
  const crOnly = await page.evaluate(() => parseImport('COMPTE DE RESULTAT\n2022 2023\nIMMOBILISATIONS INCORPORELLES 5 6'));
  ok(!crOnly.vals.A13, 'lecture : dans le compte de résultat, une ligne ne remplit pas un poste du bilan', crOnly.vals);
  /* Cases vides = 0, jamais les montants de la ligne du dessous */
  const empt = await page.evaluate(() => [
    parseImport('ACTIF 2021 2022 2023\nCAISSE, BANQUE CENTRALE, CCP 100 200 300\nACTIONNAIRES OU ASSOCIES\nAUTRES ACTIFS 1 873 2 450 1 186\nPRETS SUBORDONNES - 248 258\nPARTS DANS LES ENTREPRISES LIEES - - -'),
    parseImport('Poste\t2021\t2022\t2023\nActionnaires ou associés\t\t\t\nAutres actifs\t1 873\t2 450\t1 186\nPrêts subordonnés\t\t248\t258\nImmobilisations incorporelles\t2\t\t61'),
    parseImport('code;libellé;2021;2022;2023\nA7;Actionnaires ou associés;;;\nA8;Autres actifs;1873;2450;1186\nA12;Prêts subordonnés;-;248;258'),
    parseImport('ACTIF 2021 2022 2023\nACTIONNAIRES OU ASSOCIES\nTOTAL DE L ACTIF 500 600 700\nPARTICIPATIONS ET AUTRES TITRES DETENUS A LONG TERME 178 178 178')
  ].map(r => ({ A7: r.vals.A7, A8: r.vals.A8, A11: r.vals.A11, A12: r.vals.A12, A13: r.vals.A13, A10: r.vals.A10 })));
  const J = x => JSON.stringify(x);
  ok(J(empt[0].A7) === '[0,0,0]' && J(empt[0].A8) === '[1873,2450,1186]', 'lecture : poste sans montant = 0, la ligne du dessous garde ses chiffres (texte de PDF)', empt[0]);
  ok(J(empt[0].A12) === '[0,248,258]' && J(empt[0].A11) === '[0,0,0]', 'lecture : tirets « - » = 0', empt[0]);
  ok(J(empt[1].A7) === '[0,0,0]' && J(empt[1].A8) === '[1873,2450,1186]' && J(empt[1].A12) === '[0,248,258]' && J(empt[1].A13) === '[2,0,61]', 'lecture : cases vides d’un tableau (Excel, Word, PDF) = 0', empt[1]);
  ok(J(empt[2].A7) === '[0,0,0]' && J(empt[2].A12) === '[0,248,258]', 'lecture : cases vides et tirets d’un CSV = 0', empt[2]);
  ok(J(empt[3].A7) === '[0,0,0]' && J(empt[3].A10) === '[178,178,178]', 'lecture : poste vide suivi d’un total, le total n’est pas pris', empt[3]);
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
  ok(/poste\(s\) non trouvé\(s\)/.test(await page.innerText('#impPreview')) && /Créances interbancaires/.test(await page.innerText('#impPreview')), 'import : postes manquants signalés dans l’aperçu');
  const before = await page.evaluate(() => [state.cur, JSON.stringify(bank().v), Object.keys(state.banks).length]);
  await page.fill('#impName', ''); await page.click('#impApplyNew');
  ok(await page.evaluate(n => Object.keys(state.banks).length === n, before[2]), 'import : nom vide refusé');
  await page.fill('#impName', 'BANQUE DE DAKAR'); await page.click('#impApplyNew');
  const after = await page.evaluate(() => [bank().name, bank().years, bank().v.A4, state.tab, state.history[0].label, state.history[0].kind]);
  ok(after[0] === 'BANQUE DE DAKAR' && JSON.stringify(after[1]) === '[2022,2023]' && JSON.stringify(after[2]) === '[5000,6000]' && after[3] === 'synthese', 'import : nouvelle analyse créée avec le nom saisi, ouverte sur la synthèse', after);
  ok(/^BANQUE DE DAKAR · 2022–2023$/.test(after[4]) && after[5] === 'import', 'import : l’historique porte le nom de la banque', after[4]);
  ok(await page.evaluate(b => JSON.stringify(state.banks[b[0]].v) === b[1], before), 'import : la banque précédente n’est pas modifiée');
  await page.click('[data-tab="import"]');
  await page.fill('#impText', 'Etats en milliers de FCFA\n2022 2023\nCrédits à la clientèle 130 602 000 150 766 000');
  await page.click('#impParse');
  ok(await page.inputValue('#impUnit') === 'milliers', 'import : unité « milliers » proposée');
  await page.fill('#impName', 'TEST MILLIERS'); await page.click('#impApplyNew');
  ok(JSON.stringify(await page.evaluate(() => bank().v.A4)) === '[130602,150766]', 'import : montants convertis en millions', await page.evaluate(() => bank().v.A4));
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
      // styles « essentiel » et « moderne » : mêmes résultats que l'app
      const more = await page.evaluate(() => ({ ess: rScriptEssentiel(), mod: rScriptModerne(), essIds: R_ESS_IDS }));
      writeFileSync(join(dir, 'ess.R'), more.ess); writeFileSync(join(dir, 'mod.R'), more.mod);
      writeFileSync(join(dir, 'check_ess.R'), `pdf(NULL)\ninvisible(capture.output(source("ess.R")))\nfor (id in c(${more.essIds.map(k => '"' + k + '"').join(',')})) cat(id, paste(ifelse(is.na(get(id)), "NA", sprintf("%.17g", get(id))), collapse = ";"), "\\n")\n`);
      writeFileSync(join(dir, 'check_mod.R'), `pdf(NULL)\nsuppressWarnings(suppressMessages(invisible(capture.output(source("mod.R")))))\nfor (id in c(${Object.keys(js).map(k => '"' + k + '"').join(',')})) cat(id, paste(ifelse(is.na(analyse[[id]]), "NA", sprintf("%.17g", analyse[[id]])), collapse = ";"), "\\n")\n`);
      for (const [st, file, ids] of [['essentiel', 'check_ess.R', more.essIds], ['moderne', 'check_mod.R', Object.keys(js)]]) {
        let o2 = '';
        try { o2 = execFileSync(rscript, [file], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LANG: 'C.UTF-8' } }); }
        catch (e) { ok(false, 'R ' + st + ' ' + label + ' (' + base + ') : le script s’exécute', String(e.stderr || e.message).slice(-400)); continue; }
        const mm = [];
        o2.trim().split('\n').forEach(line => {
          const [id, vals] = line.trim().split(' ');
          if (!ids.includes(id)) return;
          const rv = vals.split(';').map(x => x === 'NA' ? NaN : Number(x));
          js[id].forEach((v, i) => { const a = Number.isFinite(v) ? v : NaN, b2 = rv[i]; if (!((Number.isNaN(a) && !Number.isFinite(b2)) || (Number.isFinite(a) && Number.isFinite(b2) && Math.abs(a - b2) <= 1e-9 * Math.max(1, Math.abs(a))))) mm.push(id + '[' + i + '] app=' + a + ' R=' + b2); });
        });
        ok(mm.length === 0 && o2.trim().split('\n').length >= ids.length, 'R ' + st + ' ' + label + ' (' + base + ') : mêmes résultats que l’app', mm.slice(0, 5));
      }
      ok(!/[^\x00-\x7f]/.test(more.ess + more.mod), 'R essentiel et moderne ' + label + ' (' + base + ') : 100 % ASCII');
      if (base === 'fin' && label !== 'banque vide') {
        const gg = readdirSync(dir).find(f => f.startsWith('ggplot_'));
        ok(gg && readdirSync(join(dir, gg)).filter(f => f.endsWith('.png')).length === 4, 'R moderne ' + label + ' : 4 graphiques ggplot2 enregistrés', gg);
      }
      if (base === 'fin' && label === 'BAB + CR') {
        writeFileSync(join(dir, 'rapport.Rmd'), await page.evaluate(() => rMarkdown()));
        try {
          execFileSync(rscript, ['-e', 'rmarkdown::render("rapport.Rmd", output_format = "all", quiet = TRUE)'], { cwd: dir, stdio: 'pipe', env: { ...process.env, LANG: 'C.UTF-8' }, timeout: 180000 });
          const html = readFileSync(join(dir, 'rapport.html'), 'utf8');
          ok(existsSync(join(dir, 'rapport.docx')) && /10,66 %/.test(html) && /12,15 %/.test(html) && /Conforme/.test(html) && (html.match(/<img/g) || []).length >= 3, 'R Markdown : rendu Word et HTML avec chiffres et graphiques calculés par R');
        } catch (e) { ok(false, 'R Markdown : rendu', String(e.stderr || e.message).slice(-400)); }
      }
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
  ok(JSON.stringify(r.vals.A12) === '[238,0,258]', 'Excel : case vide = 0, à sa place', r.vals.A12);
  ok(JSON.stringify(r.vals.R1) === '[20000,21000,23000]' && JSON.stringify(r.vals.R2) === '[8000,8200,9000]', 'Excel : deuxième feuille lue', [r.vals.R1, r.vals.R2]);
  await page.click('#impApply');
  ok(await page.evaluate(() => raw('A12', 1) === 0 && raw('A12', 2) === 258 && raw('R1', 2) === 23000), 'Excel : case vide = 0 (ne garde pas une ancienne valeur ni celle d’une autre ligne)');
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

  // Cas réel : Société Générale Sénégal, pages 262-263 du fascicule BCEAO 2023 reproduites à l'identique
  {
    const fx = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
    const mk = await browser.newPage();
    await mk.setContent(fx('sgsn_p262.html').replace('</body>', '<div style="page-break-after:always"></div>' + fx('sgsn_p263.html').replace(/^[\s\S]*<body>/, '').replace('</body></html>', '') + '</body>'));
    const sgPdf = await mk.pdf({ format: 'A4' }); await mk.close();
    await upload('SGSN_2021-2023.pdf', 'application/pdf', sgPdf); await waitPreview();
    const prev = await page.innerText('#impPreview');
    ok(/50 poste\(s\) reconnu/.test(prev) && !/non trouvé/.test(prev), 'fascicule SGSN : 50 postes sur 50, aucun manquant', prev.slice(0, 200));
    ok(await page.inputValue('#impName') === 'SOCIETE GENERALE SENEGAL', 'fascicule SGSN : nom de la banque détecté');
    await page.click('#impApplyNew');
    const sg = await page.evaluate(() => ({ TA: Y().map((_, y) => qv('TA', y)), TP: Y().map((_, y) => qv('TP', y)), PNB: Y().map((_, y) => qv('PNB', y)), RN: Y().map((_, y) => qv('RNCR', y)), coef: series(I.coef), A13: bank().v.A13, R6: bank().v.R6, R7: bank().v.R7, R12: bank().v.R12, R13: bank().v.R13 }));
    ok(JSON.stringify(sg.TA) === '[1106364,1336404,1391105]' && JSON.stringify(sg.TP) === JSON.stringify(sg.TA), 'fascicule SGSN : totaux actif et passif identiques au fascicule', sg.TA);
    ok(JSON.stringify(sg.PNB) === '[71746,78444,93988]' && JSON.stringify(sg.RN) === '[18070,14902,23609]', 'fascicule SGSN : PNB et résultat net recalculés identiques au fascicule', [sg.PNB, sg.RN]);
    ok(JSON.stringify(sg.R6) === '[2985,4612,7770]' && JSON.stringify(sg.R7) === '[0,0,0]' && JSON.stringify(sg.R12) === '[3882,4044,4438]' && JSON.stringify(sg.A13) === '[5500,13647,19629]', 'fascicule SGSN : intitulés sur deux lignes bien rattachés', sg);
    ok(sg.coef.every(Number.isFinite) && Math.abs(sg.coef[2] - (50658 + 4438) / 93988) < 1e-12, 'fascicule SGSN : coefficient d’exploitation calculé', sg.coef);
    await page.click('[data-tab="import"]');
  }
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
  ok(/<w:tbl>.*?w:fill="0C5A48"/.test(full.doc) && /Appréciation globale/.test(full.txt || full.doc) && /Recommandations/.test(full.txt || full.doc) && /Glossaire/.test(full.txt || full.doc), 'rapport complet : couverture, note globale, recommandations et glossaire');
  // les autres modèles
  await page.evaluate(() => { const b0 = bank(); [['cmpA', 'Banque Test Sénégal', 1.3], ['cmpB', 'Petite Banque du Mali', 0.4]].forEach(([id, nm, k]) => { const nb = JSON.parse(JSON.stringify(b0)); Object.assign(nb, { id, name: nm, example: false }); Object.keys(nb.v).forEach(c => { nb.v[c] = nb.v[c].map(x => x == null ? x : x * k * (c === 'P9a' && k < 1 ? 0.3 : 1)); }); state.banks[id] = nb; }); });
  const gen = o => page.evaluate(async o => { try { const blob = await buildReport(o); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; u.forEach(c => s += String.fromCharCode(c)); return btoa(s); } catch (e) { return 'ERR ' + e.message; } }, o);
  for (const [type, theme, expect, minPages, maxPages] of [
    ['synthese', 'marine', ['NOTE DE SYNTHÈSE', 'L’essentiel en une page', 'Appréciation globale', 'Tableau de bord', 'Points forts', 'Recommandations', 'Figure 4', /295\s?660/], 2, 7],
    ['prudentiel', 'bordeaux', ['CONFORMITÉ PRUDENTIELLE', 'Verdict', 'Évolution des normes', 'Repères d’analyse', 'Fonds propres et marges de manœuvre', 'Excédent de solvabilité', 'Stress tests', 'Chute du PNB de 50 %', 'Défaut de 10 % des crédits', 'Résistance à la faillite', 'Conclusion'], 3, 12],
    ['corrige', 'anthracite', ['CORRIGÉ DE TD', 'Énoncé', 'Question 1', 'Question 9', 'Réponse', 'À retenir', 'Quel niveau de PNB provoquerait ces pertes', /ROE\s*=/, 'Conclusion générale'], 10, 40],
    ['comparaison', 'classique', ['COMPARAISON DE BANQUES', 'Classement général', 'Banque Test Sénégal', 'Petite Banque du Mali', 'Chiffres clés', 'Lecture ratio par ratio', /\d+\/100/], 3, 12]
  ]) {
    const r = await gen({ type, theme, title: '', author: 'Isaac', sections: [], banks: Object.keys(await page.evaluate(() => state.banks)), charts: true, comment: 'Avis de test.' });
    ok(!r.startsWith('ERR'), 'rapport ' + type + ' : généré sans erreur', r.slice(0, 200));
    if (r.startsWith('ERR')) continue;
    const res = await checkDocx(Buffer.from(r, 'base64'), 'rapport ' + type, expect.concat(['Avis de test.']));
    if (res.pages) ok(res.pages >= minPages && res.pages <= maxPages, 'rapport ' + type + ' : longueur adaptée (' + res.pages + ' pages)', res.pages);
    ok(/w:fill="(1F3B73|7A1E32|2E3A44|0C5A48)"/.test(res.doc) && res.doc.includes(type === 'synthese' ? '1F3B73' : type === 'prudentiel' ? '7A1E32' : type === 'corrige' ? '2E3A44' : '0C5A48'), 'rapport ' + type + ' : couleurs du thème choisi');
    if (type === 'synthese') ok(!/<m:oMathPara>/.test(res.doc), 'note de synthèse : sans formules');
    if (type === 'corrige') ok(!/Lecture compte par compte|Lecture année par année/.test(res.doc), 'corrigé : les explications détaillées restent propres à l’Option Isaac');
    if (type === 'corrige') ok((res.doc.match(/Application numérique 202[123]/g) || []).length >= 3 * 9, 'corrigé : application numérique pour chaque année', (res.doc.match(/Application numérique 202[123]/g) || []).length);
  }
  // styles de rédaction : quatre manières d'écrire, des tournures qui varient
  {
    const docText = async b64 => { const z = await JSZip.loadAsync(Buffer.from(b64, 'base64')); return (await z.file('word/document.xml').async('string')).replace(/<w:p[ >]/g, '\n$&').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); };
    const txt = {};
    for (const w of ['academique', 'professionnel', 'pedagogique', 'synthetique']) {
      const r = await gen({ type: 'complet', writing: w, sections: ['structure', 'renta', 'faillite', 'conclusion'], charts: false });
      ok(!r.startsWith('ERR'), 'rédaction ' + w + ' : rapport généré', r.slice(0, 200));
      if (!r.startsWith('ERR')) txt[w] = await docText(r);
    }
    const clean = t => !/undefined|NaN|\[object|\bde le (?!vier)|\bà le |\bde les /.test(t);
    ok(Object.values(txt).every(clean), 'rédaction : pas de « undefined », « NaN » ni de contraction oubliée', Object.entries(txt).filter(([, t]) => !clean(t)).map(([w, t]) => w + ' : ' + (t.match(/.{0,40}(undefined|NaN|\bde le (?!vier)|\bà le |\bde les ).{0,30}/) || [])[0]));
    const ac = txt.academique || '';
    const opens = ['Sur la période', 'Entre 20', 'L’examen de la période', 'Nous observons que'].filter(x => ac.includes(x));
    ok(opens.length === 4 && /Cette partie examine/.test(ac) && /Au terme de l’analyse/.test(ac), 'rédaction académique : quatre tournures d’ouverture qui alternent, introduction et conclusion rédigées', opens);
    ok(/s’établit à|ressort à|atteint/.test(txt.professionnel) && /Verdict : note [A-E]/.test(txt.professionnel) && !/Nous observons/.test(txt.professionnel), 'rédaction professionnelle : style note bancaire, verdict en conclusion');
    ok(/Ce que l’on observe\./.test(txt.pedagogique) && /Comment l’interpréter\./.test(txt.pedagogique) && /Par rapport au seuil\./.test(txt.pedagogique) && /Que retenir \?/.test(txt.pedagogique), 'rédaction pédagogique : observer, interpréter, comparer au seuil');
    ok(/Niveau 2023/.test(txt.synthetique) && /Évolution/.test(txt.synthetique) && /Seuil : ≤ 100,0 % → ✓ respecté \(\+23,32 pt\)/.test(txt.synthetique) && /Note globale : [A-E]/.test(txt.synthetique), 'rédaction synthétique : points clés en liste, marge positive sous un plafond');
    const auto = await docText(await gen({ type: 'corrige', writing: 'auto', charts: false }));
    ok(/Ce que l’on observe\./.test(auto), 'rédaction automatique : le corrigé de TD est pédagogique');
  }
  // options réservées : sans code d'accès, les dossiers multi-banques sont refusés
  ok((await gen({ type: 'recueil_td', banks: Object.keys(await page.evaluate(() => state.banks)), charts: false })).startsWith('ERR Option verrouillée'), 'options réservées : Option Isaac refusée sans code');
  await page.evaluate(() => { acct.acces = { app: true, options: true }; });
  // dossier multi-banques : vue d'ensemble comparée puis une partie par banque
  {
    const ids = Object.keys(await page.evaluate(() => state.banks));
    const before = await page.evaluate(() => [state.cur, state.yi]);
    const rs = await gen({ type: 'recueil', theme: 'classique', banks: ids, depth: 'synthese', charts: true, comment: 'Avis dossier.' });
    ok(!rs.startsWith('ERR'), 'dossier multi-banques : généré sans erreur', rs.slice(0, 200));
    let synthPages = 0, synthLen = 0;
    if (!rs.startsWith('ERR')) {
      const res = await checkDocx(Buffer.from(rs, 'base64'), 'dossier multi-banques', ['DOSSIER MULTI-BANQUES', 'Sommaire', 'Vue d’ensemble comparée', 'Classement général', 'Conclusion de la comparaison', 'Banque Atlantique', 'Banque Test Sénégal', 'Petite Banque du Mali', 'Tableau de bord', 'Méthodologie et glossaire', 'Avis dossier.']);
      const z = await JSZip.loadAsync(Buffer.from(rs, 'base64')), d = await z.file('word/document.xml').async('string');
      ok((d.match(/>Recommandations</g) || []).length === 3 && (d.match(/>Points forts</g) || []).length === 3, 'dossier multi-banques : points forts et recommandations pour chaque banque', (d.match(/>Recommandations</g) || []).length);
      ok(!/undefined|NaN|\[object/.test(d.replace(/<[^>]+>/g, '')), 'dossier multi-banques : pas de « undefined » ni « NaN »');
      synthPages = res.pages || 0; synthLen = d.length;
      if (synthPages) ok(synthPages >= 6 && synthPages <= 30, 'dossier multi-banques : longueur adaptée (' + synthPages + ' pages)', synthPages);
    }
    const rd = await gen({ type: 'recueil', banks: ids, depth: 'detaillee', charts: false });
    ok(!rd.startsWith('ERR'), 'dossier détaillé : généré sans erreur', rd.slice(0, 200));
    if (!rd.startsWith('ERR')) {
      const z = await JSZip.loadAsync(Buffer.from(rd, 'base64')), d = await z.file('word/document.xml').async('string');
      ok(d.length > synthLen && (d.match(/>Ratios détaillés</g) || []).length === 3 && (d.match(/Ratio de transformation/g) || []).length >= 3, 'dossier détaillé : tableaux et ratios expliqués pour chaque banque', d.length);
    }
    // dossier « questions du TD » : chaque question résolue pour chaque banque
    const rt = await gen({ type: 'recueil_td', banks: ids, charts: true });
    ok(!rt.startsWith('ERR'), 'dossier TD : généré sans erreur', rt.slice(0, 200));
    if (!rt.startsWith('ERR')) {
      if (process.env.DUMP_ISAAC) writeFileSync(process.env.DUMP_ISAAC, Buffer.from(rt, 'base64'));
      const res = await checkDocx(Buffer.from(rt, 'base64'), 'dossier TD', ['OPTION ISAAC', 'Sommaire', 'Table des illustrations', 'Énoncé', 'Banque Atlantique', 'Banque Test Sénégal', 'Petite Banque du Mali', 'EN UN COUP D’ŒIL', '1. Bilan et compte de résultat', '2. Transformation, liquidité, levier, solvabilité', '3. ROA et ROE', '4. Faillite et PNB critique', 'Verdict', 'Distance à la faillite', 'Comparaison des banques', 'Classement général', 'Tableau 1 –', 'Figure 1 –', 'Moteur ·', 'Seuil ·']);
      const z = await JSZip.loadAsync(Buffer.from(rt, 'base64')), d = await z.file('word/document.xml').async('string');
      const cnt = re => (d.match(re) || []).length, txt = d.replace(/<[^>]+>/g, '');
      const nFig = cnt(/SEQ Figure/g), nTab = cnt(/SEQ Tableau/g);
      ok(nFig >= 3 * 4 + 6 && nTab >= 3 * 6 + 3 && cnt(/<pic:pic/g) === nFig, 'Option Isaac : chaque graphique et chaque tableau a une légende numérotée', [nFig, nTab, cnt(/<pic:pic/g)]);
      ok(cnt(/w:pStyle w:val="Caption"/g) === nFig + nTab && /Montants en millions FCFA ; les colonnes Δ%/.test(txt) && /Le graphique compare, pour chaque exercice/.test(txt), 'Option Isaac : une description sous chaque légende');
      ok(/TOC \\o "1-2"/.test(d) && /TOC \\h \\z \\c "Figure"/.test(d) && /TOC \\h \\z \\c "Tableau"/.test(d) && cnt(/w:pStyle w:val="TOC1"/g) >= 5 && cnt(/w:pStyle w:val="TableofFigures"/g) === nFig + nTab && /updateFields w:val="true"/.test(await z.file('word/settings.xml').async('string')), 'Option Isaac : sommaire et table des illustrations automatiques (champs Word mis à jour à l’ouverture)');
      ok(txt.lastIndexOf('Verdict') < txt.lastIndexOf('Comparaison des banques') && txt.lastIndexOf('Classement général') > txt.lastIndexOf('Distance à la faillite'), 'Option Isaac : la comparaison des banques arrive à la fin du document');
      ok(/w:fill="1B2A4A"/.test(d) && /B8902F/.test(d), 'Option Isaac : identité visuelle propre (bleu nuit et or)');
      ok(['Ratio de transformation', 'Ratio de liquidité \\(bilan\\)', 'Ratio de levier \\(bilan\\)', 'Ratio de solvabilité global', 'ROA', 'ROE'].every(k => cnt(new RegExp('>' + k + '<', 'g')) >= 3) && /Créances clientèle \+15,0 %, dépôts clientèle −10,2 % : le numérateur l’emporte/.test(txt) && /plafond 100,00 % \(repère\) · respecté chaque année/.test(txt), 'Option Isaac : fiche verdict par ratio (évolution, moteur, portée, seuil)');
      ok(!/undefined|NaN|\[object/.test(txt), 'dossier TD : pas de « undefined » ni « NaN »');
      ok(!/Ce que l’on observe|Comment l’interpréter|Que retenir \?|Nous observons/.test(txt), 'Option Isaac : rédaction différente des autres modèles');
      ok(/Créances clientèle · 51 % du bilan/.test(txt) && /effet de ciseaux/.test(txt), 'Option Isaac : comptes principaux et coup d’œil');
      if (res.pages) ok(res.pages >= 25 && res.pages <= 70, 'dossier TD : longueur adaptée (' + res.pages + ' pages)', res.pages);
    }
    ok((await gen({ type: 'recueil_td', banks: [], charts: false })).startsWith('ERR Choisis au moins une banque'), 'dossier TD : une banque au moins');
    const one = await gen({ type: 'recueil', banks: [ids[1]], charts: false });
    if (!one.startsWith('ERR')) { const d = await (await JSZip.loadAsync(Buffer.from(one, 'base64'))).file('word/document.xml').async('string'); ok(!/Classement général/.test(d) && /Banque Test Sénégal/.test(d) && !/Petite Banque du Mali/.test(d), 'dossier multi-banques : une seule banque cochée, sans comparaison'); }
    else ok(false, 'dossier multi-banques : une seule banque', one.slice(0, 200));
    ok((await gen({ type: 'recueil', banks: ['a-inconnue'], charts: false })).startsWith('ERR Choisis au moins une banque'), 'dossier multi-banques : une banque au moins');
    ok(JSON.stringify(await page.evaluate(() => [state.cur, state.yi])) === JSON.stringify(before), 'dossier multi-banques : banque et exercice affichés inchangés après génération');
  }
  ok((await gen({ type: 'comparaison', banks: ['a-inconnue', Object.keys(await page.evaluate(() => state.banks))[0]], charts: false })).startsWith('ERR Choisis au moins deux banques'), 'comparaison : deux banques au moins');
  ok(await page.evaluate(() => { const b = bank(); const st = stressTests(Y().length - 1); return st.length === 7 && Math.abs(st[0].solva - val(nodeOf(I.solva), Y().length - 1)) < 1e-12 && st[2].solva < st[1].solva && st[6].solva < st[5].solva; }), 'stress tests : situation actuelle = ratio de solvabilité, chocs croissants');
  ok(await page.evaluate(() => { const s = scoreCard(Y().length - 1); return s.score >= 0 && s.score <= 100 && 'ABCDE'.includes(s.grade) && s.rows.length === SCORE_W.length; }), 'note globale : score entre 0 et 100 et lettre A à E');
  await page.evaluate(() => { delete state.banks.cmpA; delete state.banks.cmpB; });
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
  ok(await page.$$eval('[name="rtype"]', x => x.length) === 7 && !!(await page.$('[data-rsec]')), 'rapport : 7 modèles proposés, parties pour le rapport complet');
  await page.click('label[for="rt-comparaison"]');
  ok(!(await page.$('[data-rsec]')) && !!(await page.$('[data-rbank]')) && /Comparaison de banques UMOA/.test(await page.getAttribute('#rTitle', 'placeholder')), 'rapport : choix des banques pour la comparaison');
  await page.click('#rGo');
  ok(/deux banques/.test(await page.innerText('#rStatus')), 'rapport : comparaison avec une seule banque signalée');
  await page.evaluate(() => { acct.acces = null; renderAll(); });
  await page.click('label[for="rt-recueil"]');
  ok(!!(await page.$('#rLocked')) && !(await page.$('#rGo')) && /🔒/.test(await page.innerText('label[for="rt-recueil_td"]')) && !/🔒/.test(await page.innerText('label[for="rt-synthese"]')), 'rapport : options réservées marquées 🔒 et fermées sans code');
  await page.evaluate(() => { acct.acces = { app: true, options: true }; renderAll(); });
  await page.click('label[for="rt-recueil"]');
  ok(!!(await page.$('#rDepth')) && !!(await page.$('[data-rbank]')) && /Dossier de synthèse des banques/.test(await page.getAttribute('#rTitle', 'placeholder')), 'rapport : dossier multi-banques avec choix des banques et du niveau de détail');
  await page.selectOption('#rDepth', 'detaillee');
  await page.uncheck('[data-rbank]');
  await page.click('#rGo');
  ok(/au moins une banque/.test(await page.innerText('#rStatus')) && await page.evaluate(() => state.report.depth === 'detaillee'), 'rapport : dossier sans banque cochée signalé, niveau de détail mémorisé');
  await page.click('label[for="rt-recueil_td"]');
  ok(!(await page.$('#rDepth')) && !!(await page.$('[data-rbank]')) && /questions du TD/.test(await page.getAttribute('#rTitle', 'placeholder')), 'rapport : dossier questions du TD avec choix des banques');
  await page.click('label[for="rt-synthese"]');
  ok(/professionnel/.test(await page.$eval('#rWrite option[value="auto"]', o => o.textContent)) && await page.$$eval('#rWrite option', o => o.length) === 6, 'rapport : choix du style de rédaction (automatique selon le modèle, ou mon style)');
  await page.selectOption('#rWrite', 'pedagogique');
  await page.selectOption('#rTheme', 'marine');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#rGo')]);
  ok(/^Note_synthese_Banque_Atlantique_Benin_BAB_2021-2023\.docx$/.test(dl2.suggestedFilename()), 'rapport : note de synthèse téléchargée', dl2.suggestedFilename());
  ok(await page.evaluate(() => state.report.type === 'synthese' && state.report.theme === 'marine' && state.report.writing === 'pedagogique'), 'rapport : modèle, style et couleurs mémorisés');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'rapport : choix des modèles sans débordement sur téléphone');
  await page.click('label[for="rt-complet"]');
  await page.uncheck('#rCharts');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#rGo')]);
  ok(/^Analyse_Banque_Atlantique_Benin_BAB_2021-2023\.docx$/.test(dl.suggestedFilename()), 'rapport : téléchargement du fichier .docx', dl.suggestedFilename());
  ok(/Rapport prêt/.test(await page.innerText('#rStatus')), 'rapport : état affiché');
  ok(await page.evaluate(() => state.report && state.report.charts === false), 'rapport : options mémorisées');
  await page.evaluate(() => { document.querySelectorAll('[data-rsec]').forEach(c => { c.checked = false; }); });
  await page.click('#rGo');
  ok(/au moins une partie/.test(await page.innerText('#rStatus')), 'rapport : aucune partie cochée signalée');
  // onglet Code R : quatre styles
  await page.click('[data-tab="r"]');
  ok(await page.$$eval('[name="rstyle"]', x => x.length) === 4 && /dossier <- "graphiques_/.test(await page.innerText('#rOut')), 'code R : 4 styles, complet par défaut');
  for (const [st, re, file] of [['essentiel', /Verdict express/, /_essentiel\.R$/], ['moderne', /library\(ggplot2\)[\s\S]*mutate\(/, /_tidyverse\.R$/], ['rmd', /^---\noutput:|output:\n  word_document/m, /_rapport\.Rmd$/]]) {
    await page.click('label[for="rst-' + st + '"]');
    ok(re.test(await page.innerText('#rOut')), 'code R ' + st + ' : affiché');
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#rDl')]);
    ok(file.test(d.suggestedFilename()), 'code R ' + st + ' : fichier téléchargé', d.suggestedFilename());
  }
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'code R : pas de débordement sur téléphone');
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
  const memStore = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true }; }, async delete(k) { m.delete(k); }, async list(o = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(o.prefix || '')).map(key => ({ key })) }; } }; };
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
  const { handleCompte, userFromRequest, appBlocked } = await import('../server/compte.mjs');
  const { handleAdmin, adminList } = await import('../server/admin.mjs');
  const kv = () => { const m = new Map(); return { m,
    async get(k, o = {}) { if (!m.has(k)) return null; return o.type === 'json' ? JSON.parse(m.get(k)) : m.get(k); },
    async set(k, v, o = {}) { if (o.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, String(v)); return { modified: true }; },
    async setJSON(k, v, o = {}) { if (o.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, JSON.stringify(v)); return { modified: true }; },
    async delete(k) { m.delete(k); }, async list(o = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(o.prefix || '')).map(key => ({ key })) }; } }; };
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
    await ctx.route(/\/api\/(compte\/[a-z]+|historique|admin\/[a-z]+(\?.*)?)$/, async route => {
      const rq = route.request(), h = await rq.allHeaders();
      const req = new Request(rq.url(), { method: rq.method(), headers: { origin: h.origin || '', cookie: h.cookie || '', 'content-type': 'application/json' }, body: ['POST', 'PUT'].includes(rq.method()) ? rq.postData() || '' : undefined });
      const m = rq.url().match(/compte\/([a-z]+)$/), ma = rq.url().match(/admin\/([a-z]+)(\?|$)/);
      const res = m ? await handleCompte(req, m[1], { store: accStore }) : ma ? await handleAdmin(req, ma[1], { comptes: accStore, historiques: shared, adminEmails: 'admin@test.sn' }) : await handleHistorique(req, { getUser: () => userFromRequest(req, accStore), store: shared });
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
  ok(await A.page.waitForFunction(() => /Compte créé/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 }).then(() => true, () => false), 'compte : inscription et connexion immédiates, sans e-mail de vérification');
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
  await A.page.click('#accLogout');
  await A.page.waitForFunction(() => /Déconnecté/.test(document.querySelector('#accountCard').innerText));
  ok(await A.page.evaluate(() => state.history.length === 0), 'compte : déconnexion avec effacement de l’historique local');
  ok([...shared.m.values()].map(v => JSON.parse(v))[0].history.length > 0, 'compte : l’historique reste sur le compte après effacement local');
  ok(await A.page.evaluate(async () => (await fetch('/api/compte/moi')).status) === 401, 'compte : session fermée côté serveur après déconnexion');
  // inscription d'une adresse déjà prise
  await A.page.click('#accSwitch'); await A.page.fill('#accEmail', 'isaac@test.ci'); await A.page.fill('#accPw', 'encoreunautre'); await A.page.click('#accGo');
  await A.page.waitForSelector('#accStatus.err');
  ok(/existe déjà/.test(await A.page.innerText('#accStatus')), 'compte : adresse déjà inscrite signalée');
  // chaque compte ne voit que ses données : un autre compte sur le même appareil ne récupère rien du précédent
  await A.page.fill('#accEmail', 'voisin@test.ci'); await A.page.fill('#accPw', 'motdepasse9'); await A.page.click('#accGo');
  await A.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
  for (let i = 0; i < 30; i++) await A.page.waitForTimeout(100);
  const voisinDoc = [...shared.m.values()].map(v => JSON.parse(v)).find(d => d.email === 'voisin@test.ci') || { history: [], banks: {} };
  ok(await A.page.evaluate(() => !state.history.some(e => /Deuxième analyse|iPhone/.test(e.label)) && !Object.values(state.banks).some(b => b.name === 'CORIS BANK')), 'compte : un autre compte sur le même appareil ne voit pas l’historique ni les banques du précédent');
  ok(!JSON.stringify(voisinDoc).includes('Deuxième analyse') && !JSON.stringify(voisinDoc).includes('CORIS BANK'), 'compte : rien du compte précédent n’est envoyé sur le nouveau compte', Object.values(voisinDoc.banks || {}).map(b => b.name));
  ok([...shared.m.values()].map(v => JSON.parse(v)).find(d => d.email === 'isaac@test.ci').history.some(e => e.label === 'Deuxième analyse'), 'compte : les analyses restent sur le compte qui les a faites');
  await A.page.evaluate(() => { state.owner = 'isaac@test.ci'; state.history.push(...[]); });
  ok(await A.page.evaluate(() => { const before = state.history.length; adoptAccount('isaac@test.ci'); return state.owner === 'isaac@test.ci'; }), 'compte : propriétaire des données de l’appareil noté');
  ok(A.errors.length === 0 && B.errors.length === 0, 'compte : aucune erreur JavaScript', [...A.errors, ...B.errors].slice(0, 3));
  ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'compte : pas de débordement sur téléphone');
  await A.ctx.close(); await B.ctx.close();
  // ---------- Verrous : options réservées et app verrouillée ----------
  {
    const cs = kv(), hs = memStore();
    const po = (action, body, ck) => handleCompte(new Request('https://app.test/api/compte/' + action, { method: 'POST', headers: { origin: 'https://app.test', cookie: ck || '' }, body: JSON.stringify(body) }), action, { store: cs, adminEmails: 'chef@test.sn' });
    const moi = async ck => (await handleCompte(new Request('https://app.test/api/compte/moi', { headers: { cookie: ck } }), 'moi', { store: cs, adminEmails: 'chef@test.sn' })).json();
    const ckOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
    const KEY = 'Cle-Verrous-2026';
    const adK = async (action, body) => handleAdmin(new Request('https://app.test/api/admin/' + action, body === undefined ? { headers: { 'x-admin-key': KEY } } : { method: 'POST', headers: { origin: 'https://app.test', 'x-admin-key': KEY }, body: JSON.stringify(body) }), action, { comptes: cs, historiques: hs, adminEmails: 'chef@test.sn', adminKey: KEY });
    const u1 = ckOf(await po('inscription', { email: 'eleve@test.ci', password: 'motdepasse1' }));
    const u2 = ckOf(await po('inscription', { email: 'autre@test.sn', password: 'motdepasse2' }));
    const chef = ckOf(await po('inscription', { email: 'chef@test.sn', password: 'motdepasse3' }));
    let m = await moi(u1);
    ok(m.acces && m.acces.app === true && m.acces.options === false && m.verrous.options.actif === true && m.verrous.options.code === false, 'verrous : options réservées par défaut, app ouverte', m);
    ok((await moi(chef)).acces.options === true, 'verrous : l’administrateur n’est jamais bloqué');
    let r = await po('deverrouiller', { cible: 'options', code: 'XXXX' }, u1);
    ok(r.status === 403 && (await r.json()).code === 'no_code', 'verrous : sans code défini, déblocage impossible');
    ok((await adK('verrous', { options: { code: 'ab' } })).status === 400, 'verrous : code trop court refusé');
    let v = await (await adK('verrous', { options: { code: 'Isaac-2026' } })).json();
    ok(v.options.code === true && !JSON.stringify(v).includes('Isaac-2026') && !JSON.stringify(await cs.get('verrous')).includes('Isaac-2026'), 'verrous : code des options enregistré chiffré, jamais renvoyé');
    r = await po('deverrouiller', { cible: 'options', code: 'mauvais' }, u1);
    ok(r.status === 400 && /essai/.test((await r.json()).error), 'verrous : mauvais code refusé');
    ok((await po('deverrouiller', { cible: 'options', code: 'isaac-2026' })).status === 401, 'verrous : déblocage impossible sans être connecté');
    r = await po('deverrouiller', { cible: 'options', code: ' isaac-2026 ' }, u1);
    ok(r.status === 200 && (await r.json()).acces.options === true && (await moi(u1)).acces.options === true && (await moi(u2)).acces.options === false, 'verrous : bon code (majuscules et espaces ignorés), accès lié au seul compte qui l’a saisi');
    let cps = (await (await adK('comptes')).json()).comptes;
    ok(cps.find(c => c.email === 'eleve@test.ci').acces.options === true && cps.find(c => c.email === 'autre@test.sn').acces.options === false && (await (await adK('verrous')).json()).options.debloques === 1, 'verrous : la console voit qui a débloqué les options');
    await adK('acces', { email: 'autre@test.sn', options: true });
    ok((await moi(u2)).acces.options === true, 'verrous : l’admin ouvre les options à un compte sans code');
    await adK('verrous', { options: { code: 'Nouveau-code' } });
    ok((await moi(u1)).acces.options === false && (await moi(u2)).acces.options === false, 'verrous : un nouveau code retire les accès donnés avec l’ancien');
    await adK('verrous', { options: { actif: false } });
    ok((await moi(u2)).acces.options === true, 'verrous : options ouvertes à tous quand l’admin lève le verrou');
    await adK('verrous', { options: { actif: true } });
    for (let i = 0; i < 5; i++) await po('deverrouiller', { cible: 'options', code: 'faux' + i }, u2);
    r = await po('deverrouiller', { cible: 'options', code: 'Nouveau-code' }, u2);
    ok(r.status === 429, 'verrous : 5 mauvais codes puis attente de 15 minutes', r.status);
    // app verrouillée
    const cfg = async () => (await handleCompte(new Request('https://app.test/api/compte/config'), 'config', { store: cs })).json();
    ok((await cfg()).verrouApp === false && (await cfg()).gate === false, 'verrou app : ouverte par défaut');
    v = await (await adK('verrous', { app: { actif: true, message: 'Maintenance jusqu’à 18 h' } })).json();
    ok(v.app.actif && (await cfg()).gate === true && (await cfg()).verrouApp === true, 'verrou app : l’entrée par e-mail devient obligatoire');
    m = await moi(u1);
    ok(m.acces.app === false && m.verrous.app.message === 'Maintenance jusqu’à 18 h' && m.verrous.app.code === false && (await moi(chef)).acces.app === true, 'verrou app : comptes bloqués avec le message, administrateur épargné');
    const put = ck => handleHistorique(new Request('https://app.test/api/historique', { method: 'PUT', headers: { origin: 'https://app.test', cookie: ck }, body: JSON.stringify({ history: [] }) }), { getUser: () => userFromRequest(new Request('https://app.test/', { headers: { cookie: ck } }), cs), store: hs, blocked: u => appBlocked(cs, u, 'chef@test.sn') });
    ok((await put(u1)).status === 423 && (await put(chef)).status === 200, 'verrou app : synchronisation refusée côté serveur tant que le compte est bloqué');
    ok((await po('deverrouiller', { cible: 'app', code: 'quelquechose' }, u1)).status === 403, 'verrou app : sans code, personne n’entre');
    await adK('verrous', { app: { code: 'Entree-2026' } });
    ok((await po('deverrouiller', { cible: 'app', code: 'Entree-2026' }, u1)).status === 200 && (await moi(u1)).acces.app === true && (await put(u1)).status === 200, 'verrou app : le code fait entrer le compte');
    await adK('verrous', { app: { actif: false } });
    await adK('verrous', { app: { actif: true } });
    ok((await moi(u1)).acces.app === false, 'verrou app : un nouveau verrouillage oblige à ressaisir le code');
    await adK('verrous', { app: { actif: false } });
    ok((await moi(u1)).acces.app === true && (await moi(u2)).acces.app === true && (await put(u1)).status === 200, 'verrou app : déverrouillée, tout le monde rentre');
    ok((await handleAdmin(new Request('https://app.test/api/admin/verrous', { method: 'POST', headers: { origin: 'https://app.test', cookie: u1 }, body: '{"app":{"actif":true}}' }), 'verrous', { comptes: cs, historiques: hs, adminEmails: 'chef@test.sn', adminKey: KEY })).status === 401, 'verrous : seul l’admin peut verrouiller');
  }
  // ---------- Admin : serveur ----------
  {
    const cs = kv(), hs = memStore();
    const po = (action, body, ck) => handleCompte(new Request('https://app.test/api/compte/' + action, { method: 'POST', headers: { origin: 'https://app.test', cookie: ck || '' }, body: JSON.stringify(body) }), action, { store: cs });
    const ckOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
    const adm = ckOf(await po('inscription', { email: 'Admin@Test.sn', password: 'motdepasseadmin' }));
    const usr = ckOf(await po('inscription', { email: 'eleve@test.ci', password: 'motdepasse1' }));
    await handleHistorique(new Request('https://app.test/api/historique', { method: 'PUT', headers: { origin: 'https://app.test', cookie: usr }, body: JSON.stringify({ history: [{ id: 'h1', at: new Date().toISOString(), kind: 'manuel', label: 'BANQUE DE DAKAR · 2023', bank: { name: 'BANQUE DE DAKAR', years: [2023], v: {} }, res: { years: [2023], vals: { roe: [0.12] } } }], banks: { b1: { name: 'BANQUE DE DAKAR', years: [2023], v: { A4: [5] }, mod: 1 } } }) }), { getUser: () => userFromRequest(new Request('https://app.test/', { headers: { cookie: usr } }), cs), store: hs });
    const ad = (action, ck, body, q = '') => handleAdmin(new Request('https://app.test/api/admin/' + action + q, body === undefined ? { headers: { cookie: ck || '' } } : { method: 'POST', headers: { origin: 'https://app.test', cookie: ck || '' }, body: JSON.stringify(body) }), action, { comptes: cs, historiques: hs, adminEmails: 'admin@test.sn' });
    ok(JSON.stringify(adminList(undefined)) === '["koussaisaac199@gmail.com"]' && JSON.stringify(adminList(' A@x.sn , b@y.ci ')) === '["a@x.sn","b@y.ci"]', 'admin : administrateur par défaut et liste réglable');
    ok((await ad('moi', '')).status === 401 && (await ad('moi', usr)).status === 403 && (await ad('comptes', usr)).status === 403, 'admin : refusé sans connexion et aux comptes ordinaires');
    ok((await ad('moi', adm)).status === 200, 'admin : reconnu pour l’adresse administrateur (majuscules ignorées)');
    const st = await (await ad('stats', adm)).json();
    ok(st.comptes === 2 && st.banques === 1 && st.analyses === 1 && st.actifs7 === 2 && st.topBanques[0].nom === 'BANQUE DE DAKAR' && st.parJour.length === 30 && st.parJour[29].analyses === 1, 'admin : statistiques', st);
    const cp = (await (await ad('comptes', adm)).json()).comptes;
    const el = cp.find(c => c.email === 'eleve@test.ci');
    ok(cp.length === 2 && el.banks === 1 && el.analyses === 1 && el.lastLogin && !('hash' in el) && !('salt' in el), 'admin : liste des comptes sans mot de passe', cp);
    const det = await (await ad('analyses', adm, undefined, '?id=' + el.id)).json();
    ok(det.email === 'eleve@test.ci' && det.banks.b1.name === 'BANQUE DE DAKAR' && det.history.length === 1, 'admin : consultation des analyses d’un utilisateur', det);
    {
      const { parseDevice, recordDevice } = await import('../server/compte.mjs');
      const ip = parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
      const an = parseDevice('Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36');
      const an2 = parseDevice('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', 'Pixel 7');
      const pc = parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0');
      const mac = parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15');
      ok(ip.label === 'iPhone · iOS 17.5 · Safari' && ip.type === 'Téléphone' && an.label === 'SM-A515F · Android 13 · Chrome' && an2.label === 'Pixel 7 · Android 10 · Chrome' && pc.label === 'Windows · Edge' && pc.type === 'Ordinateur' && mac.label === 'Mac · macOS · Safari', 'appareils : reconnaissance du téléphone, du système et du navigateur', [ip.label, an.label, an2.label, pc.label, mac.label]);
      const u = {}, rq = ua => new Request('https://app.test/', { headers: { 'user-agent': ua } }), geo = { city: 'Dakar', country: { code: 'SN', name: 'Senegal' } };
      const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
      recordDevice(u, rq(UA), geo, 'connexion', 1e12);
      const again = recordDevice(u, rq(UA), geo, 'visite', 1e12 + 60e3);
      recordDevice(u, rq('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36'), null, 'echec', 1e12 + 120e3);
      recordDevice(u, rq(UA), geo, 'visite', 1e12 + 2 * 3600e3);
      ok(again === false && u.devices.length === 1 && u.devices[0].count === 2 && u.devices[0].lieu === 'Dakar, Senegal' && u.journal.length === 3 && u.journal[1].event === 'echec' && !('ip' in u.devices[0]) && !('ip' in u.journal[0]), 'appareils : un appareil par téléphone, visites espacées, échecs notés, sans IP', u);
    }
    const cp0 = (await (await ad('comptes', adm)).json()).comptes.find(c => c.email === 'eleve@test.ci');
    ok(cp0.device && cp0.nDevices === 1, 'admin : dernier appareil dans la liste des comptes', cp0);
    ok((await ad('motdepasse', adm, { email: 'eleve@test.ci', password: 'court' })).status === 400, 'admin : nouveau mot de passe trop court refusé');
    ok((await ad('motdepasse', adm, { email: 'eleve@test.ci', password: 'nouveaumdp1' })).status === 200, 'admin : nouveau mot de passe enregistré');
    ok(await userFromRequest(new Request('https://app.test/', { headers: { cookie: usr } }), cs) === null, 'admin : l’ancienne session de l’utilisateur est fermée');
    ok((await po('connexion', { email: 'eleve@test.ci', password: 'motdepasse1' })).status === 401 && (await po('connexion', { email: 'eleve@test.ci', password: 'nouveaumdp1' })).status === 200, 'admin : l’utilisateur se connecte avec le nouveau mot de passe');
    for (let i = 0; i < 5; i++) await po('connexion', { email: 'eleve@test.ci', password: 'faux' + i });
    ok((await (await ad('comptes', adm)).json()).comptes.find(c => c.email === 'eleve@test.ci').locked, 'admin : compte bloqué visible');
    await ad('debloquer', adm, { email: 'eleve@test.ci' });
    ok((await po('connexion', { email: 'eleve@test.ci', password: 'nouveaumdp1' })).status === 200, 'admin : déblocage');
    // compte enregistré sous une clé qui ne correspond pas à son adresse (ancien format, adresse modifiée…) : retrouvé par son identifiant
    await cs.setJSON('u/ancienne-cle-123', { id: 'id-ancien', email: 'fabrice@test.ci', salt: 'abc', hash: '', createdAt: '2026-10-15T10:00:00Z' });
    await hs.setJSON('u/id-ancien', { history: [], banks: {} });
    ok((await ad('supprimer', adm, { email: 'fabrice@test.ci', id: 'id-ancien' })).status === 200 && !cs.m.has('u/ancienne-cle-123') && !hs.m.has('u/id-ancien'), 'admin : suppression d’un compte retrouvé par son identifiant (« Compte introuvable » corrigé)');
    await cs.setJSON('u/autre-cle-456', { id: 'id-autre', email: 'autre@test.ci', salt: 'abc', hash: '' });
    ok((await ad('supprimer', adm, { email: 'autre@test.ci' })).status === 200 && !cs.m.has('u/autre-cle-456'), 'admin : suppression retrouvée par l’adresse dans la liste des comptes');
    ok((await (await ad('supprimer', adm, { email: 'disparu@test.ci', id: 'id-disparu' })).json()).deja === true, 'admin : compte déjà supprimé, pas d’erreur');
    {
      const adR = (action, ck, codeRequired) => handleAdmin(new Request('https://app.test/api/admin/' + action, { headers: { cookie: ck || '' } }), action, { comptes: cs, historiques: hs, adminEmails: 'admin@test.sn', codeRequired });
      const rr = await adR('comptes', adm, true);
      ok(rr.status === 403 && (await rr.json()).code === 'verify', 'sécurité : avec les codes e-mail, une session ouverte par mot de passe n’ouvre pas la console');
      ok([401, 403].includes((await adR('comptes', usr, true)).status) && (await adR('comptes', '', true)).status === 401, 'sécurité : console refusée aux comptes ordinaires et sans connexion');
    }
    {
      const adK = (action, key, method = 'GET', body) => handleAdmin(new Request('https://app.test/api/admin/' + action, method === 'GET' ? { headers: key ? { 'x-admin-key': key } : {} } : { method, headers: { origin: 'https://app.test', 'x-admin-key': key }, body: JSON.stringify(body) }), action, { comptes: cs, historiques: hs, adminEmails: 'admin@test.sn', adminKey: 'K3y-tres-secrete' });
      ok((await adK('comptes', '')).status === 401 && (await adK('comptes', 'mauvaise')).status === 401, 'clé admin : sans clé ou mauvaise clé, refusé');
      const withAdminSession = await handleAdmin(new Request('https://app.test/api/admin/comptes', { headers: { cookie: adm } }), 'comptes', { comptes: cs, historiques: hs, adminEmails: 'admin@test.sn', adminKey: 'K3y-tres-secrete' });
      ok(withAdminSession.status === 401, 'clé admin : le compte administrateur seul ne suffit plus, il faut la clé');
      const okr = await adK('moi', 'K3y-tres-secrete'); const okd = await okr.json();
      ok(okr.status === 200 && okd.mode === 'cle' && okd.admins[0] === 'admin@test.sn', 'clé admin : bonne clé acceptée', okd);
      for (let i = 0; i < 8; i++) await adK('comptes', 'essai' + i);
      ok((await adK('comptes', 'K3y-tres-secrete')).status === 429, 'clé admin : console bloquée 15 minutes après 8 mauvaises clés');
      await cs.setJSON('admin-echecs', { n: 0, until: 0 });
      ok((await adK('supprimer', 'K3y-tres-secrete', 'POST', { email: 'admin@test.sn' })).status === 400, 'clé admin : le compte administrateur ne peut pas être supprimé');
    }
    ok((await ad('supprimer', adm, { email: 'admin@test.sn' })).status === 400, 'admin : impossible de supprimer son propre compte');
    ok((await handleAdmin(new Request('https://app.test/api/admin/supprimer', { method: 'POST', headers: { origin: 'https://pirate.test', cookie: adm }, body: JSON.stringify({ email: 'eleve@test.ci' }) }), 'supprimer', { comptes: cs, historiques: hs, adminEmails: 'admin@test.sn' })).status === 403, 'admin : action venant d’un autre site refusée');
    ok((await ad('supprimer', adm, { email: 'eleve@test.ci' })).status === 200 && (await (await ad('comptes', adm)).json()).comptes.length === 1 && !hs.m.has('u/' + el.id), 'admin : suppression du compte et de ses données');
    ok((await po('connexion', { email: 'eleve@test.ci', password: 'nouveaumdp1' })).status === 401, 'admin : un compte supprimé ne peut plus se connecter');
  }
  // ---------- Admin : dans le navigateur ----------
  {
    const Ad = await device(), Us = await device();
    await Us.page.click('[data-tab="historique"]'); await Us.page.click('#accSwitch');
    await Us.page.fill('#accEmail', 'eleve2@test.ci'); await Us.page.fill('#accPw', 'motdepasse1'); await Us.page.click('#accGo');
    await Us.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
    ok(!(await Us.page.$('[data-tab="admin"]')), 'admin : onglet absent pour un utilisateur ordinaire');
    await Us.page.fill('#hLabel', 'Analyse élève'); await Us.page.click('#hSave');
    for (let i = 0; i < 100 && ![...shared.m.values()].some(v => v.includes('Analyse élève')); i++) await Us.page.waitForTimeout(100);
    await Ad.page.click('[data-tab="historique"]'); await Ad.page.click('#accSwitch');
    await Ad.page.fill('#accEmail', 'admin@test.sn'); await Ad.page.fill('#accPw', 'motdepasseadmin'); await Ad.page.click('#accGo');
    await Ad.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
    ok(await Ad.page.evaluate(() => !document.querySelector('[data-tab="admin"], [data-atab], .tab-admin') && typeof vAdmin === 'undefined' && typeof adminApi === 'undefined' && !/Console/.test(document.querySelector('#tabs').innerText)), 'admin : l’app ne contient ni bouton ni code de console (séparée)');
    await Ad.page.goto(BASE + 'admin'); await Ad.page.waitForSelector('#main .section-head', { timeout: 15000 });
    await Ad.page.waitForFunction(() => /En ligne maintenant/.test(document.querySelector('#adminBox')?.innerText || ''), null, { timeout: 15000 });
    ok(await Ad.page.evaluate(() => !!document.querySelector('[data-atab="comptes"]') && !document.querySelector('[data-tab]') && typeof bank === 'undefined' && typeof buildReport === 'undefined' && /Console d’administration/.test(document.title)), 'admin : console sur une page à part (aucun code ni onglet de l’app)');
    await Ad.page.click('[data-atab="tableau"]');
    await Ad.page.waitForFunction(() => /Activité des 30 derniers jours/.test(document.querySelector('#adminBox')?.innerText || ''), null, { timeout: 15000 });
    const tb = await Ad.page.innerText('#adminBox');
    ok(/Banques les plus analysées/.test(tb) && /Heures d’affluence/.test(tb) && /Actions dans l’app par jour/.test(tb), 'admin : tableau de bord affiché', tb.slice(0, 300));
    await Ad.page.click('[data-atab="comptes"]');
    await Ad.page.waitForFunction(() => /Comptes \(\d+\)/.test(document.querySelector('#adminBox')?.innerText || ''), null, { timeout: 15000 });
    const txt = await Ad.page.innerText('#adminBox');
    ok(/eleve2@test\.ci/.test(txt), 'admin : liste des comptes', txt.slice(0, 300));
    const uid = await Ad.page.evaluate(() => adm.comptes.find(c => c.email === 'eleve2@test.ci').id);
    await Ad.page.click('[data-av="' + uid + '"]');
    await Ad.page.waitForFunction(() => /Compte eleve2/.test(document.querySelector('#admDetail').innerText));
    const dtx = await Ad.page.innerText('#admDetail');
    ok(/Appareils \(1\)/i.test(dtx) && /Connexions récentes/i.test(dtx) && /Inscription/.test(dtx), 'admin : appareils et connexions de l’utilisateur affichés', dtx.slice(0, 400));
    ok(/dernière connexion/.test(await Ad.page.innerText('.acc')) && /💻|📱|📲|Aucun appareil/.test(await Ad.page.innerText('.acc')), 'admin : dernier appareil et dernière connexion sur chaque compte');
    ok(/Analyse élève/.test(await Ad.page.innerText('#admDetail')), 'admin : analyses de l’utilisateur consultées');
    const [dlb] = await Promise.all([Ad.page.waitForEvent('download', { timeout: 15000 }), Ad.page.click('[data-acopy]')]);
    ok(/\.json$/.test(dlb.suggestedFilename()), 'admin : données d’une banque d’utilisateur téléchargeables (.json)', dlb.suggestedFilename());
    await Ad.page.waitForFunction(() => /Comptes \(\d+\)/.test(document.querySelector('#adminBox')?.innerText || ''), null, { timeout: 15000 });
    await Ad.page.click('[data-apw="eleve2@test.ci"]'); await Ad.page.click('#admPwGen');
    const newPw = await Ad.page.inputValue('#admPw');
    await Ad.page.click('#admPwOk');
    await Ad.page.waitForFunction(() => /Mot de passe changé/.test(document.querySelector('#admAction').innerText));
    ok(newPw.length === 10, 'admin : mot de passe généré et enregistré');
    ok(await Ad.page.evaluate(() => { const b = document.querySelector('[data-adel="eleve2@test.ci"]').getBoundingClientRect(); return b.right <= window.innerWidth && b.left >= 0; }), 'admin : bouton Supprimer visible sans faire défiler (téléphone)');
    await Ad.page.click('[data-adel="eleve2@test.ci"]'); await Ad.page.click('#admDelNo');
    ok(await Ad.page.evaluate(() => adm.comptes.some(c => c.email === 'eleve2@test.ci') && !document.querySelector('#admDelOk')), 'admin : suppression annulée');
    await Ad.page.click('[data-adel="eleve2@test.ci"]');
    ok(await Ad.page.evaluate(() => { const b = document.querySelector('#admDelOk').getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; }), 'admin : confirmation affichée à l’écran, sous le compte');
    await Ad.page.click('#admDelOk');
    await Ad.page.waitForFunction(() => adm.comptes && !adm.comptes.some(c => c.email === 'eleve2@test.ci'), null, { timeout: 15000 });
    ok(true, 'admin : compte supprimé depuis le tableau de bord');
    ok(await Ad.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'admin : pas de débordement sur téléphone');
    ok(await Ad.page.getAttribute('.aact a', 'href') === '/' && await Ad.page.evaluate(() => { const r = document.querySelector('#admLogout').getBoundingClientRect(); return r.right <= window.innerWidth && r.top >= 0; }), 'admin : « Ouvrir l’app » et « Se déconnecter » visibles dans l’en-tête (téléphone)');
    await Ad.page.goto(BASE); await Ad.page.waitForSelector('#view .section-head');
    await Ad.page.click('[data-tab="historique"]'); await Ad.page.click('#accLogout');
    await Ad.page.waitForFunction(() => !document.querySelector('[data-tab="admin"]'), null, { timeout: 15000 });
    ok(true, 'admin : onglet retiré à la déconnexion');
    ok(Ad.errors.length === 0 && Us.errors.length === 0, 'admin : aucune erreur JavaScript', [...Ad.errors, ...Us.errors].slice(0, 3));
    await Ad.ctx.close(); await Us.ctx.close();
  }
  // ---------- Lien direct /admin ----------
  {
    const D = await device();
    await D.page.goto(BASE + 'admin'); await D.page.waitForSelector('#agKey:visible', { timeout: 15000 });
    ok(/Console d’administration/.test(await D.page.innerText('#adminGate')) && !(await D.page.isVisible('#adminApp')), 'lien /admin : écran d’entrée de la console, rien d’autre');
    ok(D.errors.length === 0, 'lien /admin : aucune erreur JavaScript', D.errors);
    await D.ctx.close();
    const U = await device();
    await U.page.click('[data-tab="historique"]');
    await U.page.fill('#accEmail', 'isaac@test.ci'); await U.page.fill('#accPw', 'motdepasse1'); await U.page.click('#accGo');
    await U.page.waitForFunction(() => /Connecté avec/.test(document.querySelector('#accountCard').innerText), null, { timeout: 15000 });
    await U.page.goto(BASE + 'admin'); await U.page.waitForSelector('#agKey:visible', { timeout: 15000 });
    await U.page.waitForTimeout(300);
    ok(!(await U.page.isVisible('#adminApp')) && /administrateur/.test(await U.page.innerText('#agErr')), 'lien /admin : compte ordinaire refusé, aucune donnée affichée', await U.page.innerText('#agErr'));
    await U.ctx.close();
  }
  // ---------- Entrée de l'app par e-mail : code à 6 chiffres (comme Anglais 365) ----------
  {
    const cs = kv(), sent = [];
    const send = async (to, subject, html, code) => { sent.push({ to, subject, html, code }); return true; };
    const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
    const po = (action, body, deps = {}) => handleCompte(new Request('https://app.test/api/compte/' + action, { method: 'POST', headers: { origin: 'https://app.test', 'user-agent': UA }, body: JSON.stringify(body) }), action, { store: cs, send, ...deps });
    const cfg = async deps => (await handleCompte(new Request('https://app.test/api/compte/config'), 'config', { store: cs, ...deps })).json();
    ok(JSON.stringify(await cfg({})) === '{"gate":false,"mail":false,"verrouApp":false}' && JSON.stringify(await cfg({ gate: true, env: k => ({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.sn' })[k] })) === '{"gate":true,"mail":true,"verrouApp":false}', 'entrée : configuration (accès, envoi des codes)');
    ok((await handleCompte(new Request('https://app.test/api/compte/code', { method: 'POST', headers: { origin: 'https://app.test' }, body: '{"email":"a@b.sn"}' }), 'code', { store: cs })).status === 503, 'entrée : sans Brevo configuré, code refusé clairement');
    let r = await po('code', { email: ' Nouveau@Test.SN ' });
    ok(r.status === 200 && sent.length === 1 && sent[0].to === 'nouveau@test.sn' && /^\d{6}$/.test(sent[0].code) && sent[0].subject.startsWith(sent[0].code) && sent[0].html.includes(sent[0].code), 'entrée : code à 6 chiffres envoyé par e-mail');
    ok(![...cs.m.values()].some(v => v.includes('"' + sent[0].code + '"')), 'entrée : le code n’est jamais stocké en clair');
    ok((await po('code', { email: 'nouveau@test.sn' })).status === 429, 'entrée : renvoi bloqué pendant 30 secondes');
    r = await po('verifier', { email: 'nouveau@test.sn', code: sent[0].code === '000000' ? '111111' : '000000' }); let d = await r.json();
    ok(r.status === 400 && d.remaining === 4 && /4 essais restants/.test(d.error), 'entrée : mauvais code signalé avec les essais restants', d);
    r = await po('verifier', { email: 'NOUVEAU@test.sn', code: sent[0].code }); d = await r.json();
    const ckc = (r.headers.get('set-cookie') || '').split(';')[0];
    ok(r.status === 201 && d.isNew && /Max-Age=31536000/.test(r.headers.get('set-cookie')), 'entrée : bon code, compte créé, connecté pour un an', [r.status, r.headers.get('set-cookie')]);
    const u = JSON.parse([...cs.m.entries()].find(([k, v]) => k.startsWith('u/') && v.includes('nouveau@test.sn'))[1]);
    ok(u.hash === '' && u.via === 'code' && u.devices.length === 1 && u.journal[0].event === 'inscription', 'entrée : compte sans mot de passe, appareil noté', u);
    ok((await userFromRequest(new Request('https://app.test/', { headers: { cookie: ckc } }), cs)).email === 'nouveau@test.sn', 'entrée : session reconnue');
    ok((await po('verifier', { email: 'nouveau@test.sn', code: sent[0].code })).status === 400, 'entrée : un code ne sert qu’une fois');
    r = await po('connexion', { email: 'nouveau@test.sn', password: 'nimportequoi' }); d = await r.json();
    ok(r.status === 400 && d.code === 'use_code', 'entrée : compte sans mot de passe, connexion par mot de passe refusée sans plantage', d);
    // essais épuisés, code expiré
    cs.m.delete([...cs.m.keys()].find(k => k.startsWith('c/')));
    await po('code', { email: 'autre@test.ci' });
    for (let i = 0; i < 4; i++) await po('verifier', { email: 'autre@test.ci', code: '99999' + i === sent[1].code ? '888888' : '99999' + i });
    r = await po('verifier', { email: 'autre@test.ci', code: '777777' === sent[1].code ? '666666' : '777777' }); d = await r.json();
    ok(/Trop d’essais/.test(d.error) && (await po('verifier', { email: 'autre@test.ci', code: sent[1].code })).status === 400, 'entrée : après 5 mauvais codes, le code est annulé', d);
    const k = [...cs.m.keys()].find(x => x.startsWith('c/')); ok(!k, 'entrée : code annulé supprimé');
    await new Promise(res => setTimeout(res, 10));
    cs.m.forEach((v, kk) => { if (kk.startsWith('c/')) cs.m.delete(kk); });
    await po('code', { email: 'expire@test.ci' });
    const ck2 = [...cs.m.keys()].find(x => x.startsWith('c/')); const rec = JSON.parse(cs.m.get(ck2)); rec.expiresAt = Date.now() - 1; cs.m.set(ck2, JSON.stringify(rec));
    r = await po('verifier', { email: 'expire@test.ci', code: sent[2].code }); d = await r.json();
    ok(r.status === 400 && /expiré/.test(d.error), 'entrée : code expiré refusé', d);
    ok((await po('code', { email: 'x@y.sn' }, { send: async () => false })).status === 502, 'entrée : échec d’envoi signalé');
    // inscription par mot de passe fermée quand les codes fonctionnent (sinon on pourrait prendre l'adresse d'un autre)
    r = await po('inscription', { email: 'koussaisaac199@gmail.com', password: 'motdepasse1' });
    ok(r.status === 403 && (await r.json()).code === 'use_code' && ![...cs.m.keys()].some(k => k === 'u/' + require('crypto').createHash('sha256').update('koussaisaac199@gmail.com').digest('hex')), 'sécurité : impossible de créer un compte au nom d’une autre adresse (inscription par mot de passe fermée)');
    // compte existant (mot de passe, créé avant les codes) : le code connecte au même compte
    await handleCompte(new Request('https://app.test/api/compte/inscription', { method: 'POST', headers: { origin: 'https://app.test' }, body: JSON.stringify({ email: 'ancien@test.sn', password: 'motdepasse1' }) }), 'inscription', { store: cs });
    const before = [...cs.m.keys()].filter(x => x.startsWith('u/')).length;
    await po('code', { email: 'ancien@test.sn' });
    r = await po('verifier', { email: 'ancien@test.sn', code: sent[sent.length - 1].code }); d = await r.json();
    ok(r.status === 200 && !d.isNew && [...cs.m.keys()].filter(x => x.startsWith('u/')).length === before && (await po('connexion', { email: 'ancien@test.sn', password: 'motdepasse1' })).status === 200, 'entrée : un compte avec mot de passe peut aussi entrer par code');
  }
  // ---------- Entrée de l'app dans le navigateur ----------
  {
    const gs = kv(), gh = memStore(), mails = [];
    const gateDevice = async ({ mail = true, storageInit } = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await routeCdn(ctx);
      await ctx.route(/\/api\/(compte\/[a-z]+|historique)$/, async route => {
        const rq = route.request(), h = await rq.allHeaders();
        const req = new Request(rq.url(), { method: rq.method(), headers: { origin: h.origin || '', cookie: h.cookie || '', 'content-type': 'application/json' }, body: ['POST', 'PUT'].includes(rq.method()) ? rq.postData() || '' : undefined });
        const m = rq.url().match(/compte\/([a-z]+)$/);
        const res = m ? await handleCompte(req, m[1], { store: gs, gate: true, send: mail ? async (to, s2, html, code) => { mails.push({ to, code }); return true; } : undefined }) : await handleHistorique(req, { getUser: () => userFromRequest(req, gs), store: gh });
        const headers = { 'content-type': 'application/json' }; if (res.headers.get('set-cookie')) headers['set-cookie'] = res.headers.get('set-cookie');
        route.fulfill({ status: res.status, headers, body: await res.text() });
      });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r2 => r2.abort());
      await page.goto(BASE); await page.waitForSelector('#view .section-head');
      return { ctx, page, errors };
    };
    const G = await gateDevice();
    await G.page.waitForSelector('#gMailForm', { timeout: 15000 });
    ok(/Ton espace/.test(await G.page.innerText('#gate')) && await G.page.evaluate(() => document.body.classList.contains('gated')), 'entrée : l’app demande un e-mail à l’ouverture');
    ok(await G.page.evaluate(() => { const r = document.querySelector('#gate').getBoundingClientRect(); const top = document.elementFromPoint(200, 400); return r.width >= window.innerWidth && !!top.closest('#gate'); }), 'entrée : l’app est cachée derrière l’écran d’entrée');
    await G.page.fill('#gEmail', 'pas-un-mail'); await G.page.click('#gSend');
    ok(/invalide/.test(await G.page.innerText('#gErr')), 'entrée : adresse invalide signalée');
    await G.page.fill('#gEmail', 'Eleve@Test.CI'); await G.page.click('#gSend');
    await G.page.waitForSelector('#gCode', { timeout: 15000 });
    ok(/eleve@test\.ci/.test(await G.page.innerText('#gate')) && /Renvoyer un code \(\d+ s\)/.test(await G.page.innerText('#gResend')) && await G.page.isDisabled('#gResend'), 'entrée : écran du code, renvoi possible après 30 s');
    const code = mails[mails.length - 1].code;
    await G.page.fill('#gCode', code === '123456' ? '654321' : '123456');
    await G.page.waitForFunction(() => /Code incorrect/.test(document.querySelector('#gErr')?.innerText || ''), null, { timeout: 15000 });
    ok(true, 'entrée : mauvais code refusé');
    await G.page.fill('#gCode', code);
    await G.page.waitForFunction(() => !document.querySelector('#gate'), null, { timeout: 15000 });
    ok(await G.page.evaluate(() => acct.user && acct.user.email === 'eleve@test.ci' && !document.body.classList.contains('gated')), 'entrée : le code saisi ouvre l’app (envoi automatique au 6e chiffre)');
    await G.page.reload(); await G.page.waitForSelector('#view .section-head');
    await G.page.waitForFunction(() => acct.user && acct.user.email === 'eleve@test.ci', null, { timeout: 15000 });
    ok(!(await G.page.$('#gate')), 'entrée : on reste connecté au rechargement');
    await G.page.click('[data-tab="historique"]'); await G.page.click('#accLogout');
    await G.page.waitForSelector('#gMailForm', { timeout: 15000 });
    ok(true, 'entrée : la déconnexion ramène à l’écran d’entrée');
    await G.page.click('#gUsePw'); await G.page.fill('#gEmail', 'eleve@test.ci'); await G.page.fill('#gPw', 'motdepasse'); await G.page.click('#gPwGo');
    await G.page.waitForSelector('#gMailForm', { timeout: 15000 });
    ok(/code reçu par e-mail/.test(await G.page.innerText('#gErr')), 'entrée : compte sans mot de passe renvoyé vers le code');
    ok(await G.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'entrée : pas de débordement sur téléphone');
    ok(G.errors.length === 0, 'entrée : aucune erreur JavaScript', G.errors);
    await G.ctx.close();
    // Brevo pas encore configuré : entrée par e-mail et mot de passe
    const P = await gateDevice({ mail: false });
    await P.page.waitForSelector('#gPwForm', { timeout: 15000 });
    await P.page.click('#gSignup'); await P.page.fill('#gEmail', 'mdp@test.sn'); await P.page.fill('#gPw', 'motdepasse1'); await P.page.click('#gPwGo');
    await P.page.waitForFunction(() => !document.querySelector('#gate') && acct.user, null, { timeout: 15000 });
    ok(true, 'entrée sans Brevo : création de compte avec mot de passe et accès à l’app');
    ok(P.errors.length === 0, 'entrée sans Brevo : aucune erreur JavaScript', P.errors);
    await P.ctx.close();
  }
  // ---------- Journal d'activité : serveur ----------
  {
    const { handleActivite, liveFeed, userActivity, activityStats, parseKey } = await import('../server/activite.mjs');
    const as = kv(), cs2 = kv();
    const alice = { id: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'alice@test.sn' };
    const post = (body, user = alice, origin = 'https://app.test', now) => handleActivite(new Request('https://app.test/api/activite', { method: 'POST', headers: { origin, 'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), { getUser: async () => user, store: as, geo: { city: 'Dakar', country: { name: 'Senegal' } }, now });
    ok((await post({ events: [] }, null)).status === 401 && (await post({ events: [] }, alice, 'https://pirate.test')).status === 403 && (await post('{cassé')).status === 400 && (await post('x'.repeat(30000))).status === 413, 'activité : refus sans compte, d’un autre site, JSON invalide ou trop gros');
    let r = await post({ tab: 'Synthèse', bank: 'BAB', events: [{ type: 'onglet', d: 'Synthèse', at: new Date().toISOString() }, { type: 'pirate', d: 'x' }, { type: 'import', d: 'BAB · 50 poste(s)' }] });
    ok(r.status === 200 && (await r.json()).enregistres === 2, 'activité : actions enregistrées, types inconnus ignorés');
    const k = [...as.m.keys()].find(x => x.startsWith('e/'));
    ok(parseKey(k) && parseKey(k).n === 2, 'activité : la clé du lot porte la date et le nombre d’actions', k);
    await post({ tab: 'Rapport Word', bank: 'BAB', events: [] });
    const live = await liveFeed(as);
    ok(live.enLigne.length === 1 && live.enLigne[0].email === 'alice@test.sn' && live.enLigne[0].tab === 'Rapport Word' && /SM-A515F/.test(live.enLigne[0].appareil) && live.enLigne[0].lieu === 'Dakar, Senegal', 'activité : présence en ligne (onglet, appareil, lieu)', live.enLigne);
    ok(live.events.length === 2 && live.events.some(e => e.type === 'import' && e.email === 'alice@test.sn' && e.bank === 'BAB'), 'activité : fil des actions', live.events);
    const later = await liveFeed(as, { now: Date.now() + 4 * 60000 });
    ok(later.enLigne.length === 0 && later.recents.length === 1, 'activité : hors ligne après 3 minutes sans signal');
    const sinceNow = await liveFeed(as, { since: new Date().toISOString() });
    ok(sinceNow.events.length === 0, 'activité : « depuis » ne renvoie que les nouvelles actions');
    ok((await userActivity(as, alice.id)).length === 2 && (await userActivity(as, 'bbbb')).length === 0, 'activité : actions d’un compte');
    const st2 = await activityStats(as);
    ok(st2.actions7 === 2 && st2.heures.reduce((a, b) => a + b, 0) === 2, 'activité : statistiques par heure');
    // alertes e-mail à l'admin
    const { handleCompte: hc, hashPassword } = await import('../server/compte.mjs');
    const mailsA = [];
    const send = async (to, subject, html, code) => { mailsA.push({ to, subject, code }); return true; };
    const po = (action, body) => hc(new Request('https://app.test/api/compte/' + action, { method: 'POST', headers: { origin: 'https://app.test', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' }, body: JSON.stringify(body) }), action, { store: cs2, send, adminEmails: 'chef@test.sn' });
    await po('code', { email: 'nouveau@test.sn' }); await po('verifier', { email: 'nouveau@test.sn', code: mailsA.filter(m => m.code).pop().code });
    ok(mailsA.some(m => m.to === 'chef@test.sn' && /Nouvelle inscription : nouveau@test\.sn/.test(m.subject)), 'alertes : e-mail à l’admin à chaque inscription', mailsA);
    { const h = hashPassword('motdepasse1'); const k2 = [...cs2.m.keys()].find(k => k.startsWith('u/') && cs2.m.get(k).includes('nouveau@test.sn')); cs2.m.set(k2, JSON.stringify({ ...JSON.parse(cs2.m.get(k2)), salt: h.salt, hash: h.hash })); }
    const n0 = mailsA.length; await po('connexion', { email: 'nouveau@test.sn', password: 'motdepasse1' });
    ok(mailsA.length === n0, 'alertes : pas d’e-mail de connexion par défaut');
    await cs2.setJSON('reglages-admin', { alertes: { inscription: true, appareil: true, connexion: true } });
    await po('connexion', { email: 'nouveau@test.sn', password: 'motdepasse1' });
    ok(mailsA.slice(n0).some(m => /^Connexion : nouveau/.test(m.subject)), 'alertes : e-mail à chaque connexion si activé');
  }
  // ---------- Console admin en direct et style personnel : navigateur ----------
  {
    const { handleActivite } = await import('../server/activite.mjs');
    const cs3 = kv(), hs3 = memStore(), as3 = kv(), codes = [];
    const D3 = async (ua, width = 390) => {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, userAgent: ua });
      await routeCdn(ctx);
      await ctx.route(/\/api\/(compte\/[a-z]+|historique|activite|admin\/[a-z]+(\?.*)?)$/, async route => {
        const rq = route.request(), h = await rq.allHeaders();
        const req = new Request(rq.url(), { method: rq.method(), headers: { origin: h.origin || '', cookie: h.cookie || '', 'content-type': 'application/json', 'user-agent': h['user-agent'] || '', 'x-admin-key': h['x-admin-key'] || '' }, body: ['POST', 'PUT'].includes(rq.method()) ? rq.postData() || '' : undefined });
        const u = rq.url(), m = u.match(/compte\/([a-z]+)$/), ma = u.match(/admin\/([a-z]+)(\?|$)/);
        const res = m ? await handleCompte(req, m[1], { store: cs3, gate: true, adminEmails: 'chef@test.sn', send: async (to, s2, html, code) => { codes.push({ to, code }); return true; } })
          : ma ? await handleAdmin(req, ma[1], { comptes: cs3, historiques: hs3, activite: as3, adminEmails: 'chef@test.sn', codeRequired: true, adminKey: 'Cle-Admin-Test-2026' })
          : /activite$/.test(u) ? await handleActivite(req, { getUser: () => userFromRequest(req, cs3), store: as3 })
          : await handleHistorique(req, { getUser: () => userFromRequest(req, cs3), store: hs3 });
        const headers = { 'content-type': 'application/json' }; if (res.headers.get('set-cookie')) headers['set-cookie'] = res.headers.get('set-cookie');
        route.fulfill({ status: res.status, headers, body: await res.text() });
      });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r2 => r2.abort());
      await page.goto(BASE); await page.waitForSelector('#gMailForm', { timeout: 15000 });
      return { ctx, page, errors };
    };
    const enter = async (D, email) => { await D.page.fill('#gEmail', email); await D.page.click('#gSend'); await D.page.waitForSelector('#gCode'); await D.page.fill('#gCode', codes.filter(c => c.to === email && c.code).pop().code); await D.page.waitForFunction(() => !document.querySelector('#gate'), null, { timeout: 15000 }); };
    const Us3 = await D3('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1');
    await enter(Us3, 'awa@test.sn');
    ok(codes.some(c => c.to === 'chef@test.sn' && !c.code), 'alertes : l’admin est prévenu de la nouvelle inscription');
    await Us3.page.click('[data-tab="structure"]'); await Us3.page.click('[data-tab="rapport"]');
    // style personnel : appris d'un texte
    await Us3.page.click('#myStyleCard summary');
    await Us3.page.fill('#msSample', 'Dans le cadre de mon stage, j’ai étudié la banque. En effet, je constate que les crédits augmentent fortement. Par ailleurs, les dépôts progressent moins vite, ce qui tend la liquidité. Toutefois, je note que les fonds propres restent solides. De ce fait, j’estime que la banque doit renforcer sa collecte. En effet, sans dépôts, elle dépendra de la BCEAO.');
    await Us3.page.click('#msLearn');
    ok(await Us3.page.inputValue('#msPerson') === 'je' && /En effet/.test(await Us3.page.inputValue('#msConn')) && /Toutefois/.test(await Us3.page.inputValue('#msConn')), 'style personnel : appris d’un texte (« je », connecteurs)', [await Us3.page.inputValue('#msPerson'), await Us3.page.inputValue('#msConn')]);
    ok(/J’observe|je constate|Je relève/i.test(await Us3.page.innerText('#msPreview')), 'style personnel : aperçu rédigé à la première personne');
    await Us3.page.selectOption('#msLen', 'developpee');
    await Us3.page.fill('#msOpen', 'À la lecture des chiffres, {ratio} {verbe} de {v1} à {v2} entre {a1} et {a2}.');
    await Us3.page.fill('#msRepl', 'la banque = l’établissement');
    await Us3.page.fill('#msSign', 'Fait à Dakar — Awa N.');
    await Us3.page.click('#msSave');
    ok(await Us3.page.evaluate(() => hasMyStyle() && state.myStyle.person === 'je' && state.report.writing === 'perso' && document.querySelector('#rWrite').value === 'perso'), 'style personnel : enregistré et choisi pour les rapports');
    const b64 = await Us3.page.evaluate(async () => { const blob = await buildReport({ type: 'complet', writing: 'perso', sections: ['structure', 'conclusion'], charts: false }); const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; u.forEach(c => s += String.fromCharCode(c)); return btoa(s); });
    const zx = await require('jszip').loadAsync(Buffer.from(b64, 'base64')); const px = (await zx.file('word/document.xml').async('string')).replace(/<[^>]+>/g, '');
    ok(/À la lecture des chiffres, le ratio de transformation/.test(px) && /Au terme de mon analyse, j’estime/.test(px) && /Fait à Dakar — Awa N\./.test(px) && /l’établissement/.test(px) && !/\{ratio\}|\{v1\}/.test(px), 'style personnel : rapport écrit avec ses formules, son « je », ses remplacements et sa signature');
    for (let i = 0; i < 50 && !JSON.stringify([...hs3.m.values()]).includes('Fait à Dakar'); i++) await Us3.page.waitForTimeout(100);
    ok(JSON.stringify([...hs3.m.values()]).includes('Fait à Dakar'), 'style personnel : enregistré sur le compte (retrouvé sur les autres appareils)');
    // l'admin suit en direct
    const Ad3 = await D3('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 1200);
    await enter(Ad3, 'chef@test.sn');
    ok(await Ad3.page.evaluate(() => state.tab !== 'admin' && !document.querySelector('[data-atab]')), 'console séparée : à la connexion, l’admin arrive dans l’app, pas dans la console');
    await Ad3.page.goto(BASE + 'admin'); await Ad3.page.waitForSelector('#agKey:visible', { timeout: 15000 });
    ok(!(await Ad3.page.isVisible('#adminApp')), 'clé admin : même connecté avec son compte, la console demande la clé');
    await Ad3.page.fill('#agKey', 'mauvaise-cle'); await Ad3.page.click('#agGo');
    await Ad3.page.waitForFunction(() => /incorrecte/.test(document.querySelector('#agErr').innerText), null, { timeout: 15000 });
    ok(!(await Ad3.page.isVisible('#adminApp')), 'clé admin : mauvaise clé refusée');
    await Ad3.page.fill('#agKey', 'Cle-Admin-Test-2026'); await Ad3.page.click('#agGo');
    await Ad3.page.waitForSelector('#adminApp:visible', { timeout: 15000 });
    ok(await Ad3.page.evaluate(() => !location.href.includes('Cle-Admin') && sessionStorage.getItem('umoa-admin-key') === 'Cle-Admin-Test-2026' && !localStorage.getItem('umoa-admin-key')), 'clé admin : gardée le temps de la session seulement, jamais dans l’adresse');
    await Ad3.page.waitForFunction(() => /awa@test\.sn/.test(document.querySelector('.online')?.innerText || ''), null, { timeout: 15000 });
    const on = await Ad3.page.innerText('.online');
    ok(/iPhone/.test(on) && /Rapport Word/.test(on), 'en direct : l’admin voit qui est en ligne, sur quel appareil et quel onglet', on);
    const fd = await Ad3.page.innerText('#admFeed');
    ok(/se connecte/.test(fd) && /consulte « Ratios de structure »/.test(fd) && /règle son style/.test(fd), 'en direct : fil des actions de l’utilisateur', fd.slice(0, 300));
    await Us3.page.click('[data-tab="r"]'); await Us3.page.click('#rCopy'); await Us3.page.evaluate(() => flushTrack());
    await Ad3.page.waitForFunction(() => /code R : copie/.test(document.querySelector('#admFeed').innerText), null, { timeout: 25000 });
    ok(true, 'en direct : une nouvelle action apparaît chez l’admin en quelques secondes, sans recharger');
    ok(await Ad3.page.evaluate(() => !!document.querySelector('.ev.new')), 'en direct : les nouvelles actions sont mises en évidence');
    await Ad3.page.selectOption('#admFeedLevel', 'imp');
    ok(!/consulte «/.test(await Ad3.page.innerText('#admFeed')), 'en direct : filtre « actions importantes » (sans la navigation)');
    await Ad3.page.click('[data-atab="reglages"]');
    await Ad3.page.waitForSelector('[data-alert="connexion"]:not([disabled])', { timeout: 15000 });
    await Ad3.page.check('[data-alert="connexion"]');
    await Ad3.page.waitForFunction(() => /enregistré/.test(document.querySelector('#admAlertMsg').innerText), null, { timeout: 15000 });
    ok(JSON.parse(cs3.m.get('reglages-admin')).alertes.connexion === true, 'réglages : alerte à chaque connexion activée');
    // verrous depuis la console : code des options, puis app verrouillée
    Ad3.page.on('dialog', d => d.accept());
    await Ad3.page.click('[data-atab="verrous"]');
    await Ad3.page.waitForSelector('#lkOptCode', { timeout: 15000 });
    ok(/Options réservées/.test(await Ad3.page.innerText('#adminBox')) && /L’app est ouverte/.test(await Ad3.page.innerText('#adminBox')), 'console verrous : état des options et de l’app');
    await Ad3.page.evaluate(() => { document.querySelector('#lkOptCode').value = 'Code-Isaac'; document.querySelector('#lkOptCodeOk').click(); });
    await Ad3.page.waitForFunction(() => adm.verrous && adm.verrous.options.code && /défini/i.test(document.querySelector('#adminBox').innerText), null, { timeout: 15000 });
    await Us3.page.click('[data-tab="rapport"]'); await Us3.page.click('label[for="rt-recueil_td"]');
    ok(await Us3.page.isVisible('#rUnlockCode') && !(await Us3.page.$('#rGo')) && /🔒/.test(await Us3.page.innerText('label[for="rt-recueil_td"]')), 'options réservées : Option Isaac fermée sans le code');
    await Us3.page.fill('#rUnlockCode', 'pas-le-bon'); await Us3.page.click('#rUnlock');
    await Us3.page.waitForFunction(() => /incorrect/i.test(document.querySelector('#rStatus').innerText), null, { timeout: 15000 });
    ok(!(await Us3.page.$('[data-rbank]')), 'options réservées : mauvais code refusé');
    await Us3.page.fill('#rUnlockCode', 'code-isaac'); await Us3.page.click('#rUnlock');
    await Us3.page.waitForSelector('[data-rbank]', { timeout: 15000 });
    ok(await Us3.page.isVisible('#rGo') && !/🔒/.test(await Us3.page.innerText('label[for="rt-recueil"]')), 'options réservées : le bon code ouvre les deux options');
    await Ad3.page.evaluate(() => { document.querySelector('#lkMsg').value = 'Maintenance : retour à 18 h.'; document.querySelector('#lkApp').click(); });
    await Ad3.page.waitForFunction(() => /L’app est verrouillée/.test(document.querySelector('#adminBox').innerText), null, { timeout: 15000 });
    await Ad3.page.evaluate(() => { document.querySelector('#lkAppCode').value = 'Entree-1234'; document.querySelector('#lkAppCodeOk').click(); });
    await Ad3.page.waitForFunction(() => /entrer avec le code/.test(document.querySelector('#adminBox').innerText), null, { timeout: 15000 });
    await Us3.page.evaluate(() => refreshAccess());
    await Us3.page.waitForSelector('#lockScreen', { timeout: 15000 });
    ok(/Maintenance : retour à 18 h\./.test(await Us3.page.innerText('#lockScreen')) && await Us3.page.evaluate(() => document.body.classList.contains('gated')), 'app verrouillée : écran de verrouillage avec le message de l’admin, même déjà connecté');
    await Us3.page.fill('#lkCode', 'faux'); await Us3.page.click('#lkGo');
    await Us3.page.waitForFunction(() => /incorrect/i.test(document.querySelector('#lkErr').innerText), null, { timeout: 15000 });
    await Us3.page.fill('#lkCode', 'entree-1234'); await Us3.page.click('#lkGo');
    await Us3.page.waitForFunction(() => !document.querySelector('#lockScreen'), null, { timeout: 15000 });
    ok(true, 'app verrouillée : le code donné par l’admin fait entrer');
    await Ad3.page.click('#lkApp');
    await Ad3.page.waitForFunction(() => /L’app est ouverte/.test(document.querySelector('#adminBox').innerText), null, { timeout: 15000 });
    ok(JSON.parse(cs3.m.get('verrous')).app.actif === false, 'console verrous : app déverrouillée');
    ok(await Ad3.page.isVisible('#admLogout'), 'console : bouton « Se déconnecter » visible');
    await Ad3.page.click('#admLogout');
    await Ad3.page.waitForSelector('#agKey:visible', { timeout: 15000 });
    ok(await Ad3.page.evaluate(async () => !sessionStorage.getItem('umoa-admin-key') && !document.querySelector('#adminBox') && (await fetch('/api/admin/comptes')).status === 401), 'console : déconnexion, clé oubliée, plus aucune donnée');
    await Ad3.page.reload(); await Ad3.page.waitForSelector('#agKey:visible', { timeout: 15000 });
    ok(!(await Ad3.page.isVisible('#adminApp')), 'console : après déconnexion, la clé est redemandée');
    await Ad3.page.goto(BASE); await Ad3.page.waitForSelector('#view .section-head');
    ok(await Ad3.page.evaluate(() => !!document.querySelector('[data-tab="structure"]') && !document.querySelector('[data-atab]')), 'console séparée : l’app ne s’ouvre jamais sur la console');
    ok(Us3.errors.length === 0 && Ad3.errors.length === 0, 'console et style : aucune erreur JavaScript', [...Us3.errors, ...Ad3.errors]);
    await Us3.ctx.close(); await Ad3.ctx.close();
  }
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
