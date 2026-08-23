-- ============================================================
-- EPSIN — Deux entités dans un même établissement
--
--   « scolaire »   : l'élémentaire (CI -> CM2), dirigé par un DIRECTEUR
--   « secondaire » : le moyen + le secondaire (6ème -> Terminale),
--                     dirigé par un PRINCIPAL
--
-- Le cloisonnement est strict : chaque chef ne voit que son entité.
-- La comptabilité, elle, reste commune à l'établissement.
-- ============================================================

-- L entite se deduit du cycle, mais on la stocke explicitement :
-- elle porte une realite administrative (deux directions distinctes)
-- que le cycle pedagogique seul ne traduit pas.
ALTER TABLE niveau      ADD COLUMN IF NOT EXISTS entite TEXT;
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS entite TEXT;
ALTER TABLE enseignant  ADD COLUMN IF NOT EXISTS entite TEXT;

-- Rattachement des niveaux : l elementaire au scolaire, le reste au secondaire
UPDATE niveau SET entite = 'scolaire'   WHERE cycle = 'elementaire';
UPDATE niveau SET entite = 'secondaire' WHERE cycle IN ('moyen', 'secondaire');

-- Les nouveaux roles de direction. PostgreSQL n autorise pas ALTER TYPE
-- ADD VALUE dans un bloc transactionnel avant la v12 ; on protege l ajout.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role_utilisateur' AND e.enumlabel = 'directeur'
  ) THEN
    ALTER TYPE role_utilisateur ADD VALUE 'directeur';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role_utilisateur' AND e.enumlabel = 'principal'
  ) THEN
    ALTER TYPE role_utilisateur ADD VALUE 'principal';
  END IF;
END $$;

-- Un enseignant herite de l entite de son compte utilisateur
UPDATE enseignant en SET entite = u.entite
FROM utilisateur u WHERE u.id = en.utilisateur_id AND en.entite IS NULL;

-- Contrainte de coherence : seules ces deux valeurs sont admises
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'niveau_entite_valide') THEN
    ALTER TABLE niveau ADD CONSTRAINT niveau_entite_valide
      CHECK (entite IS NULL OR entite IN ('scolaire', 'secondaire'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utilisateur_entite_valide') THEN
    ALTER TABLE utilisateur ADD CONSTRAINT utilisateur_entite_valide
      CHECK (entite IS NULL OR entite IN ('scolaire', 'secondaire'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enseignant_entite_valide') THEN
    ALTER TABLE enseignant ADD CONSTRAINT enseignant_entite_valide
      CHECK (entite IS NULL OR entite IN ('scolaire', 'secondaire'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_niveau_entite ON niveau(entite);
CREATE INDEX IF NOT EXISTS idx_utilisateur_entite ON utilisateur(entite);
