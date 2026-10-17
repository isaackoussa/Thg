// Partie admin : réservée aux adresses de ADMIN_EMAILS (réglage Netlify, séparées par des virgules).
// Sans réglage, l'administrateur est le compte du propriétaire de l'app.
import { userFromRequest, hashPassword, userKeyOf, normEmail, DEFAULT_ADMINS, adminList, ALERT_DEFAULTS, mailReady } from './compte.mjs';
import { liveFeed, userActivity, activityStats } from './activite.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
export { DEFAULT_ADMINS, adminList };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function allUsers(comptes) {
  const { blobs } = await comptes.list({ prefix: 'u/' });
  const users = [];
  for (const b of blobs) { const u = await comptes.get(b.key, { type: 'json' }); if (u && u.email) users.push({ key: b.key, ...u }); }
  return users;
}
const dayOf = iso => String(iso || '').slice(0, 10);

const sameKey = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export async function handleAdmin(req, action, { comptes, historiques, activite, adminEmails, env = () => undefined, codeRequired, adminKey }) {
  // Accès par clé admin (ADMIN_KEY, comme MasterGraf / SMC Lab) : la console ne dépend d'aucun compte de l'app.
  // Sans ADMIN_KEY réglée, repli sur le compte administrateur ouvert avec un code e-mail.
  const consoleKey = String(adminKey ?? env('ADMIN_KEY') ?? '').trim();
  let me;
  if (consoleKey) {
    const fails = (await comptes.get('admin-echecs', { type: 'json' })) || { n: 0, until: 0 };
    if (fails.until > Date.now()) return json({ error: 'Trop d’essais : console bloquée encore ' + Math.ceil((fails.until - Date.now()) / 60000) + ' minute(s).', code: 'locked' }, 429);
    const got = String(req.headers.get('x-admin-key') || '').trim();
    if (!got || !sameKey(got, consoleKey)) {
      if (got) { fails.n = (fails.n || 0) + 1; if (fails.n >= 8) { fails.until = Date.now() + 15 * 60000; fails.n = 0; } await comptes.setJSON('admin-echecs', fails); }
      return json({ error: got ? 'Clé admin incorrecte.' : 'Clé admin requise.', code: 'key' }, 401);
    }
    if (fails.n) await comptes.setJSON('admin-echecs', { n: 0, until: 0 });
    me = { email: 'clé admin', viaKey: true };
  } else {
    me = await userFromRequest(req, comptes);
    if (!me) return json({ error: 'Clé admin requise.', code: 'key' }, 401);
    if (!adminList(adminEmails).includes(normEmail(me.email))) return json({ error: 'Réservé à l’administrateur' }, 403);
    // quand les codes e-mail fonctionnent, une session ouverte avec un mot de passe ne suffit jamais
    if ((codeRequired ?? mailReady(env)) && !me.viaCode) return json({ error: 'Pour ouvrir la console, déconnecte-toi puis reconnecte-toi avec le code reçu par e-mail.', code: 'verify' }, 403);
  }
  if (req.method === 'POST') {
    const origin = req.headers.get('origin');
    if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  }
  const url = new URL(req.url);

  if (action === 'moi' && req.method === 'GET') return json({ admin: true, email: me.email, mode: me.viaKey ? 'cle' : 'compte', admins: adminList(adminEmails) });
  // en direct : qui est en ligne, ce qu'il fait ; « depuis » ne renvoie que les nouvelles actions
  if (action === 'direct' && req.method === 'GET') {
    if (!activite) return json({ now: new Date().toISOString(), enLigne: [], recents: [], events: [] });
    return json(await liveFeed(activite, { since: url.searchParams.get('depuis') || '', uid: url.searchParams.get('id') || '' }));
  }
  if (action === 'reglages' && req.method === 'GET') return json({ alertes: { ...ALERT_DEFAULTS, ...((await comptes.get('reglages-admin', { type: 'json' })) || {}).alertes } });
  if (action === 'reglages' && req.method === 'POST') {
    let b; try { b = JSON.parse((await req.text()).slice(0, 4000)); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
    const alertes = {}; Object.keys(ALERT_DEFAULTS).forEach(k => { alertes[k] = !!(b && b.alertes && b.alertes[k]); });
    await comptes.setJSON('reglages-admin', { alertes, modifiePar: me.email, le: new Date().toISOString() });
    return json({ alertes });
  }

  if ((action === 'comptes' || action === 'stats') && req.method === 'GET') {
    const users = await allUsers(comptes);
    const rows = [];
    for (const u of users) {
      const doc = await historiques.get('u/' + u.id, { type: 'json' }) || {};
      const banks = doc.banks && typeof doc.banks === 'object' ? Object.values(doc.banks) : [];
      const hist = Array.isArray(doc.history) ? doc.history : [];
      rows.push({ email: u.email, id: u.id, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null, lastSync: doc.updatedAt || null,
        locked: !!(u.lockedUntil && u.lockedUntil > Date.now()), banks: banks.length, analyses: hist.length,
        device: (u.devices || [])[0] ? { label: u.devices[0].label, type: u.devices[0].type, lieu: u.devices[0].lieu || '' } : null, nDevices: (u.devices || []).length,
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
    const act = activite ? await activityStats(activite) : { heures: Array(24).fill(0), jours: {}, actions7: 0, actifsSemaine: 0 };
    perDay.forEach(d => { d.actions = act.jours[d.jour] || 0; });
    return json({ comptes: rows.length, actifs7: since(7), actifs30: since(30), banques: rows.reduce((a, r) => a + r.banks, 0), analyses: rows.reduce((a, r) => a + r.analyses, 0), parJour: perDay, topBanques, heuresUTC: act.heures, actions7: act.actions7 });
  }

  if (action === 'analyses' && req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const users = await allUsers(comptes), u = users.find(x => x.id === id);
    if (!u) return json({ error: 'Compte introuvable' }, 404);
    const doc = await historiques.get('u/' + u.id, { type: 'json' }) || {};
    const actions = activite ? await userActivity(activite, u.id) : [];
    return json({ id: u.id, email: u.email, createdAt: u.createdAt || null, via: u.via || (u.hash ? 'mot de passe' : 'code'), actions, devices: u.devices || [], journal: u.journal || [], banks: doc.banks || {}, history: doc.history || [], updatedAt: doc.updatedAt || null });
  }

  if (req.method !== 'POST') return json({ error: 'Action inconnue' }, 404);
  let body; try { body = JSON.parse((await req.text()).slice(0, 10000)); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
  // compte retrouvé par son identifiant et la clé réellement enregistrée (comme « Voir »), sinon par l'adresse
  const email = normEmail(body && body.email), wantId = String((body && body.id) || '');
  let key = email ? userKeyOf(email) : '', user = key ? await comptes.get(key, { type: 'json' }) : null;
  if (!user || (wantId && user.id !== wantId)) {
    const found = (await allUsers(comptes)).find(u => (wantId && u.id === wantId) || (email && normEmail(u.email) === email));
    if (found) { key = found.key; const { key: _k, ...rest } = found; user = rest; }
  }
  if (!user) {
    // déjà supprimé : on nettoie ce qui pourrait rester et on le signale sans erreur
    if (action === 'supprimer') {
      if (wantId) { try { await historiques.delete('u/' + wantId); } catch (e) {} }
      return json({ ok: true, deja: true });
    }
    return json({ error: 'Compte introuvable' }, 404);
  }

  if (action === 'motdepasse') {
    const pw = String(body.password || '');
    if (pw.length < 8 || pw.length > 200) return json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' }, 400);
    const h = hashPassword(pw);
    await comptes.setJSON(key, { ...user, salt: h.salt, hash: h.hash, fails: 0, lockedUntil: 0, passwordResetAt: new Date().toISOString() });
    return json({ ok: true });
  }
  if (action === 'debloquer') { await comptes.setJSON(key, { ...user, fails: 0, lockedUntil: 0 }); return json({ ok: true }); }
  if (action === 'supprimer') {
    if (normEmail(user.email) === normEmail(me.email) || adminList(adminEmails).includes(normEmail(user.email))) return json({ error: 'Le compte administrateur ne peut pas être supprimé.' }, 400);
    // le compte d'abord (plus de connexion possible), puis ses données ; une erreur est renvoyée clairement
    try { await comptes.delete(key); } catch (e) { return json({ error: 'Suppression impossible pour le moment (stockage indisponible). Réessaie.' }, 500); }
    const reste = [];
    try { await historiques.delete('u/' + user.id); } catch (e) { reste.push('historique'); }
    try { await comptes.delete('c/' + createHash('sha256').update(normEmail(user.email)).digest('hex')); } catch (e) {}
    const alt = userKeyOf(user.email); if (alt !== key) { try { await comptes.delete(alt); } catch (e) {} }
    if (activite) { try { await activite.delete('p/' + String(user.id).replace(/[^a-f0-9]/gi, '').slice(0, 12)); } catch (e) {} }
    if (await comptes.get(key, { type: 'json' })) return json({ error: 'Le compte n’a pas pu être supprimé. Réessaie.' }, 500);
    return json({ ok: true, email: user.email, reste });
  }
  return json({ error: 'Action inconnue' }, 404);
}
