-- ============================================================
-- EPSIN — Paiement Wave confirme automatiquement par WavePay
--
-- Mode « wavepay » : la demande du parent est creee chez WavePay, qui
-- renvoie le montant exact a payer (amount_due, parfois quelques francs
-- de plus pour distinguer deux paiements simultanes) et les liens de
-- paiement (bouton Wave, QR code, page de paiement). WavePay confirme par
-- un webhook signe ; chaque evenement n est traite qu une fois.
-- ============================================================

ALTER TABLE paiement_en_ligne DROP CONSTRAINT IF EXISTS paiement_en_ligne_mode_valide;
ALTER TABLE paiement_en_ligne ADD CONSTRAINT paiement_en_ligne_mode_valide
  CHECK (mode IN ('lien', 'api', 'simulation', 'wavepay'));

-- Montant exact a faire payer (amount_due de WavePay)
ALTER TABLE paiement_en_ligne ADD COLUMN IF NOT EXISTS montant_du NUMERIC(12,2);
-- Liens de paiement : bouton Wave, intent Android, QR code, page hebergee
ALTER TABLE paiement_en_ligne ADD COLUMN IF NOT EXISTS liens JSONB;

-- Evenements de webhook deja traites (un evenement peut arriver plusieurs fois)
CREATE TABLE IF NOT EXISTS wavepay_evenement (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,
  recu_le  TIMESTAMPTZ NOT NULL DEFAULT now()
);
