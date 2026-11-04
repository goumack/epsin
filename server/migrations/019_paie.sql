-- ============================================================
-- EPSIN — Paie des maitres et professeurs
--
-- salarie : le personnel paye chaque mois (maitres, professeurs,
--   surveillants, secretaires, gardiens...), avec son salaire mensuel, fixe
--   pour l annee. Il n a pas besoin d un compte EPSIN ; s il en a un
--   (enseignant), on peut le lier. cycle : elementaire ou college, pour un
--   etat de paie par cycle.
--
-- paie : une ligne par salarie et par mois (« 2026-11 »). Le montant part
--   du salaire mensuel et peut s ajuster pour le mois (absence, avance),
--   avec une note. Le paiement cree une DEPENSE « Salaires » : la paie
--   compte ainsi dans les depenses et la synthese, sans double saisie.
--   Annuler le paiement retire cette depense.
-- ============================================================

CREATE TABLE IF NOT EXISTS salarie (
  id               SERIAL PRIMARY KEY,
  prenom           TEXT NOT NULL,
  nom              TEXT NOT NULL,
  fonction         TEXT NOT NULL DEFAULT 'Maître',
  cycle            TEXT NOT NULL DEFAULT 'elementaire',
  telephone        TEXT,
  salaire_mensuel  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (salaire_mensuel >= 0),
  actif            BOOLEAN NOT NULL DEFAULT true,
  enseignant_id    INT UNIQUE REFERENCES enseignant(id) ON DELETE SET NULL,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salarie_cycle_valide CHECK (cycle IN ('elementaire', 'college'))
);

CREATE TABLE IF NOT EXISTS paie (
  id          SERIAL PRIMARY KEY,
  salarie_id  INT NOT NULL REFERENCES salarie(id) ON DELETE RESTRICT,
  annee_id    INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  mois        TEXT NOT NULL,
  montant     NUMERIC(12,2) NOT NULL CHECK (montant >= 0),
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
