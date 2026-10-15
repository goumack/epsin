-- ============================================================
-- EPSIN — Eleves « cas social » et categorie des recettes
--
-- Un eleve cas social est pris en charge par l etablissement : il n a
-- l obligation de payer aucun frais. Il n apparait ni dans les impayes ni
-- dans les relances. La decision revient a l administrateur, avec son motif.
--
-- Chaque paiement porte une categorie de recette :
--   scolarite        frais de scolarite ordinaires ;
--   autres_recettes  ce que verse un eleve cas social (contribution
--                    volontaire...), qui n est pas une recette de scolarite.
-- La categorie est fixee a l encaissement : un eleve qui cesse d etre cas
-- social ne reclasse pas ses paiements passes.
-- ============================================================

ALTER TABLE eleve ADD COLUMN IF NOT EXISTS cas_social BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE eleve ADD COLUMN IF NOT EXISTS cas_social_motif TEXT;

ALTER TABLE paiement ADD COLUMN IF NOT EXISTS categorie TEXT NOT NULL DEFAULT 'scolarite';
ALTER TABLE paiement DROP CONSTRAINT IF EXISTS paiement_categorie_valide;
ALTER TABLE paiement ADD CONSTRAINT paiement_categorie_valide
  CHECK (categorie IN ('scolarite', 'autres_recettes'));
