// Partie admin : réservée aux adresses de ADMIN_EMAILS (réglage Netlify, séparées par des virgules).
// Sans réglage, l'administrateur est le compte du propriétaire de l'app.
import { userFromRequest, hashPassword, userKeyOf, normEmail } from './compte.mjs';

export const DEFAULT_ADMINS = 'koussaisaac199@gmail.com';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
export const adminList = env => String(env || DEFAULT_ADMINS).split(',').map(normEmail).filter(Boolean);

async function allUsers(comptes) {
  const { blobs } = await comptes.list({ prefix: 'u/' });
  const users = [];
  for (const b of blobs) { const u = await comptes.get(b.key, { type: 'json' }); if (u && u.email) users.push({ key: b.key, ...u }); }
  return users;
}
const dayOf = iso => String(iso || '').slice(0, 10);

export async function handleAdmin(req, action, { comptes, historiques, adminEmails }) {
  const me = await userFromRequest(req, comptes);
  if (!me) return json({ error: 'Connexion requise' }, 401);
  if (!adminList(adminEmails).includes(normEmail(me.email))) return json({ error: 'Réservé à l’administrateur' }, 403);
  if (req.method === 'POST') {
    const origin = req.headers.get('origin');
    if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  }
  const url = new URL(req.url);

  if (action === 'moi' && req.method === 'GET') return json({ admin: true, email: me.email });

  if ((action === 'comptes' || action === 'stats') && req.method === 'GET') {
    const users = await allUsers(comptes);
    const rows = [];
    for (const u of users) {
      const doc = await historiques.get('u/' + u.id, { type: 'json' }) || {};
      const banks = doc.banks && typeof doc.banks === 'object' ? Object.values(doc.banks) : [];
      const hist = Array.isArray(doc.history) ? doc.history : [];
      rows.push({ email: u.email, id: u.id, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null, lastSync: doc.updatedAt || null,
        locked: !!(u.lockedUntil && u.lockedUntil > Date.now()), banks: banks.length, analyses: hist.length,
        bankNames: banks.map(b => String(b.name || '')).filter(Boolean), histDates: hist.map(e => dayOf(e.at)) });
    }
    rows.sort((a, b) => String(b.lastLogin || b.createdAt).localeCompare(String(a.lastLogin || a.createdAt)));
    if (action === 'comptes') return json({ comptes: rows.map(({ bankNames, histDates, ...r }) => r) });
    // statistiques
    const now = Date.now(), since = d => rows.filter(r => r.lastLogin && now - Date.parse(r.lastLogin) <= d * 864e5).length;
    const days = []; for (let i = 29; i >= 0; i--) days.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
    const perDay = days.map(d => ({ jour: d, inscriptions: rows.filter(r => dayOf(r.createdAt) === d).length, analyses: rows.reduce((a, r) => a + r.histDates.filter(x => x === d).length, 0) }));
    const counts = {};
    rows.forEach(r => new Set(r.bankNames.map(n => n.trim().toUpperCase())).forEach(n => { counts[n] = (counts[n] || 0) + 1; }));
    const topBanques = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([nom, comptes]) => ({ nom, comptes }));
    return json({ comptes: rows.length, actifs7: since(7), actifs30: since(30), banques: rows.reduce((a, r) => a + r.banks, 0), analyses: rows.reduce((a, r) => a + r.analyses, 0), parJour: perDay, topBanques });
  }

  if (action === 'analyses' && req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const users = await allUsers(comptes), u = users.find(x => x.id === id);
    if (!u) return json({ error: 'Compte introuvable' }, 404);
    const doc = await historiques.get('u/' + u.id, { type: 'json' }) || {};
    return json({ email: u.email, banks: doc.banks || {}, history: doc.history || [], updatedAt: doc.updatedAt || null });
  }

  if (req.method !== 'POST') return json({ error: 'Action inconnue' }, 404);
  let body; try { body = JSON.parse((await req.text()).slice(0, 10000)); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
  const email = normEmail(body && body.email);
  const key = userKeyOf(email), user = email ? await comptes.get(key, { type: 'json' }) : null;
  if (!user) return json({ error: 'Compte introuvable' }, 404);

  if (action === 'motdepasse') {
    const pw = String(body.password || '');
    if (pw.length < 8 || pw.length > 200) return json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' }, 400);
    const h = hashPassword(pw);
    await comptes.setJSON(key, { ...user, salt: h.salt, hash: h.hash, fails: 0, lockedUntil: 0, passwordResetAt: new Date().toISOString() });
    return json({ ok: true });
  }
  if (action === 'debloquer') { await comptes.setJSON(key, { ...user, fails: 0, lockedUntil: 0 }); return json({ ok: true }); }
  if (action === 'supprimer') {
    if (normEmail(email) === normEmail(me.email)) return json({ error: 'Tu ne peux pas supprimer ton propre compte administrateur.' }, 400);
    await historiques.delete('u/' + user.id);
    await comptes.delete(key);
    return json({ ok: true });
  }
  return json({ error: 'Action inconnue' }, 404);
}
