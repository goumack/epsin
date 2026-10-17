-- ============================================================
-- EPSIN — Effacer les traces des eleves deja supprimes definitivement
--
-- Une suppression definitive fait desormais disparaitre l eleve du
-- systeme, traces comprises. Ce nettoyage, joue une fois, applique la meme
-- regle aux suppressions faites avant : journal d audit et notifications
-- qui designent un eleve, un paiement ou un compte parent qui n existent
-- plus. La ligne « suppression definitive » est gardee, sans nom ni
-- matricule.
-- ============================================================

DELETE FROM journal_audit j
WHERE j.action <> 'suppression_definitive'
  AND (
    (j.entite = 'eleve' AND j.entite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM eleve e WHERE e.id = j.entite_id))
    OR (j.entite = 'paiement' AND j.entite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM paiement p WHERE p.id = j.entite_id))
    OR (j.entite = 'paiement_en_ligne' AND j.entite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM paiement_en_ligne p WHERE p.id = j.entite_id))
    OR (j.action IN ('creation_compte_parent', 'reinitialisation_compte_parent')
       AND j.entite_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM utilisateur u WHERE u.id = j.entite_id))
  );

UPDATE journal_audit
SET details = details - 'nom' - 'matricule', entite_id = NULL
WHERE action = 'suppression_definitive' AND entite = 'eleve';

-- Notifications du personnel citant le matricule d un eleve qui n existe plus
DELETE FROM notification n
WHERE n.contenu ~ 'EP-[0-9]{4}-P?[0-9]+'
  AND NOT EXISTS (
    SELECT 1 FROM eleve e WHERE n.contenu LIKE '%' || e.matricule || '%'
  );
