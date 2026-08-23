-- ============================================================
-- EPSIN — Structure réelle du système éducatif sénégalais
--
-- Élémentaire  : CI, CP, CE1, CE2, CM1, CM2 (6 ans) -> CFEE
-- Moyen        : 6ème à 3ème (4 ans, collège/CEM)   -> BFEM
-- Secondaire   : Seconde à Terminale (3 ans, lycée) -> Baccalauréat
--
-- Cette migration ne fait qu ajouter la colonne `examen`. Les niveaux
-- eux-memes sont des donnees : ils viennent du seed sur une base neuve,
-- et le bloc de rattrapage ci-dessous les complete sur une base existante.
-- ============================================================

-- Examen officiel sanctionnant la fin d un niveau (NULL si aucun)
ALTER TABLE niveau ADD COLUMN IF NOT EXISTS examen TEXT;

DO $$
BEGIN
  -- Rattrapage : uniquement si des niveaux existent deja (base anterieure)
  -- et que l elementaire n a jamais ete cree.
  IF EXISTS (SELECT 1 FROM niveau)
     AND NOT EXISTS (SELECT 1 FROM niveau WHERE cycle = 'elementaire') THEN

    -- Les ordres 1 a 6 sont reserves a l elementaire
    UPDATE niveau SET ordre = ordre + 6 WHERE cycle IN ('moyen', 'secondaire');

    INSERT INTO niveau (libelle, cycle, ordre) VALUES
      ('CI',  'elementaire', 1),
      ('CP',  'elementaire', 2),
      ('CE1', 'elementaire', 3),
      ('CE2', 'elementaire', 4),
      ('CM1', 'elementaire', 5),
      ('CM2', 'elementaire', 6)
    ON CONFLICT (libelle) DO NOTHING;
  END IF;

  -- Marquage des niveaux sanctionnes par un examen national.
  -- Idempotent : sans effet si les niveaux n existent pas encore.
  UPDATE niveau SET examen = 'CFEE'         WHERE libelle = 'CM2';
  UPDATE niveau SET examen = 'BFEM'         WHERE libelle = '3eme';
  UPDATE niveau SET examen = 'Baccalaureat' WHERE libelle = 'Terminale';
END $$;
