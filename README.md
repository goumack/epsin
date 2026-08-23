# EPSIN — Logiciel de gestion scolaire

Application web complète de gestion d'établissement scolaire, adaptée au système
francophone (notes sur 20, moyennes coefficientées, trimestres, mentions, FCFA).

**Stack** : React 18 + Vite + Tailwind CSS · Node.js/Express · PostgreSQL 16

---

## Démarrage rapide

### 1. Base de données

```bash
docker compose up -d
```

PostgreSQL démarre sur le port **5440**. Sans Docker, créez une base `epsin`
et adaptez `DATABASE_URL` dans `server/.env`.

### 2. Backend

```bash
cd server
npm install
npm run migrate           # crée les 27 tables
npm run seed              # jeu de données de démonstration
npm run dev               # API sur http://localhost:4000
```

Un fichier `.env` fonctionnel est déjà fourni (base locale sur le port 5440).
**Ne le remplacez pas par `.env.example`** : ce dernier ne contient que des
valeurs génériques (`utilisateur:motdepasse`, port 5432) et provoquerait une
erreur `authentification par mot de passe échouée`. Il ne sert que de modèle
pour un déploiement sur un autre serveur.

### 3. Frontend

```bash
cd client
npm install
npm run dev               # interface sur http://localhost:5173
```

### Comptes de démonstration

| Identifiant | Rôle | Accès |
|---|---|---|
| `admin@epsin.sn` | Administrateur | Tout l'établissement |
| `directeur@epsin.sn` | **Directeur** | Entité **scolaire** (CI → CM2) uniquement |
| `principal@epsin.sn` | **Principal** | Entité **secondaire** (6ème → Terminale) |
| `censeur@epsin.sn` | Censeur | Entité **secondaire** uniquement — adjoint du principal, pas un rôle transverse |
| `comptable@epsin.sn` | Comptable | Finances (caisse commune), élèves |
| `maitre1@epsin.sn` | Enseignant | Maître polyvalent — sa classe élémentaire, 4 domaines CEB |
| `prof1@epsin.sn` | Enseignant | Moyen/secondaire — sa matière, plusieurs classes |
| `ep-2026-0014@epsin.sn` | **Tuteur** | Le suivi de son enfant uniquement (matricule + `@epsin.sn`) |

Mot de passe commun : **`epsin2026`**

---

## Fonctionnalités

### Structure : deux entités, deux directions

L'établissement est un groupe scolaire composé de **deux entités distinctes**,
chacune dirigée séparément :

| Entité | Cycles | Niveaux | Dirigée par | Examen |
|---|---|---|---|---|
| **Scolaire** | Élémentaire | CI, CP, CE1, CE2, CM1, CM2 | **Directeur** | CFEE |
| **Secondaire** | Moyen (collège/CEM) | 6ème → 3ème | **Principal**, secondé du **Censeur** | BFEM |
| | Secondaire (lycée) | Seconde → Terminale | **Principal**, secondé du **Censeur** | Baccalauréat |

**Le cloisonnement est strict et appliqué côté serveur.** Le directeur ne voit
que les élèves, classes, notes, absences et enseignants de l'élémentaire ; le
principal et le censeur uniquement ceux du moyen/secondaire. Le censeur
**n'est pas un rôle transverse** : c'est l'adjoint du principal (vie
scolaire, discipline), rattaché au CEM/lycée exactement comme lui — une
distinction volontaire par rapport à une première version qui le traitait
à tort comme voyant tout l'établissement. Toute tentative d'accès croisé
renvoie une erreur `403`, y compris par appel direct à l'API.

Deux exceptions volontaires :
- **L'administrateur** voit l'ensemble de l'établissement.
- **La comptabilité est commune** : une seule caisse, un seul comptable, une
  synthèse financière consolidée sur les deux entités.

Chaque **enseignant est rattaché à une seule entité** : un maître d'élémentaire
ne peut pas être affecté à une classe du collège, et l'API refuse l'affectation.

Les niveaux d'examen sont signalés par un badge sur la fiche de classe et un
rappel en tête du bulletin.

### Parcours scolaire pluriannuel

Un élève traverse plusieurs années : CM2 en 2023-2024, 6ème en 2024-2025,
5ème en 2025-2026… Chaque année est conservée avec **tout ce qui s'y
rattache**, consultable dans l'onglet **Parcours** de son dossier :

- la **classe et le niveau** de cette année-là
- les **moyennes de chaque trimestre** et la moyenne annuelle, avec
  l'évolution d'une année à l'autre (+1,09 / −2,85…)
- l'**assiduité** de l'année : absences, retards, non justifiées
- le **montant réglé** cette année-là
- la **décision de fin d'année**, avec son motif et qui l'a prise

Cinq décisions possibles en fin d'année :

| Décision | Effet |
|---|---|
| **Passe** | Admis en classe supérieure |
| **Redouble** | Refait la même classe, marqué redoublant |
| **Transféré** | Part dans un autre établissement (motif enregistré) |
| **Abandon** | A quitté l'école sans transfert |
| **Exclu** | Exclu par le conseil de discipline |

Les trois dernières font passer l'élève hors des effectifs actifs, sans
perdre son dossier : son parcours reste consultable.

**L'écran « Fin d'année »** (onglet de *Classes*, réservé à la direction)
liste toute la classe avec sa moyenne annuelle et une décision **proposée**
(≥ 10 : passe). On ajuste, on enregistre, puis *Passer à l'année suivante*
crée les inscriptions de la rentrée en une fois — classe d'accueil pour ceux
qui passent, classe de redoublement pour les autres. Les transferts et
abandons sont ignorés. L'opération est **rejouable sans créer de doublon**.

### Le bulletin au format officiel sénégalais

Le bulletin reproduit la maquette utilisée dans les établissements :

- **En-tête administratif** : IA (Inspection d'Académie), IEF et
  établissement — paramétrables dans la fiche établissement
- **Tableau** : `Devoir | Comp | Moy/20 | Coef | Moy × C | Rang | Appréciations`.
  Un enseignant pouvant saisir plusieurs devoirs, la colonne *Devoir* affiche
  leur **moyenne pondérée** ; la composition reste distincte.
- **Rang par matière**, calculé au sein de la classe, en plus du rang général
- **Appréciations littérales** déduites de la moyenne (« Excellent travail »,
  « Très Bon Travail », « Travail Insuffisant »…)
- Effectif de la classe, nombre de redoublants, retards et absences
- **Deux grilles de décision du conseil** : appréciation générale
  (Satisfaisant / Peut Mieux Faire / Insuffisant / Risque de Redoubler /
  Risque l'exclusion) et distinction (Félicitations / Encouragement /
  Tableau d'honneur / Avertissement / Blâme)
- Observations du conseil des professeurs et signature du chef d'établissement

Les décisions sont **pré-cochées d'après la moyenne** et restent modifiables.
Tant qu'elles ne sont pas arrêtées, une mention le signale à l'écran — elle
disparaît à l'impression.

**L'écran « Conseil de classe »** (onglet de *Notes et bulletins*, réservé à
l'encadrement) permet de tenir la séance sans ouvrir les dossiers un par un :
la classe entière s'affiche, classée par moyenne, avec pour chaque élève son
rang, ses absences, les deux listes déroulantes de décision pré-remplies et
une case **Redoublant**. Un bouton *Arrêter le conseil* enregistre l'ensemble ;
les décisions passent alors de « Proposé » à « Arrêté » et apparaissent sur
les bulletins.

Un élève **sans aucune note** (inscription récente) ne reçoit **aucune
proposition** — suggérer un redoublement faute de notes serait injuste. Sa
ligne est marquée « Sans note » et le conseil tranche lui-même.

Le statut redoublant se modifie depuis cet écran ou via
`PATCH /eleves/:id/redoublant` ; il alimente la mention « Classe Redoublée »
en en-tête du bulletin.

### Portail du tuteur

Chaque élève dispose d'un compte tuteur, dont l'identifiant est **le
matricule de l'enfant suivi de `@epsin.sn`** — par exemple
`ep-2026-0014@epsin.sn`. Un compte par enfant : le tuteur d'une fratrie se
connecte avec le matricule de l'enfant concerné.

Le tuteur accède à un espace **« Mon enfant »** à quatre onglets :

| Onglet | Contenu |
|---|---|
| **Scolarité** | Le bulletin de la période : matières, coefficients, moyennes, rang et mention |
| **Évolution** | La progression d'un trimestre à l'autre, avec points forts et matières à consolider |
| **Assiduité** | Absences et retards, leur statut, et le **signalement d'une absence** |
| **Finances** | Dû / payé / reste à payer, ligne par ligne |

**Signaler n'est pas justifier.** Le tuteur déclare une absence (maladie,
rendez-vous…) sur une ou plusieurs journées ; elle apparaît « À confirmer »
jusqu'à ce que la vie scolaire la valide. Un parent ne justifie pas seul
l'absence de son enfant — l'établissement tient le registre.

Le cloisonnement est strict et vérifié côté serveur : le tuteur ne voit que
**son enfant**, **sa classe** et **les enseignants qui interviennent auprès
de lui**. Le classement nominatif de la classe lui est refusé (`403`) — le
rang de son enfant lui est communiqué dans le bulletin, sans exposer les
résultats des camarades. Une requête forgée visant un autre élève est
ignorée au profit de son propre enfant.

### Ce qu'un enseignant voit — et ne voit pas

Le cloisonnement ne s'arrête pas à l'entité : un enseignant est en plus
limité à **ses propres classes et ses propres matières**.

| Situation | Classes visibles | Matières visibles dans un bulletin |
|---|---|---|
| **Maître** de l'élémentaire | sa seule classe (il en est le titulaire) | les 4 domaines du CEB — il les enseigne tous |
| **Professeur** du moyen/secondaire | celles où il a une affectation | **uniquement les siennes** |
| **Professeur principal** d'une classe | idem | **toutes**, pour préparer le conseil de classe |

Un professeur de mathématiques ne peut donc pas consulter la note
d'histoire-géographie d'un élève, sauf s'il est professeur principal de sa
classe. Un maître de CI ne voit ni les élèves ni les bulletins du CP.

**La moyenne générale et le rang restent toujours calculés sur l'intégralité
des matières** — seul le détail affiché est restreint, sinon le bulletin
serait faux. Un bandeau le signale explicitement à l'enseignant concerné.

La restriction couvre aussi les listes : un enseignant ne voit que **ses
propres matières** (un maître ses 4 domaines CEB, un professeur sa
discipline — pas le catalogue des 12 matières de l'établissement) et
**sa seule fiche** dans l'onglet Enseignants, jamais le trombinoscope de
ses collègues avec leurs affectations.

**Un enseignant gère ses propres heures** : depuis l'emploi du temps, il
ajoute, déplace (jour, horaires, salle) et supprime les créneaux de ses
cours. Le serveur vérifie qu'il s'agit bien de sa matière dans sa classe,
et refuse `403` toute tentative de placer une heure ailleurs ou de toucher
au cours d'un collègue. Les conflits d'horaire — classe déjà occupée,
enseignant déjà en cours — sont détectés à la création comme au
déplacement. Le catalogue des matières et leurs coefficients restent
gérés par la direction.

Comme le reste, la règle est appliquée **côté serveur** : un accès direct à
l'API renvoie `403`, pas seulement un masquage de l'interface.

### L'élémentaire suit le programme officiel (CEB), pas des « matières »

Le Sénégal n'organise **pas** l'élémentaire en matières séparées comme le
collège ou le lycée. Le programme officiel — le **Curriculum de l'Éducation
de Base (CEB)** — structure l'enseignement en **4 domaines**, tous pris en
charge par un **maître polyvalent unique** par classe (l'instituteur
titulaire), et non par un professeur différent pour chaque discipline :

| Domaine | Coefficient (démo) |
|---|:---:|
| Langue et Communication | 4 |
| Mathématiques | 4 |
| Éducation à la Science et à la Vie Sociale (ESVS) | 3 |
| Éducation Physique, Sportive et Artistique (EPSA) | 2 |

- Le dossier de classe reflète cette réalité : à l'élémentaire, l'onglet
  *Équipe pédagogique* affiche **une seule carte** — le maître titulaire —
  avec ses 4 domaines listés en dessous, au lieu de répéter son nom quatre
  fois comme le ferait la présentation « un professeur par matière » du
  secondaire.
- Le maître est automatiquement désigné **professeur principal** de sa
  classe (table `classe_maitre`, contrainte d'unicité un maître par classe).
- Au **moyen et au secondaire**, le modèle classique s'applique : chaque
  matière (Mathématiques, Français, Anglais, Histoire-Géographie, SVT,
  Physique-Chimie, EPS, Philosophie) a son propre professeur, avec des
  coefficients qui varient par niveau — le français pèse davantage en
  6ème/5ème qu'en Terminale, par exemple.

Vocabulaire suivi dans l'application : **directeur d'école** pour le chef
de l'élémentaire, **principal** pour le chef du CEM/lycée — ce sont les
titres officiels distincts utilisés au Sénégal.

### Scolarité
- **Élèves** : inscription, recherche, pagination, affectation en classe, matricule automatique (`EP-2026-0001`)
- **Dossier de l'élève** — un clic sur l'œil dans la liste ouvre un dossier à cinq onglets :
  - *Informations* : état civil complet et tuteurs avec leurs coordonnées
  - *Bulletin* : le bulletin de la période, imprimable
  - *Notes* : chaque évaluation avec sa date, son coefficient et sa note, groupée par matière avec la moyenne pondérée
  - *Assiduité* : compteurs absences/retards/non justifiées, historique détaillé et sanctions
  - *Finances* : dû / payé / reste, ligne par ligne (onglet masqué pour les profils non habilités)
- **Classes** : regroupées en deux onglets — **Scolaire** et **Moyen et secondaire**,
  chacun affichant son compte de classes. L'onglet inutile pour un directeur ou un
  principal (une seule entité visible) est masqué automatiquement.
- **Dossier de la classe** — un clic sur une carte de classe ouvre un dossier à cinq onglets :
  - *Informations* : effectif détaillé (garçons/filles, places libres), professeur principal avec ses coordonnées, salle, capacité, examen de fin de cycle
  - *Élèves* : la liste complète, chaque ligne ouvrant le dossier de l'élève
  - *Équipe pédagogique* : au secondaire, une carte par matière avec son coefficient et le professeur affecté ; à l'élémentaire, une carte unique pour le maître titulaire avec ses 4 domaines CEB
  - *Emploi du temps* : les créneaux regroupés par jour
  - *Résultats* : classement de la classe, moyenne générale et taux de réussite par période
- **Matières** : gérées par la **direction** (admin, directeur, proviseur) —
  création, renommage, couleur, suppression et **coefficients réglables niveau
  par niveau**. Le cloisonnement s'applique jusque dans le formulaire : un
  directeur ne voit et ne modifie que les niveaux de l'élémentaire, un
  proviseur que ceux du moyen/secondaire (`403` sinon).
  Une matière portant déjà des évaluations ou des affectations **ne peut pas
  être supprimée** — cela détruirait des bulletins. Les enseignants
  consultent leurs matières sans pouvoir les modifier : le coefficient est
  fixé par le programme et engage toutes les classes du niveau.
- **Enseignants** : fiches, spécialités, affectations classe/matière
- **Années scolaires** : découpage automatique en trimestres ou semestres, activation, clôture de période

### Notes et bulletins
- Évaluations typées (devoir, composition, interrogation) avec barème et coefficient propres
- **Saisie en lot** avec navigation clavier (Entrée = ligne suivante), validation du barème
- Note vide = absent à l'épreuve, exclu du calcul
- **Bulletin** : moyenne par matière pondérée par les coefficients d'évaluation, moyenne générale pondérée par les coefficients de matière, rang dans la classe, moyenne de classe, extrêmes, mention, assiduité — imprimable
- **Classement** de classe avec podium

### Vie scolaire
- **Appel** : saisie groupée par classe et par date, absence ou retard, notification automatique aux parents rattachés
- Justification des absences, statistiques d'assiduité
- Sanctions (avertissement, blâme, exclusion), registre d'infirmerie

### Finances
- Barème de frais par niveau, ponctuels ou **mensuels récurrents**
- Encaissement avec **numéro de reçu séquentiel**, modes locaux (espèces, Wave, Orange Money, chèque, virement)
- Annulation sans suppression (l'écriture comptable est conservée)
- Situation par élève : dû / payé / reste
- **Liste des impayés** avec contact du tuteur
- Dépenses par catégorie, synthèse recettes/dépenses/solde, graphiques

### Communication
- Annonces ciblées par audience (tous, enseignants, élèves, parents) avec épinglage
- Messagerie interne, annuaire
- Notifications avec compteur non lues

### Modules complémentaires
- **Bibliothèque** : catalogue, emprunts avec gestion des exemplaires disponibles et détection des retards
- **Transport** : bus, chauffeurs, itinéraires, élèves rattachés
- **Utilisateurs** : création de comptes, activation/désactivation, réinitialisation de mot de passe
- **Journal d'audit** : traçabilité des actions sensibles

---

## Installation

```bash
cd server
npm install
npm run installer   # migrations + donnees + historique + comptes tuteurs
npm run dev

cd ../client && npm install && npm run dev
```

`npm run installer` enchaîne les quatre étapes dans l'ordre : les 8
migrations, les données de démonstration, l'historique pluriannuel
(2023-2024 et 2024-2025) et les comptes tuteurs. Vérifié sur une base
entièrement vierge : la reconstruction est reproductible, et les 130 tests
passent ensuite sans exception.

## Déploiement

Voir **[DEPLOIEMENT.md](DEPLOIEMENT.md)** — base sur Neon, API et interface
sur Render.

```bash
# Préparer une base de production : structure + votre compte admin,
# aucune donnée fictive
DATABASE_URL="…" DATABASE_SSL=true ADMIN_EMAIL="vous@epsin.sn" ADMIN_MOT_DE_PASSE="…" npm run init-production
```

Trois garde-fous protègent la production : `npm run seed` et
`npm run historique` **refusent de s'exécuter** avec `NODE_ENV=production`
(ils insèrent des données fictives), et le serveur **refuse de démarrer**
sans `JWT_SECRET` — un secret par défaut permettrait à quiconque de forger
un jeton d'administrateur.

## Tests

```bash
cd server
npm test          # la suite complete
npm run test:watch # en continu pendant le developpement
```

**107 tests**, six types, environ 14 secondes. Ils s'appuient sur les
données de démonstration réelles plutôt que sur des fixtures inventées :
c'est ce jeu-là qui tourne en développement, et une régression sur les
vraies données est celle qui compte.

| Type | Fichier | Ce qu'il attrape |
|---|---|---|
| **Unitaire** | `unitaire.test.js` | Le calcul des moyennes isolé : double pondération, note `null` exclue au lieu d'être comptée zéro, bornes de mention (16 pile, 10 pile) |
| **Intégration** | `integration-permissions.test.js` | Le cloisonnement de bout en bout : le serveur **refuse**, il ne masque pas |
| | `integration-bulletins.test.js` | Le bulletin **recalculé** à partir des notes brutes et comparé |
| | `integration-parcours.test.js` | Parcours pluriannuel, décisions de fin d'année, cohérence dû/payé/reste |
| **Contrat** | `contrat.test.js` | La **forme** des réponses : renommer `detail_partiel` casserait le client sans qu'aucun test fonctionnel ne le voie |
| **Fumée** | `fumee.test.js` | La vérification rapide : santé, comptes de démo, dix écrans principaux |
| **Non-régression** | `regression.test.js` | Chaque test fige un bug **réellement rencontré** et corrigé |

Les tests attaquent l'application Express **en mémoire** (supertest), sans
ouvrir de port. Ceux qui écrivent en base nettoient derrière eux : la suite
est rejouable indéfiniment, vérifié sur trois exécutions consécutives.

Quatre types de l'infographie de référence ont été volontairement écartés :
*Load*, *Chaos*, *Mutation* et *Snapshot* — utiles à d'autres échelles, ils
n'attraperaient rien ici que les six autres ne couvrent déjà.

### Ce que les tests ont trouvé

Écrire ces tests a révélé un défaut réel : `appreciationDe(null)` renvoyait
« Travail Insuffisant » au lieu de rien, parce que `Number(null)` vaut `0`.
Une matière sans moyenne recevait donc une appréciation négative sur le
bulletin. Corrigé, et figé par un test.

---

## Rôles et permissions

| Module | Admin | Directeur | Principal | Censeur | Comptable | Enseignant |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Tableau de bord | ✅ | scolaire | secondaire | secondaire | ✅ | ✅ |
| Élèves | ✅ | scolaire | secondaire | secondaire | lecture | lecture |
| Classes / matières | ✅ | scolaire | secondaire | secondaire | — | lecture |
| Notes | ✅ | scolaire | secondaire | secondaire | — | ✅ |
| Vie scolaire | ✅ | scolaire | secondaire | secondaire | — | ✅ |
| Finances | ✅ | — | — | — | ✅ | — |
| Bibliothèque / transport | ✅ | scolaire | secondaire | secondaire | — | — |
| Utilisateurs / paramètres | ✅ | — | — | — | — | — |

Les permissions sont appliquées **côté serveur** — `autoriser` pour le rôle,
`filtreEntite` / `accesAutorise` (dans `middleware/entite.js`) pour le
cloisonnement. Le masquage des menus côté client n'est qu'un confort
d'affichage : la restriction réelle est en base et dans l'API.

---

## Architecture

```
EPSIN/
├── docker-compose.yml
├── server/
│   ├── migrations/001_init.sql     # 27 tables
│   └── src/
│       ├── index.js                # Express, helmet, CORS, rate limit
│       ├── db/
│       │   ├── pool.js             # pool pg + transactions
│       │   ├── migrate.js          # migrations suivies en base
│       │   └── seed.js             # données de démonstration
│       ├── middleware/auth.js      # JWT, rôles, audit
│       └── routes/                 # auth, eleves, notes, finances,
│                                   # scolarite, vie-scolaire,
│                                   # communication, tableau-bord, modules
└── client/
    └── src/
        ├── lib/api.js              # client HTTP, formatage FCFA/dates
        ├── context/AuthContext.jsx
        ├── components/ui.jsx       # composants partagés
        ├── layouts/Layout.jsx      # navigation filtrée par rôle
        └── pages/                  # une page par module
```

### Choix techniques notables

- **Coefficients par niveau** (`matiere_niveau`) : les mathématiques ne pèsent pas
  le même poids en 6ème et en Terminale S.
- **Moyennes calculées en SQL** : la pondération à deux niveaux (coefficient
  d'évaluation puis de matière) reste cohérente et performante sur gros effectifs.
- **Notes `NULL`** pour un absent, distinctes d'un zéro, exclues des moyennes.
- **Transactions** sur toute opération multi-tables (inscription, paiement,
  emprunt) pour éviter les états partiels.
- **Verrou `FOR UPDATE`** sur les emprunts, empêchant deux emprunts simultanés
  du dernier exemplaire.
- **Suppressions logiques** : élève archivé, paiement annulé — l'historique
  scolaire et comptable n'est jamais détruit.

---

## Sécurité

- Mots de passe hachés avec **bcrypt** (10 tours)
- **JWT** avec expiration (12 h par défaut), vérifié à chaque requête
- **Rate limiting** sur la connexion : 10 tentatives / 15 min
- Message d'erreur identique que le compte existe ou non
- **helmet** pour les en-têtes HTTP, CORS restreint par variable d'environnement
- Requêtes **paramétrées** partout (aucune concaténation de valeurs)
- Validation des entrées avec **zod** sur les routes sensibles
- Journal d'audit horodaté avec IP

⚠️ **Avant la mise en production** : changez `JWT_SECRET`, utilisez un mot de
passe PostgreSQL robuste, activez HTTPS et remplacez les mots de passe des
comptes de démonstration.

---

## Variables d'environnement (`server/.env`)

| Variable | Rôle | Exemple |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql://postgres:epsin@localhost:5440/epsin` |
| `DATABASE_SSL` | SSL (hébergeurs cloud) | `false` |
| `JWT_SECRET` | Clé de signature des jetons | — |
| `JWT_EXPIRES` | Durée de validité | `12h` |
| `PORT` | Port de l'API | `4000` |
| `CORS_ORIGIN` | Origines autorisées | `http://localhost:5173` |

---

## Production

```bash
cd client && npm run build      # génère client/dist
cd server && npm start
```

Servez `client/dist` derrière un serveur statique (Nginx, Vercel, Netlify) en
faisant pointer `/api` vers le backend. Le découpage des bundles isole React et
Recharts pour un meilleur cache entre déploiements.
