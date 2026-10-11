-- ============================================================
-- EPSIN — Mot de passe temporaire consultable par l etablissement
--
-- Le mot de passe a usage unique d une fiche d acces est conserve CHIFFRE
-- (AES-256-GCM) tant que son titulaire ne l a pas remplace. L ecole peut
-- ainsi le reafficher et reimprimer la fiche d inscription sans le changer.
-- Il est efface des que le titulaire choisit son mot de passe personnel :
-- celui-ci, lui, n est jamais consultable.
-- ============================================================

ALTER TABLE utilisateur ADD COLUMN IF NOT EXISTS mdp_temporaire TEXT;
