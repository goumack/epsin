-- ============================================================
-- EPSIN — Comptes parents crees a l inscription
--
-- Chaque eleve inscrit recoit aussitot un compte parent, avec un mot de
-- passe A USAGE UNIQUE remis sur une fiche imprimee. Tant que ce mot de
-- passe n a pas ete remplace, le compte ne donne acces qu au changement
-- de mot de passe : le serveur refuse tout le reste.
--
-- Le meme drapeau sert apres une reinitialisation par l administration.
-- ============================================================

ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS doit_changer_mdp BOOLEAN NOT NULL DEFAULT false;
