// Journal d'activité : /api/activite (POST) — actions des utilisateurs connectés et présence en ligne
import { getStore } from '@netlify/blobs';
import { handleActivite } from '../../server/activite.mjs';
import { userFromRequest } from '../../server/compte.mjs';

export default async (req, context) => handleActivite(req, {
  getUser: () => userFromRequest(req, getStore({ name: 'comptes', consistency: 'strong' })),
  store: getStore({ name: 'activite', consistency: 'strong' }),
  geo: context.geo
});

export const config = { path: '/api/activite', method: ['POST'] };
