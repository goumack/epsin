-- ============================================================
-- EPSIN — Annulation tracee d un paiement
--
-- Une ecriture encaissee par erreur n est jamais modifiee ni effacee : elle
-- est annulee (barree sur le recu), puis le bon montant est re-encaisse.
-- On garde qui a annule, quand et pourquoi, pour l afficher sur le recu.
-- ============================================================

ALTER TABLE paiement ADD COLUMN IF NOT EXISTS annule_le TIMESTAMPTZ;
ALTER TABLE paiement ADD COLUMN IF NOT EXISTS annule_par INT REFERENCES utilisateur(id) ON DELETE SET NULL;
ALTER TABLE paiement ADD COLUMN IF NOT EXISTS motif_annulation TEXT;
