-- ============================================================
-- EPSIN — Paie des maitres et professeurs
--
-- salarie : le personnel paye chaque mois (maitres, professeurs,
--   surveillants, secretaires, gardiens...). Il n a pas besoin d un compte
--   EPSIN ; s il en a un (enseignant), on peut le lier. Deux modes de paie :
--     mensuel  salaire fixe pour l annee (elementaire, principal,
--              surveillants...) ;
--     horaire  professeur paye a l heure (college) : chaque mois, les heures
--              reellement faites x son taux horaire, propre a chacun.
--   cycle : elementaire ou college, pour un etat de paie par cycle.
--
-- paie : une ligne par salarie et par mois (« 2026-11 »). Salaire fixe : le
--   montant part du salaire mensuel, ajustable (absence, avance) avec une
--   note. Paie a l heure : heures du mois x taux (fige sur la ligne).
--   Le paiement cree une DEPENSE « Salaires » : la paie compte ainsi dans
--   les depenses et la synthese, sans double saisie. Annuler le paiement
--   retire cette depense.
-- ============================================================

CREATE TABLE IF NOT EXISTS salarie (
  id               SERIAL PRIMARY KEY,
  prenom           TEXT NOT NULL,
  nom              TEXT NOT NULL,
  fonction         TEXT NOT NULL DEFAULT 'Maître',
  cycle            TEXT NOT NULL DEFAULT 'elementaire',
  mode_paie        TEXT NOT NULL DEFAULT 'mensuel',
  telephone        TEXT,
  salaire_mensuel  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salaire_mensuel >= 0),
  taux_horaire     NUMERIC(12,2) CHECK (taux_horaire IS NULL OR taux_horaire >= 0),
  actif            BOOLEAN NOT NULL DEFAULT true,
  enseignant_id    INT UNIQUE REFERENCES enseignant(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salarie_cycle_valide CHECK (cycle IN ('elementaire', 'college')),
  CONSTRAINT salarie_mode_valide CHECK (mode_paie IN ('mensuel', 'horaire'))
);

CREATE TABLE IF NOT EXISTS paie (
  id          SERIAL PRIMARY KEY,
  salarie_id  INT NOT NULL REFERENCES salarie(id) ON DELETE RESTRICT,
  annee_id    INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  mois        TEXT NOT NULL,
  montant     NUMERIC(12,2) NOT NULL CHECK (montant >= 0),
  -- Paie a l heure : heures du mois et taux applique
  heures      NUMERIC(6,2) CHECK (heures IS NULL OR heures >= 0),
  taux        NUMERIC(12,2),
  note        TEXT,
  statut      TEXT NOT NULL DEFAULT 'a_payer',
  mode        TEXT,
  paye_le     DATE,
  paye_par    INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  depense_id  INT UNIQUE REFERENCES depense(id) ON DELETE SET NULL,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT paie_mois_valide CHECK (mois ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT paie_statut_valide CHECK (statut IN ('a_payer', 'paye')),
  -- Une seule paie par personne et par mois
  CONSTRAINT paie_unique UNIQUE (salarie_id, mois)
);
CREATE INDEX IF NOT EXISTS idx_paie_mois ON paie (mois);
