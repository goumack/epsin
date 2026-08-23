-- ============================================================
-- EPSIN — Bulletin au format officiel senegalais
--
-- Le modele officiel comporte :
--   * un en-tete administratif : IA (Inspection d Academie), IEF
--     (Inspection de l Education et de la Formation), etablissement
--   * un tableau : Devoir | Comp | Moy/20 | Coef | Moy x C | Rang | Appreciation
--   * l effectif de la classe et le nombre de redoublants
--   * deux grilles de decision du conseil de classe
--   * les observations du conseil et la signature du chef d etablissement
-- ============================================================

-- ---------- En-tete administratif ----------
ALTER TABLE etablissement ADD COLUMN IF NOT EXISTS inspection_academie TEXT;
ALTER TABLE etablissement ADD COLUMN IF NOT EXISTS inspection_ief TEXT;

UPDATE etablissement
SET inspection_academie = COALESCE(inspection_academie, 'IA DAKAR'),
    inspection_ief = COALESCE(inspection_ief, 'IEF Dakar 1')
WHERE inspection_academie IS NULL OR inspection_ief IS NULL;

-- ---------- Redoublement ----------
-- Le bulletin officiel indique si l eleve redouble sa classe.
ALTER TABLE inscription ADD COLUMN IF NOT EXISTS redoublant BOOLEAN NOT NULL DEFAULT false;

-- ---------- Decisions du conseil de classe ----------
-- Une ligne par eleve et par periode. Les cases sont pre-cochees selon la
-- moyenne, puis le conseil peut les corriger avant impression.
CREATE TABLE IF NOT EXISTS conseil_classe (
  id          SERIAL PRIMARY KEY,
  eleve_id    INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  periode_id  INT NOT NULL REFERENCES periode(id) ON DELETE CASCADE,

  -- Colonne de gauche du modele : appreciation generale du travail
  -- satisfaisant | peut_mieux_faire | insuffisant | risque_redoubler | risque_exclusion
  appreciation TEXT,

  -- Colonne de droite : distinction ou sanction
  -- felicitations | encouragement | tableau_honneur | avertissement | blame
  distinction  TEXT,

  observations TEXT,
  arrete_par   INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  arrete_le    TIMESTAMPTZ,

  UNIQUE (eleve_id, periode_id),
  CONSTRAINT conseil_appreciation_valide CHECK (
    appreciation IS NULL OR appreciation IN
      ('satisfaisant','peut_mieux_faire','insuffisant','risque_redoubler','risque_exclusion')
  ),
  CONSTRAINT conseil_distinction_valide CHECK (
    distinction IS NULL OR distinction IN
      ('felicitations','encouragement','tableau_honneur','avertissement','blame')
  )
);

CREATE INDEX IF NOT EXISTS idx_conseil_periode ON conseil_classe(periode_id);
