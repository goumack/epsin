-- ============================================================
-- EPSIN — Paiement en ligne des mensualites par Wave
--
-- Le tuteur regle depuis son portail. Chaque tentative est suivie dans
-- `paiement_en_ligne`. Les ecritures comptables (`paiement`, une par mois
-- couvert, avec leur numero de recu) ne sont creees qu a la CONFIRMATION.
--
-- Trois modes :
--   lien        Lien marchand Wave fixe (pay.wave.com/m/...). Wave ne
--               previent pas l application : le tuteur declare son
--               identifiant de transaction, la caisse verifie dans son
--               espace Wave Business puis valide ou rejette.
--   api         API Checkout Wave : confirmation automatique par webhook.
--   simulation  Developpement, sans compte Wave. Jamais en production.
--
-- Cycle de vie :
--   en_attente -> a_verifier -> reussi | rejete      (mode lien)
--   en_attente -> reussi | echoue | expire           (mode api)
-- ============================================================

CREATE TABLE IF NOT EXISTS paiement_en_ligne (
  id               SERIAL PRIMARY KEY,
  fournisseur      TEXT NOT NULL DEFAULT 'wave',
  mode             TEXT NOT NULL,
  eleve_id         INT NOT NULL REFERENCES eleve(id) ON DELETE CASCADE,
  frais_id         INT NOT NULL REFERENCES frais(id) ON DELETE RESTRICT,
  annee_id         INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
  nb_mois          INT NOT NULL CHECK (nb_mois > 0),
  montant          NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  statut           TEXT NOT NULL DEFAULT 'en_attente',
  -- Session Checkout chez Wave (cos-...), mode api uniquement
  session_id       TEXT UNIQUE,
  url_paiement     TEXT,
  -- Identifiant de la transaction Wave : declare par le tuteur (mode lien)
  -- ou transmis par Wave (mode api)
  transaction_id   TEXT,
  telephone_payeur TEXT,
  initie_par       INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  declare_le       TIMESTAMPTZ,
  verifie_par      INT REFERENCES utilisateur(id) ON DELETE SET NULL,
  verifie_le       TIMESTAMPTZ,
  erreur           TEXT,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expire_le        TIMESTAMPTZ,
  confirme_le      TIMESTAMPTZ,
  CONSTRAINT paiement_en_ligne_mode_valide
    CHECK (mode IN ('lien', 'api', 'simulation')),
  CONSTRAINT paiement_en_ligne_statut_valide
    CHECK (statut IN ('en_attente', 'a_verifier', 'reussi', 'rejete', 'echoue', 'expire'))
);
CREATE INDEX IF NOT EXISTS idx_paiement_en_ligne_eleve
  ON paiement_en_ligne(eleve_id, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_paiement_en_ligne_statut
  ON paiement_en_ligne(statut);
-- Une meme transaction Wave ne peut pas solder deux tentatives
CREATE UNIQUE INDEX IF NOT EXISTS idx_paiement_en_ligne_transaction
  ON paiement_en_ligne(fournisseur, upper(transaction_id))
  WHERE transaction_id IS NOT NULL AND statut <> 'rejete';

-- Les ecritures nees d un paiement en ligne gardent le lien vers lui
ALTER TABLE paiement
  ADD COLUMN IF NOT EXISTS paiement_en_ligne_id INT
  REFERENCES paiement_en_ligne(id) ON DELETE SET NULL;
