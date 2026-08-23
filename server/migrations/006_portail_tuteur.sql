-- ============================================================
-- EPSIN — Portail du tuteur
--
-- Un tuteur suit la scolarite de son enfant : notes, bulletins, assiduite,
-- finances. Il peut aussi SIGNALER une absence (maladie...), qui reste « a
-- confirmer » tant que la vie scolaire ne l a pas justifiee : un parent ne
-- justifie pas seul l absence de son enfant.
--
-- Identifiant de connexion : le MATRICULE de l eleve suivi de @epsin.sn
-- (ex. ep-2026-0014@epsin.sn). Un compte par enfant : le tuteur d une
-- fratrie se connecte avec le matricule de l enfant concerne.
-- ============================================================

-- Rattache un compte parent a l eleve qu il suit. La colonne
-- tuteur.utilisateur_id existe deja mais ne dit pas DE QUEL eleve il
-- s agit quand un tuteur suit plusieurs enfants : on stocke donc le lien
-- au niveau du compte lui-meme.
ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS eleve_suivi_id
  INT REFERENCES eleve(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_utilisateur_eleve_suivi
  ON utilisateur(eleve_suivi_id);

-- Un compte parent doit toujours designer l eleve qu il suit ; les autres
-- roles n ont pas d eleve rattache.
ALTER TABLE utilisateur DROP CONSTRAINT IF EXISTS utilisateur_eleve_suivi_coherent;
ALTER TABLE utilisateur ADD CONSTRAINT utilisateur_eleve_suivi_coherent CHECK (
  (role = 'parent' AND eleve_suivi_id IS NOT NULL)
  OR (role <> 'parent' AND eleve_suivi_id IS NULL)
);

-- ---------- Absences signalees par un tuteur ----------
-- On enrichit la table existante plutot que d en creer une seconde : une
-- absence signalee par le parent est une absence comme une autre, elle
-- porte simplement la trace de son origine et attend confirmation.
ALTER TABLE absence ADD COLUMN IF NOT EXISTS signalee_par INT
  REFERENCES utilisateur(id) ON DELETE SET NULL;
ALTER TABLE absence ADD COLUMN IF NOT EXISTS motif_tuteur TEXT;
ALTER TABLE absence ADD COLUMN IF NOT EXISTS confirmee BOOLEAN NOT NULL DEFAULT true;

-- Les absences deja saisies par l ecole restent confirmees ; seules celles
-- qui viendront d un tuteur arriveront avec confirmee = false.
COMMENT ON COLUMN absence.confirmee IS
  'false = signalee par le tuteur, en attente de validation par la vie scolaire';
