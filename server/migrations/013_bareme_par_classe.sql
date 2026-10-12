-- ============================================================
-- EPSIN — Bareme par classe
--
-- Chaque niveau a ses propres montants (inscription, mensualite...), saisis
-- dans une grille. Une mensualite peut s arreter avant la fin de l annee
-- scolaire : « d octobre a juin » = 9 mensualites, meme si l annee court
-- jusqu en juillet. `mois_fin` est le numero du dernier mois du (1-12) ;
-- NULL = jusqu a la fin de l annee.
-- ============================================================

ALTER TABLE frais ADD COLUMN IF NOT EXISTS mois_fin INT;
ALTER TABLE frais DROP CONSTRAINT IF EXISTS frais_mois_fin_valide;
ALTER TABLE frais ADD CONSTRAINT frais_mois_fin_valide
  CHECK (mois_fin IS NULL OR mois_fin BETWEEN 1 AND 12);

-- Un meme frais ne peut exister deux fois pour un niveau et une annee :
-- la grille du bareme s appuie sur cette unicite.
-- Cree seulement s il n existe pas deja de doublon : une base existante en
-- contenant ne doit pas empecher l API de demarrer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM frais GROUP BY annee_id, COALESCE(niveau_id, 0), lower(libelle) HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_frais_unique
      ON frais (annee_id, COALESCE(niveau_id, 0), lower(libelle));
  END IF;
END
$$;
