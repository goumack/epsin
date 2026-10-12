-- ============================================================
-- EPSIN — Encaissement de plusieurs mois au guichet
--
-- Un versement au guichet sur une mensualite peut couvrir plusieurs mois
-- (avance) : il est ventile en une ecriture par mois, comme un paiement
-- Wave. `lot` regroupe les ecritures d un meme encaissement (il vaut l id
-- de la premiere) : un seul recu, une seule annulation.
-- ============================================================

ALTER TABLE paiement ADD COLUMN IF NOT EXISTS lot INT;
CREATE INDEX IF NOT EXISTS idx_paiement_lot ON paiement(lot) WHERE lot IS NOT NULL;
