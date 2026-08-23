-- ============================================================
-- EPSIN — 1) Renommage « principal » -> « proviseur »
--         2) Demandes de conge/absence des enseignants
--
-- 1) Le chef du moyen et du secondaire porte le titre de PROVISEUR dans cet
--    etablissement (confirme par l utilisateur). Au Senegal « principal »
--    designe le chef d un CEM seul et « proviseur » celui d un lycee ; ici
--    les deux cycles sont diriges par une seule personne, qui porte le titre
--    de proviseur.
--
-- 2) Chaque enseignant releve du chef de SON entite :
--      - un maitre de l elementaire adresse ses demandes au DIRECTEUR
--      - un professeur du moyen/secondaire les adresse au PROVISEUR
--    Le destinataire n est donc jamais choisi par le demandeur : il est
--    deduit de l entite de l enseignant, ce qui evite qu une demande parte
--    au mauvais chef.
-- ============================================================

-- ---------- 1. Renommage du role ----------
-- ALTER TYPE ... RENAME VALUE met a jour toutes les lignes existantes :
-- aucun UPDATE supplementaire n est necessaire.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role_utilisateur' AND e.enumlabel = 'principal'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role_utilisateur' AND e.enumlabel = 'proviseur'
  ) THEN
    ALTER TYPE role_utilisateur RENAME VALUE 'principal' TO 'proviseur';
  END IF;
END $$;

-- ---------- 2. Demandes de conge / absence des enseignants ----------
CREATE TABLE IF NOT EXISTS demande_absence (
  id              SERIAL PRIMARY KEY,
  enseignant_id   INT NOT NULL REFERENCES enseignant(id) ON DELETE CASCADE,
  annee_id        INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,

  type            TEXT NOT NULL DEFAULT 'absence',
  date_debut      DATE NOT NULL,
  date_fin        DATE NOT NULL,
  motif           TEXT NOT NULL,

  -- soumise -> approuvee | refusee  (annulee = retiree par le demandeur)
  statut          TEXT NOT NULL DEFAULT 'soumise',

  -- Chef ayant statue (directeur ou proviseur selon l entite), et sa reponse
  decideur_id     INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  commentaire     TEXT,
  date_decision   TIMESTAMPTZ,

  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demande_absence_periode CHECK (date_fin >= date_debut),
  CONSTRAINT demande_absence_type CHECK (
    type IN ('absence', 'conge_annuel', 'maladie', 'maternite', 'formation', 'autre')
  ),
  CONSTRAINT demande_absence_statut CHECK (
    statut IN ('soumise', 'approuvee', 'refusee', 'annulee')
  ),
  -- Une demande tranchee doit porter la trace de qui a decide et quand
  CONSTRAINT demande_absence_decision CHECK (
    statut IN ('soumise', 'annulee')
    OR (decideur_id IS NOT NULL AND date_decision IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_demande_absence_ens ON demande_absence(enseignant_id);
CREATE INDEX IF NOT EXISTS idx_demande_absence_statut ON demande_absence(statut);
CREATE INDEX IF NOT EXISTS idx_demande_absence_annee ON demande_absence(annee_id);
