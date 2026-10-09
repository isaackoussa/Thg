# Analyse financière bancaire — UEMOA : principes du projet

Document de référence validé avant le développement. Toute évolution de l'app doit rester cohérente avec ce document.

## 1. Objectif

Une app web (iPhone et ordinateur, sans installation) qui analyse les états financiers d'une banque de l'UEMOA sur **3 exercices (N-2, N-1, N)**.
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
3. **Import photo/PDF** : extraction automatique, puis **validation obligatoire par l'utilisateur** avant calcul

## 6. Principes techniques
- App web autonome, adaptée au mobile
- Données stockées **sur l'appareil** de l'utilisateur ; plusieurs banques peuvent être enregistrées
- Formules rendues en notation mathématique
- Chaque formule vit à un seul endroit du code, ce qui garantit que la formule affichée et le calcul effectué sont identiques
- Code versionné dans ce dépôt

## 7. Livraison par étapes
1. Cœur : saisie manuelle et modules 1 à 4 avec formules, graphiques et interprétations
2. Import Excel/CSV
3. Import photo/PDF
4. Validation sur une banque réelle tirée du fascicule BCEAO 2023
