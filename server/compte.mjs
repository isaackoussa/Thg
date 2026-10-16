// Comptes simples : adresse e-mail + mot de passe, sans e-mail de vérification.
// Mots de passe hachés (scrypt + sel), session dans un cookie HttpOnly signé (HMAC).
// La clé de signature est créée au premier usage et gardée dans le stockage : aucun réglage à faire.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash, randomUUID, randomInt } from 'node:crypto';

export const COOKIE = 'umoa_session';
const SESSION_DAYS = 365, MAX_FAILS = 5, LOCK_MIN = 15;
// Connexion par code reçu par e-mail (comme Anglais 365) : code à 6 chiffres valable 10 minutes, 5 essais, renvoi après 30 s
const CODE_TTL_MS = 10 * 60 * 1000, CODE_COOLDOWN_MS = 30 * 1000, CODE_TRIES = 5;
const MAX_DEVICES = 10, MAX_JOURNAL = 30, SEEN_EVERY_MS = 3600e3;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const b64u = buf => Buffer.from(buf).toString('base64url');
export const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const userKey = email => 'u/' + createHash('sha256').update(email).digest('hex');
export const userKeyOf = email => userKey(normEmail(email));
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
export function hashPassword(pw) { const salt = randomBytes(16).toString('hex'); return { salt, hash: hashPw(pw, salt) }; }

// Appareil d'après l'en-tête User-Agent (+ modèle envoyé par l'app quand le navigateur le donne)
export function parseDevice(ua, hint) {
  ua = String(ua || '').slice(0, 400);
  const m = (re) => { const x = ua.match(re); return x ? x[1] : ''; };
  let type = 'Ordinateur', os = 'Autre système', model = '';
  if (/iPhone/.test(ua)) { type = 'Téléphone'; model = 'iPhone'; os = 'iOS ' + m(/OS (\d+(?:_\d+)?)/).replace('_', '.'); }
  else if (/iPad/.test(ua)) { type = 'Tablette'; model = 'iPad'; os = 'iPadOS ' + m(/OS (\d+(?:_\d+)?)/).replace('_', '.'); }
  else if (/Android/.test(ua)) {
    type = /Mobile/.test(ua) ? 'Téléphone' : 'Tablette'; os = 'Android ' + m(/Android (\d+(?:\.\d+)?)/);
    const md = m(/Android [\d.]+; ([^;)]+?)(?: Build[^;)]*)?\)/).trim();
    if (md && md !== 'K' && !/^[a-z]{2}[-_][a-z]{2}$/i.test(md)) model = md;
  }
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) { os = 'macOS'; model = 'Mac'; }
  else if (/Linux/.test(ua)) os = 'Linux';
  const h = String(hint || '').replace(/[^\w .+()\-]/g, '').trim().slice(0, 40);
  if (h) model = h;
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /FBAN|FBAV/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : /WhatsApp/.test(ua) ? 'WhatsApp'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur inconnu';
  os = os.trim();
  const label = (model ? model + ' · ' : '') + os + ' · ' + browser;
  const id = createHash('sha256').update(type + '|' + os.replace(/ [\d.]+$/, '') + '|' + model + '|' + browser).digest('hex').slice(0, 16);
  return { id, type, os, model, browser, label };
}
function placeOf(geo) {
  if (!geo) return '';
  const country = geo.country && (geo.country.name || geo.country.code) || '';
  return [geo.city, country].filter(Boolean).join(', ').slice(0, 80);
}
// Note l'appareil et l'événement dans le compte (sans adresse IP). Retourne true si le compte a changé.
export function recordDevice(user, req, geo, event, now = Date.now()) {
  const d = parseDevice(req.headers.get('user-agent'), req.headers.get('x-appareil'));
  const at = new Date(now).toISOString(), lieu = placeOf(geo);
  const devices = Array.isArray(user.devices) ? user.devices : [];
  let dv = devices.find(x => x.id === d.id);
  if (event === 'visite' && dv && now - Date.parse(dv.lastSeen) < SEEN_EVERY_MS) return false;
  if (event !== 'echec') {
    if (!dv) { dv = { ...d, firstSeen: at, count: 0 }; devices.push(dv); }
    Object.assign(dv, { label: d.label, os: d.os, lastSeen: at, count: (dv.count || 0) + 1 }, lieu ? { lieu } : {});
    devices.sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    user.devices = devices.slice(0, MAX_DEVICES);
  }
  const journal = Array.isArray(user.journal) ? user.journal : [];
  journal.unshift({ at, event, appareil: d.label, type: d.type, lieu });
  user.journal = journal.slice(0, MAX_JOURNAL);
  return true;
}

/* ---- Envoi d'e-mails (Brevo) : BREVO_API_KEY + MAIL_FROM ; MAIL_DRY_RUN=1 écrit le code dans les journaux ---- */
export const mailReady = env => env('MAIL_DRY_RUN') === '1' || !!(env('BREVO_API_KEY') && env('MAIL_FROM'));
async function brevoSend(env, to, subject, html) {
  if (env('MAIL_DRY_RUN') === '1') { console.log('[MAIL_DRY_RUN] à ' + to + ' : ' + subject); return true; }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: env('MAIL_FROM'), name: env('MAIL_FROM_NAME') || 'Analyste Bancaire UMOA' }, to: [{ email: to }], subject, htmlContent: html })
    });
    if (!res.ok) console.error('Brevo : échec d\'envoi', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) { console.error('Brevo :', e); return false; }
}
export function codeEmail(code) {
  return {
    subject: code + ' est ton code Analyste Bancaire UMOA',
    html: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ton code de connexion</title></head>'
      + '<body style="margin:0;padding:0;background:#f2f4f1;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#13201a">'
      + '<span style="display:none;max-height:0;overflow:hidden">Ton code de connexion : ' + code + '</span>'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f1;padding:24px 12px"><tr><td align="center">'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d3dbd5">'
      + '<tr><td style="background:#0c5a48;padding:24px 28px;color:#ffffff"><span style="display:inline-block;background:#ffffff;color:#0c5a48;font-weight:800;font-size:12px;letter-spacing:2px;padding:5px 8px;border-radius:4px">UMOA</span>'
      + '<span style="font-weight:700;font-size:17px;padding-left:10px;color:#ffffff">Analyste Bancaire</span><h1 style="margin:16px 0 0;font-size:24px;color:#ffffff">Ton code de connexion</h1></td></tr>'
      + '<tr><td style="padding:26px 28px;font-size:16px;line-height:1.6"><p style="margin:0 0 12px">Voici ton code pour te connecter à Analyste Bancaire UMOA :</p>'
      + '<p style="margin:0 0 16px;font-size:36px;font-weight:800;letter-spacing:8px;color:#0c5a48">' + code + '</p>'
      + '<p style="margin:0;font-size:14px;color:#45524b">Il est valable 10 minutes. Si tu n\'es pas à l\'origine de cette demande, ignore simplement ce message.</p></td></tr>'
      + '</table></td></tr></table></body></html>'
  };
}
/* ---- Administrateurs et alertes par e-mail (nouvelle inscription, nouvel appareil, chaque connexion) ---- */
export const DEFAULT_ADMINS = 'koussaisaac199@gmail.com';
export const adminList = env => String(env || DEFAULT_ADMINS).split(',').map(normEmail).filter(Boolean);
export const ALERT_DEFAULTS = { inscription: true, appareil: false, connexion: false };
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function alertAdmins(kind, user, req, geo, deps) {
  try {
    const { store, env = () => undefined, send, adminEmails } = deps;
    if (!send && !mailReady(env)) return;
    const reg = { ...ALERT_DEFAULTS, ...(((await store.get('reglages-admin', { type: 'json' })) || {}).alertes || {}) };
    if (!reg[kind]) return;
    const admins = adminList(adminEmails).filter(a => a !== user.email);
    if (!admins.length) return;
    const d = (user.devices || [])[0] || {}, title = { inscription: 'Nouvelle inscription', appareil: 'Connexion depuis un nouvel appareil', connexion: 'Connexion' }[kind];
    const subject = title + ' : ' + user.email;
    const html = '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#13201a;max-width:520px"><h2 style="color:#0c5a48;margin:0 0 10px">' + escH(title) + '</h2>'
      + '<p style="margin:0 0 6px"><b>' + escH(user.email) + '</b></p><p style="margin:0 0 6px">Appareil : ' + escH(d.label || '—') + (d.lieu ? ' · ' + escH(d.lieu) : '') + '</p>'
      + '<p style="margin:0 0 6px">Le ' + new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' }) + ' (GMT)</p><p style="color:#6b7770;font-size:13px">Alerte envoyée par Analyste Bancaire UMOA. Réglages : console admin → Réglages.</p></div>';
    for (const a of admins) send ? await send(a, subject, html, null) : await brevoSend(env, a, subject, html);
  } catch (e) { console.warn('alerte admin :', e); }
}
const codeKey = email => 'c/' + createHash('sha256').update(email).digest('hex');
const codeHash = (email, code) => createHash('sha256').update(email + ':' + code).digest('hex');

async function secret(store) {
  let s = await store.get('cle-session', { type: 'text' });
  if (!s) { await store.set('cle-session', randomBytes(32).toString('hex'), { onlyIfNew: true }); s = await store.get('cle-session', { type: 'text' }); }
  return s;
}
const sign = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url');
// vc : session ouverte avec un code reçu par e-mail (adresse prouvée) — exigé pour la console admin
async function makeToken(user, store, viaCode = false) {
  const payload = b64u(JSON.stringify({ uid: user.id, email: user.email, sv: String(user.salt).slice(0, 12), vc: viaCode ? 1 : 0, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + '.' + sign(payload, await secret(store));
}
function readCookie(req, name) {
  const m = (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function sessionCookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return COOKIE + '=' + (token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secure;
}
// Utilisateur de la requête, d'après le cookie de session ; null si absent, invalide ou expiré
export async function userFromRequest(req, store) {
  const tok = readCookie(req, COOKIE);
  if (!tok || !tok.includes('.')) return null;
  const [payload, sig] = tok.split('.');
  const good = sign(payload, await secret(store));
  if (!sig || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.uid || !(p.exp > Date.now())) return null;
    // le compte doit toujours exister, et son mot de passe ne doit pas avoir été changé depuis la connexion
    const u = await store.get(userKey(normEmail(p.email)), { type: 'json' });
    if (!u || u.id !== p.uid || String(u.salt).slice(0, 12) !== p.sv) return null;
    return { id: p.uid, email: u.email, viaCode: p.vc === 1 };
  } catch (e) { return null; }
}

export async function handleCompte(req, action, deps) {
  const { store, geo, env = () => undefined, gate = false, send } = deps;
  // l'app demande si l'entrée exige un e-mail et si l'envoi de codes est possible
  if (action === 'config' && req.method === 'GET') return json({ gate: !!gate, mail: mailReady(env) || !!send });
  if (action === 'moi' && req.method === 'GET') {
    const u = await userFromRequest(req, store);
    if (!u) return json({ error: 'Non connecté' }, 401);
    // ouverture de l'app avec une session : appareil noté au plus une fois par heure
    try { const key = userKeyOf(u.email), full = await store.get(key, { type: 'json' }); if (full && recordDevice(full, req, geo, 'visite')) await store.setJSON(key, full); } catch (e) {}
    return json({ email: u.email });
  }
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  if (action === 'deconnexion') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  if (!['inscription', 'connexion', 'code', 'verifier'].includes(action)) return json({ error: 'Action inconnue' }, 404);

  let body;
  try { body = JSON.parse((await req.text()).slice(0, 10000)); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
  const email = normEmail(body && body.email), password = String((body && body.password) || '');
  if (!validEmail(email)) return json({ error: 'Adresse e-mail invalide.', code: 'email' }, 400);

  if (action === 'code') {
    if (!mailReady(env) && !send) return json({ error: 'L’envoi des codes par e-mail n’est pas encore configuré sur ce site : connecte-toi avec un mot de passe.', code: 'mail' }, 503);
    const prev = await store.get(codeKey(email), { type: 'json' });
    if (prev && Date.now() - prev.sentAt < CODE_COOLDOWN_MS) return json({ error: 'Un code vient d’être envoyé : patiente quelques secondes avant d’en demander un autre.', code: 'too_soon' }, 429);
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    // seule l'empreinte du code est conservée
    await store.setJSON(codeKey(email), { hash: codeHash(email, code), sentAt: Date.now(), expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 });
    const m = codeEmail(code);
    const ok = send ? await send(email, m.subject, m.html, code) : await brevoSend(env, email, m.subject, m.html);
    if (!ok) { await store.delete(codeKey(email)); return json({ error: 'L’e-mail n’a pas pu être envoyé. Vérifie l’adresse ou réessaie dans un instant.', code: 'send' }, 502); }
    return json({ ok: true });
  }
  if (action === 'verifier') {
    const code = String((body && body.code) || '').replace(/\D/g, '');
    if (code.length !== 6) return json({ error: 'Le code fait 6 chiffres.', code: 'format' }, 400);
    const rec = await store.get(codeKey(email), { type: 'json' });
    if (!rec) return json({ error: 'Aucun code en cours pour cette adresse : demande un nouveau code.', code: 'no_code' }, 400);
    if (Date.now() > rec.expiresAt) { await store.delete(codeKey(email)); return json({ error: 'Ce code a expiré : demande un nouveau code.', code: 'expired' }, 400); }
    if (rec.attempts >= CODE_TRIES) { await store.delete(codeKey(email)); return json({ error: 'Trop d’essais : demande un nouveau code.', code: 'too_many' }, 429); }
    const good = codeHash(email, code);
    if (!timingSafeEqual(Buffer.from(rec.hash), Buffer.from(good))) {
      rec.attempts += 1;
      if (rec.attempts >= CODE_TRIES) await store.delete(codeKey(email)); else await store.setJSON(codeKey(email), rec);
      const left = CODE_TRIES - rec.attempts;
      return json({ error: left > 0 ? 'Code incorrect (' + left + ' essai' + (left > 1 ? 's' : '') + ' restant' + (left > 1 ? 's' : '') + ').' : 'Code incorrect. Trop d’essais : demande un nouveau code.', code: 'wrong_code', remaining: left }, 400);
    }
    await store.delete(codeKey(email));
    const key = userKey(email), now = new Date().toISOString();
    let user = await store.get(key, { type: 'json' });
    const isNew = !user, devBefore = user ? (user.devices || []).length : 0;
    if (!user) {
      // compte créé à la première connexion, sans mot de passe
      user = { id: randomUUID(), email, salt: randomBytes(16).toString('hex'), hash: '', createdAt: now, lastLogin: now, fails: 0, lockedUntil: 0, via: 'code' };
      recordDevice(user, req, geo, 'inscription');
    } else {
      user.lastLogin = now; user.fails = 0; user.lockedUntil = 0;
      recordDevice(user, req, geo, 'connexion');
    }
    await store.setJSON(key, user);
    if (isNew) await alertAdmins('inscription', user, req, geo, deps);
    else { if (devBefore && (user.devices || []).length > devBefore) await alertAdmins('appareil', user, req, geo, deps); await alertAdmins('connexion', user, req, geo, deps); }
    return json({ email, isNew }, isNew ? 201 : 200, { 'Set-Cookie': sessionCookie(req, await makeToken(user, store, true), SESSION_DAYS * 86400) });
  }
  if (password.length > 200) return json({ error: 'Mot de passe trop long.', code: 'password' }, 400);
  const key = userKey(email);

  if (action === 'inscription') {
    if (mailReady(env) || send) return json({ error: 'L’inscription se fait avec un code reçu par e-mail : choisis « Recevoir mon code ».', code: 'use_code' }, 403);
    if (password.length < 8) return json({ error: 'Le mot de passe doit faire au moins 8 caractères.', code: 'password' }, 400);
    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const user = { id: randomUUID(), email, salt, hash: hashPw(password, salt), createdAt: now, lastLogin: now, fails: 0, lockedUntil: 0 };
    recordDevice(user, req, geo, 'inscription');
    const { modified } = await store.setJSON(key, user, { onlyIfNew: true });
    if (modified === false) return json({ error: 'Un compte existe déjà avec cette adresse : connecte-toi.', code: 'exists' }, 409);
    await alertAdmins('inscription', user, req, geo, deps);
    return json({ email }, 201, { 'Set-Cookie': sessionCookie(req, await makeToken(user, store), SESSION_DAYS * 86400) });
  }

  // connexion
  const user = await store.get(key, { type: 'json' });
  const bad = () => json({ error: 'Adresse e-mail ou mot de passe incorrect.', code: 'credentials' }, 401);
  if (!user) { hashPw(password, 'x'.repeat(32)); return bad(); }
  if (!user.hash) return json({ error: 'Ce compte se connecte avec un code reçu par e-mail : choisis « Recevoir mon code ».', code: 'use_code' }, 400);
  if (user.lockedUntil && user.lockedUntil > Date.now()) return json({ error: 'Trop d’essais : réessaie dans ' + Math.ceil((user.lockedUntil - Date.now()) / 60000) + ' minute(s).', code: 'locked' }, 429);
  const ok = timingSafeEqual(Buffer.from(hashPw(password, user.salt), 'hex'), Buffer.from(user.hash, 'hex'));
  if (!ok) {
    user.fails = (user.fails || 0) + 1;
    if (user.fails >= MAX_FAILS) { user.lockedUntil = Date.now() + LOCK_MIN * 60000; user.fails = 0; }
    recordDevice(user, req, geo, 'echec');
    await store.setJSON(key, user);
    return bad();
  }
  user.fails = 0; user.lockedUntil = 0; user.lastLogin = new Date().toISOString();
  const nDev = (user.devices || []).length;
  recordDevice(user, req, geo, 'connexion');
  await store.setJSON(key, user);
  if (nDev && (user.devices || []).length > nDev) await alertAdmins('appareil', user, req, geo, deps);
  await alertAdmins('connexion', user, req, geo, deps);
  return json({ email: user.email }, 200, { 'Set-Cookie': sessionCookie(req, await makeToken(user, store), SESSION_DAYS * 86400) });
}
