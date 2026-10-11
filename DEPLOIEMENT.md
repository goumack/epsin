# Déploiement — Neon + Render

Trois étapes : la base sur Neon, l'API sur Render, l'interface sur Render.
Comptez une trentaine de minutes.

---

## 1. La base de données sur Neon

1. Créez un compte sur **[neon.tech](https://neon.tech)** puis un projet.
   - Nom du projet : `epsin`
   - Région : **AWS eu-central-1 (Frankfurt)** — la plus proche du Sénégal
   - Version PostgreSQL : 16

2. Dans **Dashboard → Connection string**, choisissez **Pooled connection**
   et copiez l'URL. Elle ressemble à :

   ```
   postgresql://neondb_owner:XXXX@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

   > Prenez bien la version **pooled** : l'offre gratuite de Render ouvre et
   > ferme les connexions souvent, et le pooler de Neon absorbe ce va-et-vient.

3. Gardez cette URL de côté : c'est votre `DATABASE_URL`.

---

## 2. Préparer la base

Depuis votre machine, avec l'URL Neon :

```bash
cd server

# Créer les tables (8 migrations)
DATABASE_URL="postgresql://…votre URL Neon…" \
DATABASE_SSL=true \
npm run migrate

# Créer l'établissement, l'année, les 13 niveaux et VOTRE compte admin
DATABASE_URL="postgresql://…votre URL Neon…" \
DATABASE_SSL=true \
ADMIN_EMAIL="votre.email@epsin.sn" \
ADMIN_MOT_DE_PASSE="UnMotDePasseSolide2026" \
npm run init-production
```

Cette base contient **la structure et un compte administrateur, aucune
donnée fictive**. Vous saisirez vos vraies classes et élèves depuis
l'application.

> Le script refuse de s'exécuter sans `ADMIN_MOT_DE_PASSE`, et exige au
> moins 10 caractères. Il est relançable sans rien dupliquer.

---

## 3. L'API sur Render

1. Poussez le projet sur GitHub s'il ne l'est pas déjà.
2. Sur **[render.com](https://render.com)** → **New → Blueprint**, pointez
   sur votre dépôt. Render lit `render.yaml` et propose les deux services.
3. Renseignez les variables marquées `sync: false` pour **epsin-api** :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | l'URL Neon de l'étape 1 |
   | `CORS_ORIGIN` | l'URL de `epsin-web`, une fois connue (étape 4) |

   `JWT_SECRET` est **généré automatiquement** par Render : ne le saisissez
   pas, ne le commitez jamais.

4. Déployez. Vérifiez ensuite :

   ```
   https://epsin-api.onrender.com/api/sante
   ```

   Vous devez lire `{"statut":"ok",…}`.

---

## 4. L'interface sur Render

1. Le service **epsin-web** est créé par le même blueprint.
2. Renseignez sa variable :

   | Variable | Valeur |
   |---|---|
   | `VITE_API_URL` | `https://epsin-api.onrender.com` |

3. Déployez, puis **revenez sur epsin-api** et renseignez `CORS_ORIGIN`
   avec l'URL de l'interface (`https://epsin-web.onrender.com`).
   Redéployez l'API pour que le changement prenne effet.

   > Sans cette étape, le navigateur bloquera tous les appels : l'interface
   > s'affichera mais aucune donnée ne se chargera.

---

## 5. Première connexion

Ouvrez `https://epsin-web.onrender.com` et connectez-vous avec le compte
créé à l'étape 2. Puis, dans cet ordre :

1. **Paramètres** — vérifiez le nom de l'établissement, l'IA et l'IEF
   (ils figurent en en-tête des bulletins)
2. **Classes → Matières** — créez vos matières et leurs coefficients
3. **Classes** — créez vos classes
4. **Utilisateurs** — créez les comptes directeur, proviseur, censeur,
   comptable et enseignants
5. **Élèves** — inscrivez vos élèves. Chaque inscription crée aussitôt le
   **compte parent** (`matricule@epsin.sn`) et affiche sa **fiche d'accès**
   à imprimer, avec un mot de passe à usage unique. Remettez-la au parent :
   à sa première connexion, il choisit son propre mot de passe.

   Fiche perdue ? Dossier de l'élève → *Compte parent* → **Nouvelle fiche
   d'accès** (l'ancien mot de passe cesse de fonctionner).

   > N'utilisez pas `npm run comptes-tuteurs` en production : ce script de
   > démonstration donne à tous les parents le même mot de passe, et refuse
   > désormais de s'exécuter avec `NODE_ENV=production`.

---

## 6. Paiement des mensualités par Wave

Le blueprint renseigne déjà `WAVE_LIEN_PAIEMENT` avec le lien marchand de
l'établissement : les tuteurs peuvent payer dès le déploiement. Chaque
paiement déclaré apparaît dans **Finances → Wave à vérifier**. Le comptable
le confronte à son historique **Wave Business** avant de valider.

Pour une **confirmation automatique** (sans vérification manuelle), demandez
à Wave l'accès à l'**API Checkout**, puis :

1. dans Wave Business, créez une clé API et un **webhook** pointant vers
   `https://epsin-api.onrender.com/api/paiements-en-ligne/wave/webhook`
   (événements `checkout.session.completed` et
   `checkout.session.payment_failed`) ;
2. sur Render, renseignez `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET` et
   `APP_URL` (l'URL de `epsin-web`).

La clé API devient alors prioritaire sur le lien. Si le webhook tarde (service
gratuit en veille), l'application interroge Wave elle-même au retour du parent.

---

## Bon à savoir

**L'offre gratuite de Render met le service en veille** après 15 minutes
sans requête. Le premier appel suivant prend alors 30 à 50 secondes. Pour
un établissement en usage réel, le plan payant (7 $/mois) supprime cette
mise en veille.

**Neon met aussi la base en veille** sur l'offre gratuite, mais le réveil
est quasi instantané.

**Sauvegardes.** Neon conserve un historique permettant de revenir à un
instant passé (7 jours sur l'offre gratuite). Pour une sauvegarde que vous
maîtrisez :

```bash
pg_dump "postgresql://…votre URL Neon…" > sauvegarde-$(date +%F).sql
```

**Mises à jour.** Chaque `git push` sur la branche principale redéclenche
le déploiement. Si une migration accompagne le changement, lancez-la
depuis votre machine **avant** de pousser :

```bash
DATABASE_URL="…" DATABASE_SSL=true npm run migrate
```

---

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| L'interface s'affiche, aucune donnée | `CORS_ORIGIN` absent ou incorrect sur l'API |
| `JWT_SECRET est obligatoire en production` | La variable n'a pas été générée — recréez le service |
| `self signed certificate` | `DATABASE_SSL` n'est pas à `true` |
| Première requête très lente | Service en veille — normal sur l'offre gratuite |
| `404` en rafraîchissant une page | La règle de réécriture du service statique a été retirée |
