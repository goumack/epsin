-- ============================================================
-- EPSIN — Correction du modele de l elementaire
--
-- Le systeme senegalais n a PAS de "matieres" au sens du secondaire pour
-- l elementaire (CI -> CM2). Le programme officiel (CEB, Curriculum de
-- l Education de Base) organise l enseignement en 4 DOMAINES, tous pris
-- en charge par un seul MAITRE POLYVALENT (l instituteur titulaire de la
-- classe), et non par un professeur different par discipline.
--
-- Domaines officiels du CEB :
--   LC    Langue et Communication
--   MATH  Mathematiques
--   ESVS  Education a la Science et a la Vie Sociale
--   EPSA  Education Physique, Sportive et Artistique
--
-- Vocabulaire officiel : "maitre" ou "instituteur" a l elementaire,
-- "professeur" au moyen/secondaire uniquement.
-- ============================================================

-- Un domaine du CEB n a pas de coefficient variable par niveau comme au
-- secondaire : le programme du maitre unique ne pondere pas ses propres
-- domaines les uns contre les autres de la meme facon. On garde neanmoins
-- matiere_niveau pour la ponderation utilisee dans le calcul des moyennes,
-- mais on marque les domaines pour les distinguer des matieres classiques.
ALTER TABLE matiere ADD COLUMN IF NOT EXISTS domaine_ceb BOOLEAN NOT NULL DEFAULT false;

-- Marque l affectation d un maitre unique a une classe entiere (par
-- opposition a une affectation matiere par matiere comme au secondaire).
-- classe_id est UNIQUE : une classe elementaire n a qu un seul maitre.
CREATE TABLE IF NOT EXISTS classe_maitre (
  id            SERIAL PRIMARY KEY,
  classe_id     INT NOT NULL UNIQUE REFERENCES classe(id) ON DELETE CASCADE,
  enseignant_id INT NOT NULL REFERENCES enseignant(id) ON DELETE CASCADE,
  annee_id      INT NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_classe_maitre_annee ON classe_maitre(annee_id);

-- ---------- Nettoyage des donnees existantes de demonstration ----------
-- Les evaluations, notes, creneaux et affectations bases sur les 6 fausses
-- matieres de l elementaire n ont plus de sens : on les retire pour que le
-- prochain seed reconstruise sur les 4 domaines CEB. Le moyen/secondaire
-- n est pas touche.
DELETE FROM note n USING evaluation ev, classe c, niveau niv
  WHERE n.evaluation_id = ev.id AND ev.classe_id = c.id
    AND c.niveau_id = niv.id AND niv.entite = 'scolaire';

DELETE FROM evaluation ev USING classe c, niveau niv
  WHERE ev.classe_id = c.id AND c.niveau_id = niv.id AND niv.entite = 'scolaire';

DELETE FROM creneau cr USING classe c, niveau niv
  WHERE cr.classe_id = c.id AND c.niveau_id = niv.id AND niv.entite = 'scolaire';

DELETE FROM affectation af USING classe c, niveau niv
  WHERE af.classe_id = c.id AND c.niveau_id = niv.id AND niv.entite = 'scolaire';

DELETE FROM matiere_niveau mn USING niveau niv
  WHERE mn.niveau_id = niv.id AND niv.entite = 'scolaire';

-- Supprime les matieres qui ne servaient qu a l elementaire et n ont plus
-- aucun rattachement (Lecture, Eveil scientifique n existent qu au CEB ;
-- Francais, Mathematiques, Histoire-Geographie, EPS restent utilisees au
-- moyen/secondaire et ne sont donc pas supprimees).
DELETE FROM matiere
WHERE libelle IN ('Lecture', 'Eveil scientifique')
  AND NOT EXISTS (SELECT 1 FROM matiere_niveau mn WHERE mn.matiere_id = matiere.id);
