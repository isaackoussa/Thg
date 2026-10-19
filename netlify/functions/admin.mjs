// Partie admin : /api/admin/moi|comptes|stats|analyses|direct|reglages|verrous (GET), /api/admin/motdepasse|debloquer|supprimer|reglages|verrous|acces (POST)
import { getStore } from '@netlify/blobs';
import { handleAdmin } from '../../server/admin.mjs';

export default async (req, context) => handleAdmin(req, context.params.action, {
  comptes: getStore({ name: 'comptes', consistency: 'strong' }),
  historiques: getStore({ name: 'historiques', consistency: 'strong' }),
  activite: getStore({ name: 'activite', consistency: 'strong' }),
  adminEmails: Netlify.env.get('ADMIN_EMAILS'),
  env: k => Netlify.env.get(k)
});

export const config = { path: '/api/admin/:action', method: ['GET', 'POST'] };
