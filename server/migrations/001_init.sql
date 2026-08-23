-- ============================================================
-- EPSIN — Schéma initial (PostgreSQL)
-- Contexte : système scolaire francophone (Sénégal)
-- ============================================================

CREATE TABLE IF NOT EXISTS etablissement (
  id            SERIAL PRIMARY KEY,
  nom           TEXT NOT NULL,
  sigle         TEXT,
  adresse       TEXT,
  telephone     TEXT,
  email         TEXT,
  logo_url      TEXT,
  devise        TEXT NOT NULL DEFAULT 'FCFA',
  bareme        NUMERIC(5,2) NOT NULL DEFAULT 20,
  nb_periodes   INT NOT NULL DEFAULT 3,          -- 3 trimestres / 2 semestres
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annee_scolaire (
  id          SERIAL PRIMARY KEY,
  libelle     TEXT NOT NULL UNIQUE,              -- ex. "2025-2026"
  date_debut  DATE NOT NULL,
  date_fin    DATE NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT false,
  CHECK (date_fin > date_debut)
);

-- Une seule annee active a la fois
CREATE UNIQUE INDEX IF NOT EXISTS idx_annee_active
  ON annee_scolaire (active) WHERE active;

CREATE TABLE IF NOT EXISTS periode (
  id           SERIAL PRIMARY KEY,
  annee_id     INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  libelle      TEXT NOT NULL,                    -- "1er trimestre"
  ordre        INT NOT NULL,
  date_debut   DATE NOT NULL,
  date_fin     DATE NOT NULL,
  cloturee     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (annee_id, ordre)
);

-- ---------- Utilisateurs et roles ----------
DO $$ BEGIN
  CREATE TYPE role_utilisateur AS ENUM
    ('admin','censeur','comptable','enseignant','eleve','parent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS utilisateur (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE,
  telephone      TEXT UNIQUE,
  mot_de_passe   TEXT NOT NULL,
  role           role_utilisateur NOT NULL,
  prenom         TEXT NOT NULL,
  nom            TEXT NOT NULL,
  photo_url      TEXT,
  actif          BOOLEAN NOT NULL DEFAULT true,
  derniere_connexion TIMESTAMPTZ,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR telephone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_utilisateur_role ON utilisateur(role);

-- ---------- Structure pedagogique ----------
CREATE TABLE IF NOT EXISTS niveau (
  id       SERIAL PRIMARY KEY,
  libelle  TEXT NOT NULL UNIQUE,                 -- "6eme", "Terminale S"
  cycle    TEXT NOT NULL,                        -- primaire / moyen / secondaire
  ordre    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS classe (
  id             SERIAL PRIMARY KEY,
  annee_id       INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  niveau_id      INT NOT NULL REFERENCES niveau(id),
  libelle        TEXT NOT NULL,                  -- "6eme A"
  capacite       INT NOT NULL DEFAULT 60,
  salle          TEXT,
  prof_principal_id INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  UNIQUE (annee_id, libelle)
);

CREATE TABLE IF NOT EXISTS matiere (
  id        SERIAL PRIMARY KEY,
  libelle   TEXT NOT NULL UNIQUE,
  code      TEXT UNIQUE,
  couleur   TEXT DEFAULT '#3b82f6'
);

-- Coefficient d une matiere : depend du niveau, pas de la matiere seule
CREATE TABLE IF NOT EXISTS matiere_niveau (
  id           SERIAL PRIMARY KEY,
  matiere_id   INT NOT NULL REFERENCES matiere(id) ON DELETE CASCADE,
  niveau_id    INT NOT NULL REFERENCES niveau(id) ON DELETE CASCADE,
  coefficient  NUMERIC(4,2) NOT NULL DEFAULT 1,
  volume_horaire INT,
  UNIQUE (matiere_id, niveau_id)
);

-- ---------- Eleves et inscriptions ----------
CREATE TABLE IF NOT EXISTS eleve (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INT UNIQUE REFERENCES utilisateur(id) ON DELETE SET NULL,
  matricule      TEXT NOT NULL UNIQUE,
  prenom         TEXT NOT NULL,
  nom            TEXT NOT NULL,
  sexe           CHAR(1) CHECK (sexe IN ('M','F')),
  date_naissance DATE,
  lieu_naissance TEXT,
  nationalite    TEXT,
  adresse        TEXT,
  photo_url      TEXT,
  statut         TEXT NOT NULL DEFAULT 'actif',  -- actif / transfere / exclu / diplome
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eleve_nom ON eleve(nom, prenom);

CREATE TABLE IF NOT EXISTS tuteur (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  prenom         TEXT NOT NULL,
  nom            TEXT NOT NULL,
  telephone      TEXT NOT NULL,
  email          TEXT,
  profession     TEXT,
  adresse        TEXT
);

CREATE TABLE IF NOT EXISTS eleve_tuteur (
  eleve_id   INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  tuteur_id  INT NOT NULL REFERENCES tuteur(id) ON DELETE CASCADE,
  lien       TEXT NOT NULL,                      -- pere / mere / tuteur
  principal  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (eleve_id, tuteur_id)
);

CREATE TABLE IF NOT EXISTS inscription (
  id           SERIAL PRIMARY KEY,
  eleve_id     INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  classe_id    INT NOT NULL REFERENCES classe(id) ON DELETE CASCADE,
  annee_id     INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  date_inscription DATE NOT NULL DEFAULT CURRENT_DATE,
  redoublant   BOOLEAN NOT NULL DEFAULT false,
  statut       TEXT NOT NULL DEFAULT 'inscrit',  -- inscrit / en_attente / annule
  UNIQUE (eleve_id, annee_id)
);

-- ---------- Enseignants et affectations ----------
CREATE TABLE IF NOT EXISTS enseignant (
  id             SERIAL PRIMARY KEY,
  utilisateur_id INT UNIQUE NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  matricule      TEXT UNIQUE,
  specialite     TEXT,
  date_embauche  DATE,
  type_contrat   TEXT,                           -- permanent / vacataire
  salaire_base   NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS affectation (
  id            SERIAL PRIMARY KEY,
  enseignant_id INT NOT NULL REFERENCES enseignant(id) ON DELETE CASCADE,
  classe_id     INT NOT NULL REFERENCES classe(id) ON DELETE CASCADE,
  matiere_id    INT NOT NULL REFERENCES matiere(id) ON DELETE CASCADE,
  annee_id      INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  UNIQUE (classe_id, matiere_id, annee_id)
);

-- ---------- Evaluations et notes ----------
CREATE TABLE IF NOT EXISTS evaluation (
  id           SERIAL PRIMARY KEY,
  classe_id    INT NOT NULL REFERENCES classe(id) ON DELETE CASCADE,
  matiere_id   INT NOT NULL REFERENCES matiere(id) ON DELETE CASCADE,
  periode_id   INT NOT NULL REFERENCES periode(id) ON DELETE CASCADE,
  enseignant_id INT REFERENCES enseignant(id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'devoir',   -- devoir / composition / interrogation
  libelle      TEXT NOT NULL,
  date_eval    DATE NOT NULL DEFAULT CURRENT_DATE,
  bareme       NUMERIC(5,2) NOT NULL DEFAULT 20,
  coefficient  NUMERIC(4,2) NOT NULL DEFAULT 1,
  publiee      BOOLEAN NOT NULL DEFAULT false,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_classe_periode ON evaluation(classe_id, periode_id);

CREATE TABLE IF NOT EXISTS note (
  id            SERIAL PRIMARY KEY,
  evaluation_id INT NOT NULL REFERENCES evaluation(id) ON DELETE CASCADE,
  eleve_id      INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  valeur        NUMERIC(5,2),                    -- NULL = absent a l epreuve
  appreciation  TEXT,
  saisie_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evaluation_id, eleve_id),
  CHECK (valeur IS NULL OR valeur >= 0)
);

-- ---------- Absences et discipline ----------
CREATE TABLE IF NOT EXISTS absence (
  id          SERIAL PRIMARY KEY,
  eleve_id    INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  date_abs    DATE NOT NULL,
  heure_debut TIME,
  heure_fin   TIME,
  matiere_id  INT REFERENCES matiere(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'absence',   -- absence / retard
  justifiee   BOOLEAN NOT NULL DEFAULT false,
  motif       TEXT,
  saisie_par  INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_absence_eleve_date ON absence(eleve_id, date_abs);

CREATE TABLE IF NOT EXISTS sanction (
  id         SERIAL PRIMARY KEY,
  eleve_id   INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                      -- avertissement / exclusion / blame
  motif      TEXT NOT NULL,
  date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
  date_fin   DATE,
  decidee_par INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Emploi du temps ----------
CREATE TABLE IF NOT EXISTS creneau (
  id            SERIAL PRIMARY KEY,
  classe_id     INT NOT NULL REFERENCES classe(id) ON DELETE CASCADE,
  matiere_id    INT NOT NULL REFERENCES matiere(id) ON DELETE CASCADE,
  enseignant_id INT REFERENCES enseignant(id) ON DELETE SET NULL,
  jour          INT NOT NULL CHECK (jour BETWEEN 1 AND 7),
  heure_debut   TIME NOT NULL,
  heure_fin     TIME NOT NULL,
  salle         TEXT,
  CHECK (heure_fin > heure_debut)
);
CREATE INDEX IF NOT EXISTS idx_creneau_classe ON creneau(classe_id, jour);

-- ---------- Finances ----------
CREATE TABLE IF NOT EXISTS frais (
  id          SERIAL PRIMARY KEY,
  annee_id    INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  niveau_id   INT REFERENCES niveau(id) ON DELETE CASCADE,
  libelle     TEXT NOT NULL,                     -- inscription / mensualite / cantine
  montant     NUMERIC(12,2) NOT NULL CHECK (montant >= 0),
  obligatoire BOOLEAN NOT NULL DEFAULT true,
  echeance    DATE,
  recurrent   BOOLEAN NOT NULL DEFAULT false     -- true = du chaque mois
);

CREATE TABLE IF NOT EXISTS paiement (
  id           SERIAL PRIMARY KEY,
  eleve_id     INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  frais_id     INT REFERENCES frais(id) ON DELETE SET NULL,
  annee_id     INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  montant      NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  mode         TEXT NOT NULL DEFAULT 'especes',  -- especes / wave / om / cheque / virement
  reference    TEXT,
  numero_recu  TEXT UNIQUE,
  mois_couvert TEXT,                             -- "2025-10" pour les mensualites
  date_paiement DATE NOT NULL DEFAULT CURRENT_DATE,
  encaisse_par INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  annule       BOOLEAN NOT NULL DEFAULT false,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paiement_eleve ON paiement(eleve_id, annee_id);

CREATE TABLE IF NOT EXISTS depense (
  id          SERIAL PRIMARY KEY,
  annee_id    INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  categorie   TEXT NOT NULL,
  libelle     TEXT NOT NULL,
  montant     NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  date_depense DATE NOT NULL DEFAULT CURRENT_DATE,
  saisie_par  INT REFERENCES utilisateur(id) ON DELETE SET NULL
);

-- ---------- Communication ----------
CREATE TABLE IF NOT EXISTS annonce (
  id          SERIAL PRIMARY KEY,
  titre       TEXT NOT NULL,
  contenu     TEXT NOT NULL,
  auteur_id   INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  cible       TEXT NOT NULL DEFAULT 'tous',      -- tous / enseignants / eleves / parents
  classe_id   INT REFERENCES classe(id) ON DELETE CASCADE,
  epingle     BOOLEAN NOT NULL DEFAULT false,
  publie_le   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message (
  id            SERIAL PRIMARY KEY,
  expediteur_id INT NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  destinataire_id INT NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  objet         TEXT,
  contenu       TEXT NOT NULL,
  lu            BOOLEAN NOT NULL DEFAULT false,
  envoye_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_dest ON message(destinataire_id, lu);

CREATE TABLE IF NOT EXISTS notification (
  id           SERIAL PRIMARY KEY,
  utilisateur_id INT NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  titre        TEXT NOT NULL,
  contenu      TEXT,
  lien         TEXT,
  lu           BOOLEAN NOT NULL DEFAULT false,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Modules avances ----------
CREATE TABLE IF NOT EXISTS livre (
  id        SERIAL PRIMARY KEY,
  titre     TEXT NOT NULL,
  auteur    TEXT,
  isbn      TEXT,
  categorie TEXT,
  exemplaires INT NOT NULL DEFAULT 1,
  disponibles INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS emprunt (
  id          SERIAL PRIMARY KEY,
  livre_id    INT NOT NULL REFERENCES livre(id) ON DELETE CASCADE,
  eleve_id    INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  date_emprunt DATE NOT NULL DEFAULT CURRENT_DATE,
  date_retour_prevu DATE NOT NULL,
  date_retour_reel  DATE
);

CREATE TABLE IF NOT EXISTS bus (
  id        SERIAL PRIMARY KEY,
  immatriculation TEXT NOT NULL UNIQUE,
  chauffeur TEXT,
  telephone TEXT,
  capacite  INT NOT NULL DEFAULT 30,
  itineraire TEXT
);

CREATE TABLE IF NOT EXISTS transport_eleve (
  eleve_id  INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  bus_id    INT NOT NULL REFERENCES bus(id) ON DELETE CASCADE,
  arret     TEXT,
  PRIMARY KEY (eleve_id, bus_id)
);

CREATE TABLE IF NOT EXISTS visite_infirmerie (
  id        SERIAL PRIMARY KEY,
  eleve_id  INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  date_visite TIMESTAMPTZ NOT NULL DEFAULT now(),
  motif     TEXT NOT NULL,
  traitement TEXT,
  parent_prevenu BOOLEAN NOT NULL DEFAULT false
);

-- ---------- Journal d audit ----------
CREATE TABLE IF NOT EXISTS journal_audit (
  id          SERIAL PRIMARY KEY,
  utilisateur_id INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entite      TEXT,
  entite_id   INT,
  details     JSONB,
  ip          TEXT,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON journal_audit(cree_le DESC);
