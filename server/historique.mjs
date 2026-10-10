// Historique d'analyse par compte (adresse e-mail Netlify Identity).
// Un document JSON par utilisateur ; la fusion se fait ici pour qu'aucun appareil n'écrase l'autre.
// Les dépendances (utilisateur courant, stockage) sont injectées : la fonction Netlify passe
// getUser() de @netlify/identity et un store @netlify/blobs, les tests passent des doublures.

export const HIST_MAX = 60;
export const DELETED_MAX = 1000;
export const MAX_BODY = 3_500_000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const validEntry = e => e && typeof e === 'object' && typeof e.id === 'string' && e.id.length <= 64
  && typeof e.at === 'string' && e.bank && typeof e.bank === 'object' && e.res && typeof e.res === 'object';

// Union des deux historiques, sans les entrées supprimées, plus récentes d'abord, plafonnée :
// au-delà du plafond, les entrées automatiques partent avant les entrées enregistrées à la main.
export function mergeHistory(a, b) {
  const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])].filter(x => typeof x === 'string'))].slice(-DELETED_MAX);
  const gone = new Set(deleted);
  const byId = new Map();
  for (const e of [...(a.history || []), ...(b.history || [])]) {
    if (!validEntry(e) || gone.has(e.id)) continue;
    const prev = byId.get(e.id);
    if (!prev || String(e.at) > String(prev.at)) byId.set(e.id, e);
  }
  let history = [...byId.values()].sort((x, y) => (String(y.at) > String(x.at) ? 1 : String(y.at) < String(x.at) ? -1 : 0));
  while (history.length > HIST_MAX) {
    const kinds = history.map(x => x.kind);
    let i = kinds.lastIndexOf('auto');
    if (i < 0) i = kinds.lastIndexOf('import');
    if (i < 0) i = history.length - 1;
    history.splice(i, 1);
  }
  return { history, deleted };
}

export async function handleHistorique(req, { getUser, store }) {
  if (req.method !== 'GET' && req.method !== 'PUT') return json({ error: 'Méthode non autorisée' }, 405);
  const user = await getUser();
  if (!user || !user.id) return json({ error: 'Connexion requise' }, 401);
  const key = 'u/' + user.id;
  let stored = null;
  try { stored = await store.get(key, { type: 'json' }); } catch (e) { stored = null; }
  stored = stored && typeof stored === 'object' ? stored : { history: [], deleted: [] };
  if (req.method === 'GET') return json({ history: stored.history || [], deleted: stored.deleted || [], updatedAt: stored.updatedAt || null, email: user.email || null });

  // Écriture : même origine uniquement (protection CSRF, l'authentification passe par cookie)
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return json({ error: 'Origine refusée' }, 403);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'Historique trop volumineux' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'JSON invalide' }, 400); }
  if (!body || !Array.isArray(body.history) || (body.deleted !== undefined && !Array.isArray(body.deleted))) return json({ error: 'Format attendu : { history: [], deleted: [] }' }, 400);
  const merged = mergeHistory(stored, { history: body.history, deleted: body.deleted || [] });
  const doc = { ...merged, updatedAt: new Date().toISOString(), email: user.email || null };
  await store.setJSON(key, doc);
  return json(doc);
}
