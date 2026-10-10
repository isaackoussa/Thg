# Analyste Bancaire UMOA

Application web d'analyse des états financiers des banques de l'UMOA (PCB révisé, dispositif prudentiel BCEAO / Bâle III).
Les principes du projet sont dans [PRINCIPES.md](PRINCIPES.md).

## Structure
- `app/index.html` : l'application, en un seul fichier. C'est la source unique.
- `public/` : icônes (SVG source + PNG générés par `npm run icons`).
- `scripts/build.mjs` : construit le site Netlify dans `dist/` (document HTML complet, manifeste, service worker hors ligne).
- `tests/run.mjs` : tests de robustesse dans Chromium (calculs, import, données abîmées, parcours, affichage, parité avec R).
- `donnees/` : jeux de données d'exemple.

## Commandes
```bash
npm install        # installe Playwright (tests et icônes)
npm run build      # construit dist/
npm test           # construit puis teste (Rscript pour la parité R ; LibreOffice avec libreoffice-math pour vérifier le rapport Word)
```

## Comptes (historique lié à une adresse e-mail)
- `netlify/functions/historique.mjs` : point d'entrée `/api/historique` (GET, PUT), utilisateur via `@netlify/identity`, stockage `@netlify/blobs` (store `historiques`).
- `server/historique.mjs` : logique (fusion, validation, contrôle d'origine), testée sans Netlify.
- À activer une fois : tableau de bord Netlify → projet → **Identity** → *Enable Identity*. Garder les e-mails de confirmation actifs.
- Les fonctions ne sont déployées que si le dépôt est relié à Netlify (ou via la CLI) : le dépôt manuel du dossier `dist` ne les contient pas.

## Déploiement Netlify
`netlify.toml` configure tout : commande `node scripts/build.mjs`, dossier publié `dist`, en-têtes de sécurité.
Sur iPhone, ouvre le site dans Safari puis Partager → « Sur l'écran d'accueil » pour l'installer avec son icône.
