// Point d'entrée Netlify : /api/historique (GET pour lire, PUT pour fusionner et enregistrer).
import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { handleHistorique } from '../../server/historique.mjs';

export default async (req) => handleHistorique(req, {
  getUser,
  store: getStore({ name: 'historiques', consistency: 'strong' })
});

export const config = { path: '/api/historique', method: ['GET', 'PUT'] };
