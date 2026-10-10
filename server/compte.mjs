// Comptes simples : adresse e-mail + mot de passe, sans e-mail de vérification.
// Mots de passe hachés (scrypt + sel), session dans un cookie HttpOnly signé (HMAC).
// La clé de signature est créée au premier usage et gardée dans le stockage : aucun réglage à faire.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash, randomUUID } from 'node:crypto';

export const COOKIE = 'umoa_session';
const SESSION_DAYS = 30, MAX_FAILS = 5, LOCK_MIN = 15;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const b64u = buf => Buffer.from(buf).toString('base64url');
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const userKey = email => 'u/' + createHash('sha256').update(email).digest('hex');
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');

async function secret(store) {
  let s = await store.get('cle-session', { type: 'text' });
  if (!s) { await store.set('cle-session', randomBytes(32).toString('hex'), { onlyIfNew: true }); s = await store.get('cle-session', { type: 'text' }); }
  return s;
}
const sign = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url');
async function makeToken(user, store) {
  const payload = b64u(JSON.stringify({ uid: user.id, email: user.email, exp: Date.now() + SESSION_DAYS * 864e5 }));
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
    return { id: p.uid, email: p.email };
  } catch (e) { return null; }
}

export async function handleCompte(req, action, { store }) {
  if (action === 'moi' && req.method === 'GET') {
    const u = await userFromRequest(req, store);
    return u ? json({ email: u.email }) : json({ error: 'Non connecté' }, 401);
  }
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  if (action === 'deconnexion') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(req, '', 0) });
  if (action !== 'inscription' && action !== 'connexion') return json({ error: 'Action inconnue' }, 404);

  let body;
  try { body = JSON.parse((await req.text()).slice(0, 10000)); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
  const email = normEmail(body && body.email), password = String((body && body.password) || '');
  if (!validEmail(email)) return json({ error: 'Adresse e-mail invalide.', code: 'email' }, 400);
  if (password.length > 200) return json({ error: 'Mot de passe trop long.', code: 'password' }, 400);
  const key = userKey(email);

  if (action === 'inscription') {
    if (password.length < 8) return json({ error: 'Le mot de passe doit faire au moins 8 caractères.', code: 'password' }, 400);
    const salt = randomBytes(16).toString('hex');
    const user = { id: randomUUID(), email, salt, hash: hashPw(password, salt), createdAt: new Date().toISOString(), fails: 0, lockedUntil: 0 };
    const { modified } = await store.setJSON(key, user, { onlyIfNew: true });
    if (modified === false) return json({ error: 'Un compte existe déjà avec cette adresse : connecte-toi.', code: 'exists' }, 409);
    return json({ email }, 201, { 'Set-Cookie': sessionCookie(req, await makeToken(user, store), SESSION_DAYS * 86400) });
  }

  // connexion
  const user = await store.get(key, { type: 'json' });
  const bad = () => json({ error: 'Adresse e-mail ou mot de passe incorrect.', code: 'credentials' }, 401);
  if (!user) { hashPw(password, 'x'.repeat(32)); return bad(); }
  if (user.lockedUntil && user.lockedUntil > Date.now()) return json({ error: 'Trop d’essais : réessaie dans ' + Math.ceil((user.lockedUntil - Date.now()) / 60000) + ' minute(s).', code: 'locked' }, 429);
  const ok = timingSafeEqual(Buffer.from(hashPw(password, user.salt), 'hex'), Buffer.from(user.hash, 'hex'));
  if (!ok) {
    user.fails = (user.fails || 0) + 1;
    if (user.fails >= MAX_FAILS) { user.lockedUntil = Date.now() + LOCK_MIN * 60000; user.fails = 0; }
    await store.setJSON(key, user);
    return bad();
  }
  if (user.fails || user.lockedUntil) { user.fails = 0; user.lockedUntil = 0; await store.setJSON(key, user); }
  return json({ email: user.email }, 200, { 'Set-Cookie': sessionCookie(req, await makeToken(user, store), SESSION_DAYS * 86400) });
}
