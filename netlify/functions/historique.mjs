// Point d'entrée Netlify : /api/historique (GET pour lire, PUT pour fusionner et enregistrer).
// L'utilisateur est celui du cookie de session posé par /api/compte.
import { getStore } from '@netlify/blobs';
import { handleHistorique } from '../../server/historique.mjs';
import { userFromRequest, appBlocked } from '../../server/compte.mjs';

export default async (req) => {
  const comptes = getStore({ name: 'comptes', consistency: 'strong' });
  return handleHistorique(req, {
    getUser: () => userFromRequest(req, comptes),
    blocked: u => appBlocked(comptes, u, Netlify.env.get('ADMIN_EMAILS')),
    store: getStore({ name: 'historiques', consistency: 'strong' })
  });
};

export const config = { path: '/api/historique', method: ['GET', 'PUT'] };
