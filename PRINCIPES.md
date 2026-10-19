# Analyse financière bancaire — UEMOA : principes du projet

Document de référence validé avant le développement. Toute évolution de l'app doit rester cohérente avec ce document.

## 1. Objectif

Une app web (iPhone et ordinateur, sans installation) qui analyse les états financiers d'une banque de l'UEMOA sur **autant d'exercices que voulu** (ajout ou retrait libre), avec une **période d'analyse au choix** (du … au …).
L'utilisateur saisit les données, l'app calcule tout, **montre les formules** et donne une première interprétation.

Chaque indicateur est affiché en 4 temps :

1. **Formule** (notation mathématique)
2. **Formule avec les chiffres saisis**
3. **Résultat** (par année + variation)
4. **Interprétation** : tendance, comparaison au seuil réglementaire, signal vert, orange ou rouge

## 2. Référentiel

- **PCB révisé de l'UMOA** (BCEAO, en vigueur depuis 2018), format du *Fascicule des bilans et comptes de résultat des banques et établissements financiers de l'UMOA*.
- Unité par défaut : **millions de FCFA** (modifiable).

### 2.1 Bilan — Actif
| Code | Poste |
|---|---|
| A1 | Caisse, banque centrale, CCP |
| A2 | Effets publics et valeurs assimilées |
| A3 | Créances interbancaires et assimilées |
| A4 | Créances sur la clientèle |
| A5 | Obligations et autres titres à revenu fixe |
| A6 | Actions et autres titres à revenu variable |
| A7 | Actionnaires ou associés |
| A8 | Autres actifs |
| A9 | Comptes de régularisation |
| A10 | Participations et autres titres détenus à long terme |
| A11 | Parts dans les entreprises liées |
| A12 | Prêts subordonnés |
| A13 | Immobilisations incorporelles |
| A14 | Immobilisations corporelles |
| **TA** | **Total actif** |

### 2.2 Bilan — Passif
| Code | Poste |
|---|---|
| P1 | Banques centrales, CCP |
| P2 | Dettes interbancaires et assimilées |
| P3 | Dettes à l'égard de la clientèle (dépôts) |
| P4 | Dettes représentées par un titre |
| P5 | Autres passifs |
| P6 | Comptes de régularisation |
| P7 | Provisions |
| P8 | Emprunts et titres émis subordonnés |
| P9 | Capitaux propres et ressources assimilées (capital, primes, réserves, écarts de réévaluation, provisions réglementées, report à nouveau, résultat de l'exercice) |
| **TP** | **Total passif** (doit être égal à TA ; l'app contrôle l'équilibre) |

### 2.3 Compte de résultat (présentation en cascade)
```
  Intérêts et produits assimilés
− Intérêts et charges assimilées
= MARGE D'INTÉRÊTS
+ Revenus des titres à revenu variable
+ Commissions (produits) − Commissions (charges)
± Gains ou pertes nets sur opérations des portefeuilles de négociation
± Gains ou pertes nets sur opérations des portefeuilles de placement
+ Autres produits − Autres charges d'exploitation bancaire
= PRODUIT NET BANCAIRE (PNB)
− Charges générales d'exploitation
− Dotations aux amortissements et dépréciations des immobilisations
= RÉSULTAT BRUT D'EXPLOITATION (RBE)
− Coût du risque
= RÉSULTAT D'EXPLOITATION
± Gains ou pertes nets sur actifs immobilisés
= RÉSULTAT AVANT IMPÔT
− Impôts sur les bénéfices
= RÉSULTAT NET (RN)
```

### 2.4 Données prudentielles facultatives
Fonds propres de base durs (CET1), Tier 1, fonds propres effectifs totaux, actifs pondérés par les risques (RWA), exposition de levier, actifs liquides, passifs exigibles à court terme, emplois et ressources à moyen/long terme.
Si elles sont saisies, l'app calcule **aussi** la version réglementaire (Bâle II/III) de chaque ratio.

## 3. Modules

### Module 1 — Dynamique du bilan et du compte de résultat
Pour **chaque poste** et chaque année :
- Variation absolue : `ΔX = X(N) − X(N-1)`
- Variation relative : `ΔX% = (X(N) − X(N-1)) / X(N-1)`
- Taux de croissance annuel moyen sur la période : `TCAM = (X(N) / X(N-2))^(1/2) − 1`
- Structure (poids) : `X / Total actif` pour le bilan, `X / PNB` pour le compte de résultat
- Graphiques d'évolution et commentaire automatique des principaux postes qui progressent ou reculent

### Module 2 — Ratios de structure (version simplifiée + version réglementaire)
| Ratio | Version simplifiée (bilan) | Version réglementaire (si données) |
|---|---|---|
| Transformation | Crédits clientèle / Dépôts clientèle = A4 / P3 | Ressources stables / Emplois MLT |
| Liquidité | Actifs liquides / Passifs exigibles CT ≈ (A1+A2+A3) / (P1+P2+P3) | Coefficient de liquidité ; LCR = HQLA / Sorties nettes 30 j |
| Levier | Capitaux propres / Total actif = P9 / TA (et multiplicateur TA / P9) | Tier 1 / Exposition de levier |
| Solvabilité | (P9 + P8) / Total actif | CET1 / RWA, Tier 1 / RWA, Fonds propres totaux / RWA |

### Module 3 — Rentabilité
- `ROA = RN / Total actif`
- `ROE = RN / Capitaux propres`
- Décomposition : `ROE = ROA × (Total actif / Capitaux propres)` ; on identifie ce qui explique l'évolution du ROE : la rentabilité des actifs ou l'effet de levier
- Variante sur moyennes `(X(N) + X(N-1)) / 2` disponible en option

### Module 4 — Test de faillite
- La banque est en faillite lorsque les pertes absorbent les capitaux propres : **perte critique = −Capitaux propres**, soit `RN* = −P9`
- Comme l'impôt est nul en cas de perte, on remonte la cascade du compte de résultat :
  `PNB* = RN* + Charges générales + Amortissements + Coût du risque ∓ Gains/pertes sur actifs immobilisés`
- Indicateurs : `PNB*`, chute de PNB nécessaire `PNB − PNB*`, et en % `(PNB − PNB*) / PNB`
- Variante : coût du risque critique à PNB constant

### Indicateurs complémentaires
- Coefficient d'exploitation = (Charges générales + Amortissements) / PNB
- Coût du risque / Créances clientèle
- Marge d'intérêts / PNB, Commissions nettes / PNB
- Rendement des crédits, coût des dépôts (si détail disponible)
- Synthèse automatique : points forts, points de vigilance
- Export PDF et Excel

## 4. Seuils réglementaires (préremplis, **modifiables** dans l'app)
Valeurs par défaut issues du dispositif prudentiel UMOA (Bâle II/III, BCEAO). À vérifier sur la version en vigueur :
| Ratio | Seuil par défaut |
|---|---|
| CET1 / RWA | ≥ 7,5 % |
| Tier 1 / RWA | ≥ 8,5 % |
| Solvabilité totale | ≥ 11,5 % |
| Levier (Tier 1 / Exposition) | ≥ 3 % |
| Coefficient de liquidité | ≥ 75 % |
| Couverture des emplois MLT par ressources stables | ≥ 50 % |
| Coefficient d'exploitation (repère d'analyse, pas une norme) | ≤ 60 % |

## 5. Saisie des données
1. **Formulaire manuel** : poste par poste, totaux et soldes intermédiaires calculés automatiquement, contrôle actif = passif
2. **Import Excel/CSV** : modèle téléchargeable avec les codes A1… P9 et les postes du compte de résultat
3. **Cases vides = 0** : à l'import, une case vide ou un tiret (« - ») vaut zéro pour l'exercice concerné ; un poste dont toute la ligne est vide vaut zéro et ne prend jamais les chiffres de la ligne suivante. Seule une case illisible sur une photo reste vide, pour être complétée.
4. **Import de fichiers** : Excel (.xlsx, .xls, .ods), Word (.docx), PDF (recherche de la banque par son nom dans le fascicule), photos (lues par Claude dans claude.ai, par reconnaissance de texte Tesseract sur le site Netlify). Extraction automatique, puis **validation obligatoire par l'utilisateur** avant calcul

## 6. Principes techniques
- App web autonome, adaptée au mobile
- Données stockées **sur l'appareil** de l'utilisateur ; plusieurs banques peuvent être enregistrées
- Formules rendues en notation mathématique
- Chaque formule vit à un seul endroit du code, ce qui garantit que la formule affichée et le calcul effectué sont identiques
- Code versionné dans ce dépôt

## 6 quinquies. Entrée par e-mail et compte
Sur le site Netlify, **l'app demande une adresse e-mail à l'ouverture**, comme Anglais 365 : on saisit son e-mail, on reçoit un **code à 6 chiffres** (envoyé par Brevo, valable 10 minutes, 5 essais, renvoi après 30 secondes), et l'app s'ouvre. Pas de mot de passe ; le compte est créé à la première connexion et la session dure **un an** sur l'appareil (cookie HttpOnly signé). Le code n'est jamais stocké en clair (empreinte SHA-256).
- Réglages Netlify : `BREVO_API_KEY` et `MAIL_FROM` (adresse expéditrice validée dans Brevo), facultatif `MAIL_FROM_NAME`. Tant qu'ils manquent, l'écran d'entrée propose l'e-mail + mot de passe. `MAIL_DRY_RUN=1` écrit le code dans les journaux au lieu de l'envoyer ; `ACCES_LIBRE=1` supprime l'écran d'entrée.
- Les comptes créés avant gardent leur mot de passe et peuvent aussi entrer par code.
- **Chaque compte ne voit que ses propres données** : les banques et l'historique de l'appareil sont marqués au nom du compte connecté. À la déconnexion, ils sont retirés de l'appareil (ils restent sur le compte) ; si un autre compte se connecte sur le même appareil, il ne récupère rien du précédent et rien du précédent n'est envoyé sur son compte.
- À la connexion, toutes les banques du compte s'affichent ; la version modifiée le plus récemment l'emporte, les suppressions se propagent. Fonctions `/api/compte/*` (server/compte.mjs) et `/api/historique` (server/historique.mjs) : un document par compte dans Netlify Blobs, fusion des appareils (union, suppressions propagées, plafond de 60).
- Dans claude.ai (aperçu), il n'y a pas de partie serveur : l'app reste libre d'accès et l'historique reste sur l'appareil.

## 6 sexies. Console d'administration
**Une page entièrement à part** (`/admin`, fichier `app/admin.html`), comme MasterGraf / SMC Lab : elle ne charge aucun code de l'app, l'app n'a aucun bouton ni code de console. Entrée par **clé admin** (`ADMIN_KEY`, variable Netlify) — sans compte utilisateur ; la clé est gardée le temps de la session du navigateur, jamais dans l'adresse ; 8 mauvaises clés bloquent la console 15 minutes ; bouton « Se déconnecter » qui oublie la clé. Sans `ADMIN_KEY`, repli sur le compte administrateur (`ADMIN_EMAILS`) ouvert avec un code e-mail.
- **En direct** (mis à jour toutes les 10 s) : qui est en ligne (appareil, ville, onglet ouvert, banque, depuis quand, app au premier plan ou en arrière-plan), qui est passé dans les 24 h, et le **fil des actions** de chacun (connexion, ouverture, onglet consulté, banque choisie ou créée, saisie, import, rapport Word, code R, analyse enregistrée ou restaurée, export, paramètre, style). Filtres par compte et « actions importantes » ; nouvelles actions mises en évidence ; notifications du navigateur et petit son au choix.
- **Tableau de bord** : comptes, en ligne, actifs 7 et 30 jours, actions, banques, analyses ; activité et actions par jour sur 30 jours ; heures d'affluence ; banques les plus analysées.
- **Comptes** : liste (point vert = en ligne), fiche de chaque compte (appareils, connexions, actions des 30 derniers jours, banques et analyses en lecture seule avec copie possible), nouveau mot de passe, déblocage, suppression.
- **Réglages** : alertes par e-mail à l'admin (nouvelle inscription — activée par défaut —, nouvel appareil, chaque connexion), même console fermée ; notifications du navigateur.
- Journal d'activité : fonction `/api/activite` (server/activite.mjs), lots d'actions et présence (signal chaque minute) dans Netlify Blobs (store `activite`), conservés 30 jours. Aucune adresse IP. L'écran d'entrée indique que l'activité est enregistrée.

## 6 quater. Rapport Word
L'onglet « Rapport Word » génère un .docx selon **sept modèles**, au choix du lecteur visé :
1. **Rapport complet** : couverture, sommaire, synthèse (chiffres clés, note globale, tableau de bord, points forts et de vigilance), dynamique des comptes, ratios de structure, rentabilité et Du Pont, test de faillite, Bâle III, conclusion et recommandations, méthodologie et glossaire. Formules en vraies équations Word (formule puis application numérique), tableaux, graphiques et interprétations ; parties au choix.
2. **Note de synthèse** (3 à 5 pages, sans formules) pour un décideur : l'essentiel en une page, tableau de bord, quatre graphiques, analyse, recommandations.
3. **Conformité prudentielle** : verdict, normes BCEAO / Bâle III et repères par exercice, excédent ou déficit de fonds propres (CET1, Tier 1, solvabilité, levier) et actifs pondérés encore finançables, stress tests (PNB −20 % / −50 %, coût du risque ×2 / ×3, défaut de 5 % / 10 % des crédits), résistance à la faillite.
4. **Corrigé de TD** : énoncé puis les neuf questions du cours (dynamique du bilan et du compte de résultat, transformation, liquidité, levier, solvabilité, ROA/ROE, pertes et PNB de faillite), chacune avec formule, application numérique pour chaque année, réponse et encadré « À retenir ».
5. **Comparaison de banques** : plusieurs banques sur leur dernier exercice, classement par note globale, chiffres clés, ratios avec statut, graphiques, lecture ratio par ratio.
6. **Dossier multi-banques** : toutes les banques traitées (ou celles cochées, boutons « Tout cocher / Tout décocher ») réunies dans un seul document. Couverture et sommaire, vue d'ensemble comparée (classement, chiffres clés, ratios — dès deux banques), puis une partie par banque sur sa propre période : chiffres clés, note globale, avis, tableau de bord, quatre graphiques, points forts, points de vigilance et recommandations. Niveau de détail au choix : *synthèse* ou *analyse détaillée* (en plus, dynamique des comptes et chaque ratio expliqué). Méthodologie et glossaire communs à la fin. La banque et l'exercice affichés dans l'app ne changent pas.
7. **Dossier multi-banques : questions du TD** : mêmes banques au choix, et pour chacune les quatre parties du TD résolues — (1) analyse du bilan et du compte de résultat, dynamique de chaque compte d'une année à l'autre (tableaux avec variations, structure, graphiques) ; (2) ratios de transformation, de liquidité, de levier (et multiplicateur) et de solvabilité (bilan et Bâle) ; (3) ROA et ROE de chaque année, dynamique et décomposition de Du Pont ; (4) pertes qui provoqueraient la faillite (RN* = −capitaux propres) puis PNB critique. Chaque ratio : formule, application numérique pour chaque année, lecture et encadré « À retenir » ; conclusion par banque. Énoncé commun en tête et vue d'ensemble comparée dès deux banques. Style pédagogique par défaut.

**Style de rédaction**, au choix ou automatique selon le modèle :
- *Académique* (mémoire, rapport de stage) : phrases rédigées, « nous observons », introduction de chaque partie et conclusion argumentée ;
- *Professionnel* (note d'analyste bancaire) : niveau, écart et verdict d'abord, lecture ensuite ; conclusion en « Verdict » ;
- *Pédagogique* (TD) : « Ce que l'on observe / Comment l'interpréter / Par rapport au seuil », conclusion « Que retenir ? » ;
- *Synthétique* : les points clés en puces (niveau, évolution, seuil, lecture).
- *Mon style personnel* : la façon d'écrire de chaque utilisateur. Il la règle (personne « nous / je / on / impersonnel », registre soutenu / courant / direct, longueur, ses connecteurs, ses formules d'ouverture avec repères {ratio} {verbe} {v1} {v2} {a1} {a2} {ecart} {tendance}, mots à remplacer, phrase de fin ou signature) ou colle un texte qu'il a écrit et l'app en déduit le pronom, le registre, la longueur des phrases et les connecteurs favoris. Aperçu immédiat sur la banque en cours ; style enregistré sur l'appareil et sur le compte.
Dans chaque style, les tournures changent d'un ratio à l'autre (plusieurs formulations en rotation) et décrivent la trajectoire (hausse continue, recul puis redressement…), l'ampleur (légère, nette, forte) et la marge par rapport au seuil.

Communs à tous : quatre jeux de couleurs, bandeau de couverture, en-tête et pied de page « page X sur Y », **note globale indicative** (A à E, sur 100, pondérée sur solvabilité, CET1, levier, liquidité, transformation, ROE, ROA, coefficient d'exploitation, coût du risque ; ce n'est pas une notation officielle) et recommandations générées à partir des ratios hors seuil.

## 6 ter. Historique d'analyse
L'onglet « Historique » enregistre des instantanés : copie des données de la banque, paramètres et résultats clés de tous les exercices. Chaque entrée peut être revue, comparée à l'état actuel ou à une autre entrée, et restaurée (l'état remplacé est d'abord sauvegardé). Un import crée une entrée automatique. 60 entrées au plus, conservées sur l'appareil et incluses dans la sauvegarde JSON.

## 6 bis. Traduction en R
L'onglet « Code R » traduit les calculs en R à partir des mêmes arbres de formules que l'app, en **quatre styles** :
1. **Complet** (R de base, sans package) : données, paramètres, grandeurs, tous les indicateurs, conformité aux seuils, 14 graphiques (écran, PNG, PDF, et Word si le package officer est installé).
2. **Essentiel** (R de base, court) : seulement les chiffres utiles, les ratios clés, un tableau de bord, un « verdict express » OK / ALERTE et deux graphiques.
3. **Moderne** (dplyr, tidyr, ggplot2) : tout le calcul dans un seul `mutate()`, ratios en format long avec statut, quatre graphiques ggplot2 enregistrés en PNG.
4. **Rapport R Markdown** (.Rmd) : rapport rédigé dont les chiffres du texte sont calculés par R ; « Knit » produit un Word ou une page HTML.

Les scripts .R sont 100 % ASCII (accents des textes en \uXXXX) ; le .Rmd est en UTF-8. Les tests vérifient que les styles complet, essentiel et moderne donnent les mêmes valeurs que l'app et que le R Markdown se rend en Word et en HTML.

## 7. Livraison par étapes
1. Cœur : saisie manuelle et modules 1 à 4 avec formules, graphiques et interprétations
2. Import Excel/CSV
3. Import photo/PDF
4. Validation sur une banque réelle tirée du fascicule BCEAO 2023
