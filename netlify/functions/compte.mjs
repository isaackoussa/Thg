// Comptes : /api/compte/inscription, /api/compte/connexion, /api/compte/deconnexion (POST), /api/compte/moi (GET)
import { getStore } from '@netlify/blobs';
import { handleCompte } from '../../server/compte.mjs';

export default async (req, context) => handleCompte(req, context.params.action, {
  store: getStore({ name: 'comptes', consistency: 'strong' })
});

export const config = { path: '/api/compte/:action', method: ['GET', 'POST'] };
