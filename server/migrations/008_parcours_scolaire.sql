-- ============================================================
-- EPSIN — Parcours scolaire pluriannuel
--
-- Un eleve traverse plusieurs annees : CM2 en 2023-2024, puis 6eme en
-- 2024-2025... A la fin de chaque annee, une DECISION est prise :
--   passe      -> admis en classe superieure
--   redouble   -> refait la meme classe
--   parti      -> transfere dans un autre etablissement
--   abandon    -> a quitte l ecole sans transfert
--   exclu      -> exclu par le conseil de discipline
--
-- La table `inscription` porte deja UNIQUE (eleve_id, annee_id) : le
-- multi-annees est possible. On y ajoute la decision de fin d annee et sa
-- tracabilite, puis on cree les annees anterieures pour l historique.
-- ============================================================

-- ---------- Decision de fin d annee ----------
ALTER TABLE inscription ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE inscription ADD COLUMN IF NOT EXISTS motif_sortie TEXT;
ALTER TABLE inscription ADD COLUMN IF NOT EXISTS decide_par INT
  REFERENCES utilisateur(id) ON DELETE SET NULL;
ALTER TABLE inscription ADD COLUMN IF NOT EXISTS decide_le TIMESTAMPTZ;

ALTER TABLE inscription DROP CONSTRAINT IF EXISTS inscription_decision_valide;
ALTER TABLE inscription ADD CONSTRAINT inscription_decision_valide CHECK (
  decision IS NULL OR decision IN ('passe','redouble','parti','abandon','exclu')
);

-- Le statut de l inscription elle-meme : en cours, ou close par une decision
ALTER TABLE inscription DROP CONSTRAINT IF EXISTS inscription_statut_valide;
ALTER TABLE inscription ADD CONSTRAINT inscription_statut_valide CHECK (
  statut IN ('inscrit','termine','transfere','abandon','exclu')
);

CREATE INDEX IF NOT EXISTS idx_inscription_eleve ON inscription(eleve_id);
CREATE INDEX IF NOT EXISTS idx_inscription_decision ON inscription(decision);

-- ---------- Statut de l eleve ----------
-- Un eleve qui a quitte l ecole n est plus « actif » sans etre « archive » :
-- on distingue les situations pour retrouver son dossier.
ALTER TABLE eleve DROP CONSTRAINT IF EXISTS eleve_statut_valide;
ALTER TABLE eleve ADD CONSTRAINT eleve_statut_valide CHECK (
  statut IN ('actif','archive','parti','abandon','exclu','diplome')
);

-- ---------- Annees anterieures ----------
-- Necessaires pour rattacher un historique. Creees seulement si absentes.
INSERT INTO annee_scolaire (libelle, date_debut, date_fin, active)
SELECT '2023-2024', '2023-10-01', '2024-07-15', false
WHERE NOT EXISTS (SELECT 1 FROM annee_scolaire WHERE libelle = '2023-2024');

INSERT INTO annee_scolaire (libelle, date_debut, date_fin, active)
SELECT '2024-2025', '2024-10-01', '2025-07-15', false
WHERE NOT EXISTS (SELECT 1 FROM annee_scolaire WHERE libelle = '2024-2025');
