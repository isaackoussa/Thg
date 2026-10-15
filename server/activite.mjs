// Journal d'activité des utilisateurs connectés (pour la console admin, « en direct »).
// L'app envoie par lots ce que fait l'utilisateur (onglet ouvert, import, rapport, code R…) et un signal
// de présence chaque minute. Un lot = un blob « e/<date ISO>-<uid>-<nombre d'actions> » : la clé suffit
// pour compter l'activité par heure ou par jour sans relire les lots. Présence : « p/<uid> ».
import { parseDevice } from './compte.mjs';
import { randomBytes } from 'node:crypto';

export const KEEP_DAYS = 30, ONLINE_MS = 3 * 60 * 1000;
const MAX_EVENTS = 40, MAX_BODY = 20000;
export const EVENT_TYPES = ['ouverture', 'connexion', 'deconnexion', 'onglet', 'banque', 'nouvelle_banque', 'saisie', 'import', 'rapport', 'code_r', 'analyse', 'restauration', 'export', 'parametres', 'style', 'admin'];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const uidShort = id => String(id).replace(/[^a-f0-9]/gi, '').slice(0, 12) || 'x';
function placeOf(geo) {
  if (!geo) return '';
  const country = geo.country && (geo.country.name || geo.country.code) || '';
  return [geo.city, country].filter(Boolean).join(', ').slice(0, 80);
}
export const batchKey = (iso, uid, n) => 'e/' + iso + '-' + uidShort(uid) + '-' + n + '-' + randomBytes(2).toString('hex');
export function parseKey(k) {
  const m = /^e\/(\d{4}-\d\d-\d\dT[\d:.]+Z)-([a-f0-9x]+)-(\d+)-[a-f0-9]+$/i.exec(k);
  return m ? { at: m[1], uid: m[2], n: +m[3] } : null;
}

export async function handleActivite(req, { getUser, store, geo, now = Date.now() }) {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  const user = await getUser();
  if (!user) return json({ error: 'Connexion requise' }, 401);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'Envoi trop volumineux' }, 413);
  let body; try { body = JSON.parse(raw); } catch (e) { return json({ error: 'Requête invalide' }, 400); }
  const events = (Array.isArray(body && body.events) ? body.events : []).slice(-MAX_EVENTS)
    .filter(e => e && EVENT_TYPES.includes(e.type))
    .map(e => ({ at: Number.isFinite(Date.parse(e.at)) && Math.abs(Date.parse(e.at) - now) < 864e5 ? new Date(Date.parse(e.at)).toISOString() : new Date(now).toISOString(), type: e.type, d: clip(e.d, 160) }));
  const dev = parseDevice(req.headers.get('user-agent'), req.headers.get('x-appareil'));
  const lieu = placeOf(geo), iso = new Date(now).toISOString();
  const ctx = { tab: clip(body.tab, 40), bank: clip(body.bank, 120) };
  const pkey = 'p/' + uidShort(user.id);
  const prev = await store.get(pkey, { type: 'json' });
  // présence : début de la visite si la précédente est terminée depuis plus de 3 minutes
  const since = prev && now - Date.parse(prev.at) < ONLINE_MS ? prev.since : iso;
  await store.setJSON(pkey, { uid: user.id, email: user.email, at: iso, since, ...ctx, appareil: dev.label, type: dev.type, lieu, visible: body.visible !== false });
  if (events.length) await store.setJSON(batchKey(iso, user.id, events.length), { uid: user.id, email: user.email, appareil: dev.label, type: dev.type, lieu, ...ctx, events });
  // ménage : de temps en temps, on efface les lots de plus de 30 jours
  if (Math.random() < 0.05) {
    try {
      const old = new Date(now - (KEEP_DAYS + 1) * 864e5).toISOString().slice(0, 10);
      const { blobs } = await store.list({ prefix: 'e/' + old });
      await Promise.all(blobs.map(b => store.delete(b.key)));
    } catch (e) { /* sans gravité */ }
  }
  return json({ ok: true, enregistres: events.length });
}

/* Lecture pour l'admin */
async function keysOfDays(store, days, now) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 864e5).toISOString().slice(0, 10);
    const { blobs } = await store.list({ prefix: 'e/' + day });
    out.push(...blobs.map(b => b.key));
  }
  return out.sort();
}
const flat = (batches) => batches.flatMap(b => (b.events || []).map(e => ({ ...e, email: b.email, uid: b.uid, appareil: b.appareil, appType: b.type, lieu: b.lieu, bank: e.type === 'banque' ? e.d : b.bank })))
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));
export async function liveFeed(store, { now = Date.now(), since = '', limit = 200, uid = '' } = {}) {
  let keys = await keysOfDays(store, 2, now);
  if (since) keys = keys.filter(k => (parseKey(k) || {}).at > since);
  if (uid) keys = keys.filter(k => (parseKey(k) || {}).uid === uidShort(uid));
  keys = keys.slice(-80);
  const batches = (await Promise.all(keys.map(k => store.get(k, { type: 'json' })))).filter(Boolean);
  const { blobs } = await store.list({ prefix: 'p/' });
  const pres = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
  const online = pres.filter(p => now - Date.parse(p.at) < ONLINE_MS).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const recent = pres.filter(p => now - Date.parse(p.at) >= ONLINE_MS && now - Date.parse(p.at) < 864e5).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { now: new Date(now).toISOString(), enLigne: online, recents: recent, events: flat(batches).slice(0, limit) };
}
export async function userActivity(store, uid, { now = Date.now(), limit = 300 } = {}) {
  const keys = (await keysOfDays(store, KEEP_DAYS, now)).filter(k => (parseKey(k) || {}).uid === uidShort(uid)).slice(-60);
  const batches = (await Promise.all(keys.map(k => store.get(k, { type: 'json' })))).filter(Boolean);
  return flat(batches).slice(0, limit);
}
// Activité par heure (7 jours) et par jour (30 jours), à partir des seules clés
export async function activityStats(store, { now = Date.now() } = {}) {
  const keys = await keysOfDays(store, KEEP_DAYS, now);
  const heures = Array(24).fill(0), jours = {}, users = {};
  const week = new Date(now - 7 * 864e5).toISOString();
  keys.forEach(k => {
    const p = parseKey(k); if (!p) return;
    jours[p.at.slice(0, 10)] = (jours[p.at.slice(0, 10)] || 0) + p.n;
    if (p.at >= week) { heures[new Date(p.at).getUTCHours()] += p.n; users[p.uid] = (users[p.uid] || 0) + p.n; }
  });
  return { heures, jours, actions7: heures.reduce((a, b) => a + b, 0), actifsSemaine: Object.keys(users).length };
}
