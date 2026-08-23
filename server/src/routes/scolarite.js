import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import {
  filtreEntite, entiteDe, accesAutorise, GESTION_SCOLAIRE,
} from '../middleware/entite.js';
import {
  filtreClassesEnseignant, estEnseignant, accesClasse, enseignantDuCompte,
} from '../middleware/portee-enseignant.js';
import { eleveSuivi } from '../middleware/portee-tuteur.js';

const router = Router();
router.use(authentifier);

// Le directeur et le principal gerent la scolarite de leur entite
const GESTION = GESTION_SCOLAIRE;

/** Refuse l acces si le niveau vise n appartient pas a l entite du demandeur. */
async function verifierNiveau(req, niveauId) {
  const { rows } = await query(`SELECT entite FROM niveau WHERE id = $1`, [niveauId]);
  if (!rows[0]) return { ok: false, code: 404, message: 'Niveau introuvable' };
  if (!accesAutorise(req.user, rows[0].entite)) {
    return { ok: false, code: 403, message: 'Ce niveau ne relève pas de votre entité' };
  }
  return { ok: true };
}

/** Idem a partir d une classe. */
async function verifierClasse(req, classeId) {
  const { rows } = await query(
    `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
    [classeId]
  );
  if (!rows[0]) return { ok: false, code: 404, message: 'Classe introuvable' };
  if (!accesAutorise(req.user, rows[0].entite)) {
    return { ok: false, code: 403, message: 'Cette classe ne relève pas de votre entité' };
  }
  // Un enseignant n accede qu a ses propres classes, pas a toute son entite
  if (estEnseignant(req.user) && !(await accesClasse(req.user, classeId))) {
    return { ok: false, code: 403, message: 'Vous n enseignez pas dans cette classe' };
  }
  // Un tuteur n accede qu a la classe de son enfant
  const suivi = eleveSuivi(req.user);
  if (suivi != null) {
    const { rows: inscrit } = await query(
      `SELECT 1 FROM inscription
       WHERE eleve_id = $1 AND classe_id = $2
         AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
      [suivi, classeId]
    );
    if (!inscrit.length) {
      return { ok: false, code: 403, message: 'Votre enfant n est pas dans cette classe' };
    }
  }
  return { ok: true };
}

// ---------- Annees scolaires et periodes ----------
router.get('/annees', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM annee_scolaire ORDER BY date_debut DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/annees', autoriser('admin'), async (req, res, next) => {
  try {
    const { libelle, date_debut, date_fin, nb_periodes = 3 } = req.body;
    if (!libelle || !date_debut || !date_fin) {
      return res.status(400).json({ erreur: 'Libelle et dates requis' });
    }
    const annee = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO annee_scolaire (libelle, date_debut, date_fin) VALUES ($1,$2,$3) RETURNING *`,
        [libelle, date_debut, date_fin]
      );
      // Decoupage automatique en trimestres ou semestres
      const debut = new Date(date_debut), fin = new Date(date_fin);
      const duree = (fin - debut) / nb_periodes;
      const noms = nb_periodes === 2
        ? ['1er semestre', '2eme semestre']
        : ['1er trimestre', '2eme trimestre', '3eme trimestre'];
      for (let i = 0; i < nb_periodes; i++) {
        await client.query(
          `INSERT INTO periode (annee_id, libelle, ordre, date_debut, date_fin)
           VALUES ($1,$2,$3,$4,$5)`,
          [rows[0].id, noms[i] || `Periode ${i + 1}`, i + 1,
           new Date(debut.getTime() + duree * i).toISOString().slice(0, 10),
           new Date(debut.getTime() + duree * (i + 1) - 86400000).toISOString().slice(0, 10)]
        );
      }
      return rows[0];
    });
    await tracer(req, 'creation', 'annee_scolaire', annee.id);
    res.status(201).json(annee);
  } catch (err) { next(err); }
});

router.patch('/annees/:id/activer', autoriser('admin'), async (req, res, next) => {
  try {
    await transaction(async (client) => {
      await client.query(`UPDATE annee_scolaire SET active = false WHERE active`);
      await client.query(`UPDATE annee_scolaire SET active = true WHERE id = $1`, [req.params.id]);
    });
    await tracer(req, 'activation', 'annee_scolaire', Number(req.params.id));
    res.json({ message: 'Annee scolaire activee' });
  } catch (err) { next(err); }
});

router.get('/periodes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.* FROM periode p
       WHERE p.annee_id = COALESCE($1, (SELECT id FROM annee_scolaire WHERE active LIMIT 1))
       ORDER BY p.ordre`,
      [req.query.annee_id || null]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.patch('/periodes/:id/cloturer', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE periode SET cloturee = COALESCE($2, NOT cloturee) WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.cloturee ?? null]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Periode introuvable' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Niveaux ----------
router.get('/niveaux', async (req, res, next) => {
  try {
    const { clause, params } = filtreEntite(req.user, 'niveau', 1);
    const { rows } = await query(
      `SELECT * FROM niveau ${clause ? `WHERE ${clause}` : ''} ORDER BY ordre, libelle`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/niveaux', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { libelle, cycle, ordre } = req.body;
    if (!libelle || !cycle) return res.status(400).json({ erreur: 'Libelle et cycle requis' });
    const { rows } = await query(
      `INSERT INTO niveau (libelle, cycle, ordre) VALUES ($1,$2,COALESCE($3,0)) RETURNING *`,
      [libelle, cycle, ordre]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Classes ----------
router.get('/classes', async (req, res, next) => {
  try {
    // Un directeur ne voit que l elementaire, un proviseur que le moyen/secondaire
    const { clause, params } = filtreEntite(req.user, 'n', 1);
    // Un enseignant ne voit en plus que SES classes : celles ou il enseigne,
    // sa classe de maitre unique, ou celles dont il est professeur principal.
    const portee = await filtreClassesEnseignant(req.user, 'c', params.length + 1);
    const tousParams = [...params, ...portee.params];

    // Un tuteur ne voit que la classe de son enfant
    const suivi = eleveSuivi(req.user);
    let clauseTuteur = '';
    if (suivi != null) {
      tousParams.push(suivi);
      clauseTuteur = `c.id IN (SELECT i.classe_id FROM inscription i
                               WHERE i.eleve_id = $${tousParams.length}
                                 AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1))`;
    }
    const { rows } = await query(
      `SELECT c.*, n.libelle AS niveau, n.cycle, n.examen, n.entite,
              u.prenom AS pp_prenom, u.nom AS pp_nom,
              (SELECT COUNT(*)::int FROM inscription i
               JOIN eleve e ON e.id = i.eleve_id
               WHERE i.classe_id = c.id AND e.statut = 'actif') AS effectif
       FROM classe c
       JOIN niveau n ON n.id = c.niveau_id
       LEFT JOIN utilisateur u ON u.id = c.prof_principal_id
       WHERE c.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         ${clause ? `AND ${clause}` : ''}
         ${portee.clause ? `AND ${portee.clause}` : ''}
         ${clauseTuteur ? `AND ${clauseTuteur}` : ''}
       ORDER BY n.ordre, c.libelle`,
      tousParams
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/classes', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { niveau_id, libelle, capacite, salle, prof_principal_id } = req.body;
    if (!niveau_id || !libelle) return res.status(400).json({ erreur: 'Niveau et libelle requis' });

    const controle = await verifierNiveau(req, niveau_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const { rows } = await query(
      `INSERT INTO classe (annee_id, niveau_id, libelle, capacite, salle, prof_principal_id)
       VALUES ($1,$2,$3,COALESCE($4,60),$5,$6) RETURNING *`,
      [ar[0].id, niveau_id, libelle, capacite, salle || null, prof_principal_id || null]
    );
    await tracer(req, 'creation', 'classe', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/** Fiche detaillee d une classe : niveau, encadrement et statistiques. */
router.get('/classes/:id', async (req, res, next) => {
  try {
    const controle = await verifierClasse(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows } = await query(
      `SELECT c.*, n.libelle AS niveau, n.cycle, n.examen, n.entite, n.ordre,
              u.id AS pp_id, u.prenom AS pp_prenom, u.nom AS pp_nom,
              u.email AS pp_email, u.telephone AS pp_telephone,
              a.libelle AS annee,
              (SELECT COUNT(*)::int FROM inscription i
               JOIN eleve e ON e.id = i.eleve_id
               WHERE i.classe_id = c.id AND e.statut = 'actif') AS effectif,
              (SELECT COUNT(*)::int FROM inscription i
               JOIN eleve e ON e.id = i.eleve_id
               WHERE i.classe_id = c.id AND e.statut = 'actif' AND e.sexe = 'M') AS garcons,
              (SELECT COUNT(*)::int FROM inscription i
               JOIN eleve e ON e.id = i.eleve_id
               WHERE i.classe_id = c.id AND e.statut = 'actif' AND e.sexe = 'F') AS filles,
              (SELECT COUNT(*)::int FROM affectation af WHERE af.classe_id = c.id) AS nb_matieres,
              (SELECT COUNT(*)::int FROM creneau cr WHERE cr.classe_id = c.id) AS nb_creneaux
       FROM classe c
       JOIN niveau n ON n.id = c.niveau_id
       JOIN annee_scolaire a ON a.id = c.annee_id
       LEFT JOIN utilisateur u ON u.id = c.prof_principal_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/classes/:id/eleves', async (req, res, next) => {
  try {
    const controle = await verifierClasse(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows } = await query(
      `SELECT e.*,
              (SELECT t.telephone FROM tuteur t
               JOIN eleve_tuteur et ON et.tuteur_id = t.id
               WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1) AS contact_tuteur
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id
       WHERE i.classe_id = $1 AND e.statut = 'actif'
       ORDER BY e.nom, e.prenom`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/** Equipe pedagogique : un enseignant par matiere enseignee dans la classe. */
router.get('/classes/:id/enseignants', async (req, res, next) => {
  try {
    const controle = await verifierClasse(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows } = await query(
      `SELECT af.id AS affectation_id,
              m.id AS matiere_id, m.libelle AS matiere, m.couleur,
              COALESCE(mn.coefficient, 1) AS coefficient,
              en.id AS enseignant_id, en.specialite,
              u.prenom, u.nom, u.email, u.telephone
       FROM affectation af
       JOIN matiere m ON m.id = af.matiere_id
       JOIN classe c ON c.id = af.classe_id
       LEFT JOIN matiere_niveau mn ON mn.matiere_id = m.id AND mn.niveau_id = c.niveau_id
       LEFT JOIN enseignant en ON en.id = af.enseignant_id
       LEFT JOIN utilisateur u ON u.id = en.utilisateur_id
       WHERE af.classe_id = $1
         AND af.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       ORDER BY m.libelle`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/** Designe (ou retire) le professeur principal d une classe. */
router.patch('/classes/:id/professeur-principal', autoriser(...GESTION), async (req, res, next) => {
  try {
    const controle = await verifierClasse(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { utilisateur_id } = req.body;
    const { rows } = await query(
      `UPDATE classe SET prof_principal_id = $2 WHERE id = $1 RETURNING id, prof_principal_id`,
      [req.params.id, utilisateur_id || null]
    );
    await tracer(req, 'professeur_principal', 'classe', rows[0].id, { utilisateur_id });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/classes/:id', autoriser('admin'), async (req, res, next) => {
  try {
    const { rows: eff } = await query(
      `SELECT COUNT(*)::int AS n FROM inscription WHERE classe_id = $1`, [req.params.id]
    );
    if (eff[0].n > 0) {
      return res.status(400).json({ erreur: `Impossible : ${eff[0].n} eleve(s) inscrit(s) dans cette classe` });
    }
    await query(`DELETE FROM classe WHERE id = $1`, [req.params.id]);
    await tracer(req, 'suppression', 'classe', Number(req.params.id));
    res.json({ message: 'Classe supprimee' });
  } catch (err) { next(err); }
});

// ---------- Matieres ----------
router.get('/matieres', async (req, res, next) => {
  try {
    const params = [];
    const conditions = [];

    // Un enseignant ne voit que les matieres qui le concernent. Deux sources,
    // reunies par OR :
    //   1. celles ou il a une affectation explicite (cas du professeur de
    //      discipline au moyen/secondaire) ;
    //   2. TOUTES celles enseignees dans les niveaux de ses classes (cas du
    //      maitre unique, qui enseigne l integralite du programme de sa
    //      classe). Sans ce second cas, une matiere nouvellement creee par
    //      la direction resterait invisible du maitre tant qu aucune
    //      affectation n a ete saisie.
    if (estEnseignant(req.user)) {
      params.push(req.user.id);
      const idUtilisateur = `$${params.length}`;
      conditions.push(
        `(m.id IN (SELECT a.matiere_id FROM affectation a
                   JOIN enseignant en ON en.id = a.enseignant_id
                   WHERE en.utilisateur_id = ${idUtilisateur}
                     AND a.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1))
          OR m.id IN (SELECT mn2.matiere_id FROM matiere_niveau mn2
                      WHERE mn2.niveau_id IN (
                        SELECT c.niveau_id FROM classe_maitre cm
                        JOIN enseignant en2 ON en2.id = cm.enseignant_id
                        JOIN classe c ON c.id = cm.classe_id
                        WHERE en2.utilisateur_id = ${idUtilisateur})))`
      );
    } else {
      // Les chefs ne voient que les matieres enseignees dans leur entite
      const entite = entiteDe(req.user);
      if (entite) {
        params.push(entite);
        conditions.push(
          `m.id IN (SELECT mn2.matiere_id FROM matiere_niveau mn2
                    JOIN niveau n2 ON n2.id = mn2.niveau_id
                    WHERE n2.entite = $${params.length})`
        );
      }
    }

    const { rows } = await query(
      `SELECT m.*,
              COALESCE(json_agg(json_build_object('niveau_id', mn.niveau_id,
                                                  'coefficient', mn.coefficient))
                       FILTER (WHERE mn.id IS NOT NULL), '[]') AS coefficients
       FROM matiere m
       LEFT JOIN matiere_niveau mn ON mn.matiere_id = m.id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       GROUP BY m.id ORDER BY m.libelle`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/matieres', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { libelle, code, couleur, coefficients = [] } = req.body;
    if (!libelle) return res.status(400).json({ erreur: 'Libelle requis' });

    const matiere = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO matiere (libelle, code, couleur) VALUES ($1,$2,COALESCE($3,'#3b82f6')) RETURNING *`,
        [libelle, code || null, couleur]
      );
      for (const c of coefficients) {
        await client.query(
          `INSERT INTO matiere_niveau (matiere_id, niveau_id, coefficient, volume_horaire)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (matiere_id, niveau_id) DO UPDATE SET coefficient = EXCLUDED.coefficient`,
          [rows[0].id, c.niveau_id, c.coefficient ?? 1, c.volume_horaire || null]
        );
      }
      return rows[0];
    });
    res.status(201).json(matiere);
  } catch (err) { next(err); }
});

/**
 * Verifie qu un chef peut toucher a cette matiere : elle doit etre
 * enseignee dans son entite. Un directeur ne modifie pas le coefficient
 * de la philosophie du lycee, et inversement.
 */
async function verifierMatiere(req, matiereId) {
  const { rows } = await query(`SELECT 1 FROM matiere WHERE id = $1`, [matiereId]);
  if (!rows.length) return { ok: false, code: 404, message: 'Matiere introuvable' };

  const entite = entiteDe(req.user);
  if (!entite) return { ok: true };          // admin : acces complet

  const { rows: dansEntite } = await query(
    `SELECT 1 FROM matiere_niveau mn
     JOIN niveau n ON n.id = mn.niveau_id
     WHERE mn.matiere_id = $1 AND n.entite = $2`,
    [matiereId, entite]
  );
  if (!dansEntite.length) {
    return { ok: false, code: 403, message: 'Cette matiere ne releve pas de votre entite' };
  }
  return { ok: true, entite };
}

// Modification : libelle, code, couleur et coefficients par niveau
router.patch('/matieres/:id', autoriser(...GESTION), async (req, res, next) => {
  try {
    const controle = await verifierMatiere(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { libelle, code, couleur, coefficients } = req.body;

    const matiere = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE matiere
         SET libelle = COALESCE($2, libelle),
             code = COALESCE($3, code),
             couleur = COALESCE($4, couleur)
         WHERE id = $1 RETURNING *`,
        [req.params.id, libelle || null, code || null, couleur || null]
      );

      // Les coefficients sont mis a jour niveau par niveau. Un chef ne peut
      // toucher qu aux niveaux de son entite : on filtre cote serveur pour
      // qu une requete forgee ne modifie pas l autre cycle.
      for (const c of coefficients || []) {
        if (controle.entite) {
          const { rows: ok } = await client.query(
            `SELECT 1 FROM niveau WHERE id = $1 AND entite = $2`,
            [c.niveau_id, controle.entite]
          );
          if (!ok.length) continue;
        }
        await client.query(
          `INSERT INTO matiere_niveau (matiere_id, niveau_id, coefficient)
           VALUES ($1,$2,$3)
           ON CONFLICT (matiere_id, niveau_id)
           DO UPDATE SET coefficient = EXCLUDED.coefficient`,
          [req.params.id, c.niveau_id, c.coefficient ?? 1]
        );
      }
      return rows[0];
    });

    await tracer(req, 'modification_matiere', 'matiere', Number(req.params.id));
    res.json(matiere);
  } catch (err) { next(err); }
});

// Suppression : refusee si des evaluations existent deja, pour ne pas
// detruire des bulletins.
router.delete('/matieres/:id', autoriser(...GESTION), async (req, res, next) => {
  try {
    const controle = await verifierMatiere(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows: ev } = await query(
      `SELECT COUNT(*)::int AS n FROM evaluation WHERE matiere_id = $1`, [req.params.id]
    );
    if (ev[0].n > 0) {
      return res.status(400).json({
        erreur: `Impossible : ${ev[0].n} evaluation(s) portent sur cette matiere`,
      });
    }
    const { rows: af } = await query(
      `SELECT COUNT(*)::int AS n FROM affectation WHERE matiere_id = $1`, [req.params.id]
    );
    if (af[0].n > 0) {
      return res.status(400).json({
        erreur: `Impossible : ${af[0].n} enseignant(s) affecte(s) a cette matiere`,
      });
    }

    await query(`DELETE FROM matiere WHERE id = $1`, [req.params.id]);
    await tracer(req, 'suppression_matiere', 'matiere', Number(req.params.id));
    res.json({ message: 'Matiere supprimee' });
  } catch (err) { next(err); }
});

// ---------- Enseignants et affectations ----------
router.get('/enseignants', async (req, res, next) => {
  try {
    // Chaque chef d etablissement ne voit que les enseignants de son entite
    const { clause, params } = filtreEntite(req.user, 'en', 1);
    const conditions = clause ? [clause] : [];

    // Un enseignant n a pas a consulter le trombinoscope de ses collegues
    // ni leurs affectations : il ne voit que sa propre fiche.
    if (estEnseignant(req.user)) {
      params.push(req.user.id);
      conditions.push(`en.utilisateur_id = $${params.length}`);
    }

    // Un tuteur ne voit que les enseignants qui interviennent aupres de
    // son enfant : l equipe pedagogique de sa classe, personne d autre.
    const suivi = eleveSuivi(req.user);
    if (suivi != null) {
      params.push(suivi);
      conditions.push(
        `en.id IN (
           SELECT a.enseignant_id FROM affectation a
           JOIN inscription i ON i.classe_id = a.classe_id
           WHERE i.eleve_id = $${params.length}
             AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
             AND a.annee_id = i.annee_id
           UNION
           SELECT cm.enseignant_id FROM classe_maitre cm
           JOIN inscription i2 ON i2.classe_id = cm.classe_id
           WHERE i2.eleve_id = $${params.length}
             AND i2.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1))`
      );
    }

    const { rows } = await query(
      `SELECT en.*, u.prenom, u.nom, u.email, u.telephone, u.photo_url, u.actif,
              COALESCE(json_agg(DISTINCT jsonb_build_object(
                'classe', c.libelle, 'matiere', m.libelle))
                FILTER (WHERE a.id IS NOT NULL), '[]') AS affectations
       FROM enseignant en
       JOIN utilisateur u ON u.id = en.utilisateur_id
       LEFT JOIN affectation a ON a.enseignant_id = en.id
         AND a.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = a.classe_id
       LEFT JOIN matiere m ON m.id = a.matiere_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       GROUP BY en.id, u.prenom, u.nom, u.email, u.telephone, u.photo_url, u.actif
       ORDER BY u.nom, u.prenom`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/affectations', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { enseignant_id, classe_id, matiere_id } = req.body;
    if (!enseignant_id || !classe_id || !matiere_id) {
      return res.status(400).json({ erreur: 'Enseignant, classe et matiere requis' });
    }

    const controle = await verifierClasse(req, classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    // Un enseignant ne peut intervenir que dans son entite de rattachement
    const { rows: ens } = await query(
      `SELECT en.entite FROM enseignant en WHERE en.id = $1`, [enseignant_id]
    );
    if (!ens[0]) return res.status(404).json({ erreur: 'Enseignant introuvable' });

    const { rows: cl } = await query(
      `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
      [classe_id]
    );
    if (ens[0].entite && ens[0].entite !== cl[0].entite) {
      return res.status(400).json({
        erreur: `Cet enseignant est rattaché à l'entité « ${ens[0].entite} » et ne peut pas enseigner dans cette classe`,
      });
    }

    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    const { rows } = await query(
      `INSERT INTO affectation (enseignant_id, classe_id, matiere_id, annee_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (classe_id, matiere_id, annee_id)
       DO UPDATE SET enseignant_id = EXCLUDED.enseignant_id
       RETURNING *`,
      [enseignant_id, classe_id, matiere_id, ar[0].id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Emploi du temps ----------
router.get('/emploi-du-temps/:classeId', async (req, res, next) => {
  try {
    const controle = await verifierClasse(req, req.params.classeId);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows } = await query(
      `SELECT cr.*, m.libelle AS matiere, m.couleur,
              u.prenom AS ens_prenom, u.nom AS ens_nom,
              u.id AS ens_utilisateur_id
       FROM creneau cr
       JOIN matiere m ON m.id = cr.matiere_id
       LEFT JOIN enseignant en ON en.id = cr.enseignant_id
       LEFT JOIN utilisateur u ON u.id = en.utilisateur_id
       WHERE cr.classe_id = $1
       ORDER BY cr.jour, cr.heure_debut`,
      [req.params.classeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * Verifie qu un enseignant a le droit de poser ou modifier ce creneau :
 * il doit s agir de SA matiere dans SA classe. Les chefs ne sont pas
 * concernes (ils organisent l emploi du temps de toute leur entite).
 */
async function verifierCreneauEnseignant(req, classeId, matiereId, enseignantId) {
  if (!estEnseignant(req.user)) return { ok: true };

  const ens = await enseignantDuCompte(req.user.id);
  if (!ens) return { ok: false, code: 403, message: 'Compte non rattache a un enseignant' };

  // Un enseignant ne place que ses propres heures
  if (enseignantId && Number(enseignantId) !== ens.id) {
    return { ok: false, code: 403, message: 'Vous ne pouvez placer que vos propres heures' };
  }

  // Deux titres legitimes : une affectation explicite sur cette matiere,
  // ou le fait d etre le maitre unique de la classe — il enseigne alors
  // tout le programme, y compris une matiere ajoutee apres coup par la
  // direction et pas encore affectee.
  const { rows } = await query(
    `SELECT 1 FROM affectation
     WHERE enseignant_id = $1 AND classe_id = $2 AND matiere_id = $3
       AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
     UNION ALL
     SELECT 1 FROM classe_maitre cm
     JOIN classe c ON c.id = cm.classe_id
     JOIN matiere_niveau mn ON mn.niveau_id = c.niveau_id
     WHERE cm.enseignant_id = $1 AND cm.classe_id = $2 AND mn.matiere_id = $3`,
    [ens.id, classeId, matiereId]
  );
  if (!rows.length) {
    return {
      ok: false, code: 403,
      message: 'Vous n enseignez pas cette matiere dans cette classe',
    };
  }
  return { ok: true, enseignantId: ens.id };
}

// Les enseignants gerent leurs propres heures ; les chefs celles de leur entite
router.post('/creneaux', autoriser(...GESTION, 'enseignant'), async (req, res, next) => {
  try {
    const { classe_id, matiere_id, jour, heure_debut, heure_fin, salle } = req.body;
    let { enseignant_id } = req.body;
    if (!classe_id || !matiere_id || !jour || !heure_debut || !heure_fin) {
      return res.status(400).json({ erreur: 'Classe, matiere, jour et horaires requis' });
    }

    const controle = await verifierClasse(req, classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const controleEns = await verifierCreneauEnseignant(req, classe_id, matiere_id, enseignant_id);
    if (!controleEns.ok) {
      return res.status(controleEns.code).json({ erreur: controleEns.message });
    }
    // Un enseignant qui ne se designe pas explicitement est l intervenant
    if (controleEns.enseignantId) enseignant_id = controleEns.enseignantId;

    // Conflit 1 : la classe a deja cours sur ce creneau
    const { rows: conflitClasse } = await query(
      `SELECT 1 FROM creneau WHERE classe_id = $1 AND jour = $2
       AND heure_debut < $4::time AND heure_fin > $3::time`,
      [classe_id, jour, heure_debut, heure_fin]
    );
    if (conflitClasse.length) {
      return res.status(409).json({ erreur: 'La classe a deja cours sur ce creneau' });
    }

    // Conflit 2 : l enseignant est deja en cours ailleurs
    if (enseignant_id) {
      const { rows: conflitEns } = await query(
        `SELECT c.libelle FROM creneau cr JOIN classe c ON c.id = cr.classe_id
         WHERE cr.enseignant_id = $1 AND cr.jour = $2
         AND cr.heure_debut < $4::time AND cr.heure_fin > $3::time`,
        [enseignant_id, jour, heure_debut, heure_fin]
      );
      if (conflitEns.length) {
        return res.status(409).json({
          erreur: `Enseignant deja occupe (${conflitEns[0].libelle}) sur ce creneau`,
        });
      }
    }

    const { rows } = await query(
      `INSERT INTO creneau (classe_id, matiere_id, enseignant_id, jour, heure_debut, heure_fin, salle)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [classe_id, matiere_id, enseignant_id || null, jour, heure_debut, heure_fin, salle || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * Charge un creneau et verifie que le demandeur peut y toucher :
 * la classe doit relever de son perimetre, et un enseignant ne modifie
 * que les creneaux dont il est l intervenant.
 */
async function creneauModifiable(req, creneauId) {
  const { rows } = await query(
    `SELECT cr.*, en.utilisateur_id AS ens_utilisateur_id
     FROM creneau cr
     LEFT JOIN enseignant en ON en.id = cr.enseignant_id
     WHERE cr.id = $1`,
    [creneauId]
  );
  if (!rows[0]) return { ok: false, code: 404, message: 'Creneau introuvable' };

  const controle = await verifierClasse(req, rows[0].classe_id);
  if (!controle.ok) return controle;

  if (estEnseignant(req.user) && rows[0].ens_utilisateur_id !== req.user.id) {
    return { ok: false, code: 403, message: 'Ce cours n est pas le votre' };
  }
  return { ok: true, creneau: rows[0] };
}

// Modification d un creneau : deplacer l heure, changer le jour ou la salle
router.patch('/creneaux/:id', autoriser(...GESTION, 'enseignant'), async (req, res, next) => {
  try {
    const controle = await creneauModifiable(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });
    const actuel = controle.creneau;

    const jour = req.body.jour ?? actuel.jour;
    const heureDebut = req.body.heure_debut ?? actuel.heure_debut;
    const heureFin = req.body.heure_fin ?? actuel.heure_fin;
    const salle = req.body.salle !== undefined ? req.body.salle : actuel.salle;

    // Memes controles de conflit qu a la creation, en s excluant soi-meme
    const { rows: conflitClasse } = await query(
      `SELECT 1 FROM creneau WHERE classe_id = $1 AND jour = $2
       AND heure_debut < $4::time AND heure_fin > $3::time AND id <> $5`,
      [actuel.classe_id, jour, heureDebut, heureFin, req.params.id]
    );
    if (conflitClasse.length) {
      return res.status(409).json({ erreur: 'La classe a deja cours sur ce creneau' });
    }

    if (actuel.enseignant_id) {
      const { rows: conflitEns } = await query(
        `SELECT c.libelle FROM creneau cr JOIN classe c ON c.id = cr.classe_id
         WHERE cr.enseignant_id = $1 AND cr.jour = $2
         AND cr.heure_debut < $4::time AND cr.heure_fin > $3::time AND cr.id <> $5`,
        [actuel.enseignant_id, jour, heureDebut, heureFin, req.params.id]
      );
      if (conflitEns.length) {
        return res.status(409).json({
          erreur: `Vous avez deja cours (${conflitEns[0].libelle}) sur ce creneau`,
        });
      }
    }

    const { rows } = await query(
      `UPDATE creneau SET jour = $2, heure_debut = $3, heure_fin = $4, salle = $5
       WHERE id = $1 RETURNING *`,
      [req.params.id, jour, heureDebut, heureFin, salle || null]
    );
    await tracer(req, 'modification_creneau', 'creneau', rows[0].id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/creneaux/:id', autoriser(...GESTION, 'enseignant'), async (req, res, next) => {
  try {
    const controle = await creneauModifiable(req, req.params.id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    await query(`DELETE FROM creneau WHERE id = $1`, [req.params.id]);
    await tracer(req, 'suppression_creneau', 'creneau', Number(req.params.id));
    res.json({ message: 'Creneau supprime' });
  } catch (err) { next(err); }
});

export default router;
