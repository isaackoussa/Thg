// Comptes : /api/compte/code, /api/compte/verifier (connexion par code e-mail), /api/compte/inscription, /api/compte/connexion, /api/compte/deconnexion, /api/compte/deverrouiller (POST), /api/compte/moi, /api/compte/config (GET)
import { getStore } from '@netlify/blobs';
import { handleCompte } from '../../server/compte.mjs';

export default async (req, context) => handleCompte(req, context.params.action, {
  store: getStore({ name: 'comptes', consistency: 'strong' }),
  geo: context.geo,
  env: k => Netlify.env.get(k),
  adminEmails: Netlify.env.get('ADMIN_EMAILS'),
  // entrée de l'app réservée aux personnes connectées par e-mail (ACCES_LIBRE=1 pour la désactiver)
  gate: Netlify.env.get('ACCES_LIBRE') !== '1'
});

export const config = { path: '/api/compte/:action', method: ['GET', 'POST'] };
