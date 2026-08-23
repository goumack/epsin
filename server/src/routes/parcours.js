import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { accesAutorise, entiteDe, GESTION_SCOLAIRE } from '../middleware/entite.js';
import { estEnseignant, accesClasse } from '../middleware/portee-enseignant.js';
import { verifierEleveTuteur } from '../middleware/portee-tuteur.js';

/**
 * Parcours scolaire pluriannuel.
 *
 * Un eleve traverse plusieurs annees : CM2 en 2023-2024, 6eme en 2024-2025...
 * Chaque annee se cloture par une decision — passe, redouble, parti, abandon
 * ou exclu — qui determine ce qu il advient a la rentree suivante.
 */
const router = Router();
router.use(authentifier);

const GESTION = GESTION_SCOLAIRE;

/** Libelles lisibles des decisions de fin d annee. */
const LIBELLES = {
  passe: 'Admis en classe superieure',
  redouble: 'Redouble',
  parti: 'Transfere dans un autre etablissement',
  abandon: 'A quitte l ecole',
  exclu: 'Exclu par le conseil de discipline',
};

/**
 * Parcours complet d un eleve : une entree par annee scolaire, avec sa
 * classe, ses moyennes, son assiduite, sa situation financiere et la
 * decision de fin d annee.
 */
router.get('/eleve/:eleveId', async (req, res, next) => {
  try {
    const { eleveId } = req.params;

    // Cloisonnements : entite, classes de l enseignant, enfant du tuteur
    const controleTuteur = verifierEleveTuteur(req.user, eleveId);
    if (!controleTuteur.ok) {
      return res.status(controleTuteur.code).json({ erreur: controleTuteur.message });
    }

    const { rows: eleve } = await query(
      `SELECT id, matricule, prenom, nom, sexe, date_naissance, statut
       FROM eleve WHERE id = $1`,
      [eleveId]
    );
    if (!eleve[0]) return res.status(404).json({ erreur: 'Eleve introuvable' });

    // Une ligne par annee, de la plus recente a la plus ancienne
    const { rows: annees } = await query(
      `SELECT i.id AS inscription_id, i.annee_id, i.redoublant, i.statut,
              i.decision, i.motif_sortie, i.decide_le,
              a.libelle AS annee, a.date_debut, a.active,
              c.id AS classe_id, c.libelle AS classe,
              n.libelle AS niveau, n.cycle, n.entite, n.ordre AS niveau_ordre,
              d.prenom AS decideur_prenom, d.nom AS decideur_nom
       FROM inscription i
       JOIN annee_scolaire a ON a.id = i.annee_id
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       LEFT JOIN utilisateur d ON d.id = i.decide_par
       WHERE i.eleve_id = $1
       ORDER BY a.date_debut DESC`,
      [eleveId]
    );

    // Un enseignant ne voit que les annees ou l eleve etait dans une de ses
    // classes ; le cloisonnement d entite s applique a tous les autres.
    const visibles = [];
    for (const an of annees) {
      if (!accesAutorise(req.user, an.entite)) continue;
      if (estEnseignant(req.user) && !(await accesClasse(req.user, an.classe_id))) continue;
      visibles.push(an);
    }

    // Pour chaque annee visible : moyennes par periode, assiduite, finances
    for (const an of visibles) {
      const { rows: periodes } = await query(
        `WITH moy_matiere AS (
           SELECT p.id AS periode_id, p.libelle AS periode, ev.matiere_id,
                  SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                    / NULLIF(SUM(ev.coefficient),0) AS moy,
                  COALESCE(mn.coefficient, 1) AS coef
           FROM periode p
           JOIN evaluation ev ON ev.periode_id = p.id
           JOIN note n ON n.evaluation_id = ev.id AND n.eleve_id = $1
           LEFT JOIN matiere_niveau mn ON mn.matiere_id = ev.matiere_id
             AND mn.niveau_id = (SELECT niveau_id FROM classe WHERE id = $3)
           WHERE p.annee_id = $2 AND n.valeur IS NOT NULL
           GROUP BY p.id, p.libelle, ev.matiere_id, mn.coefficient
         )
         SELECT periode_id, periode,
                ROUND(SUM(moy * coef) / NULLIF(SUM(coef),0), 2) AS moyenne
         FROM moy_matiere
         GROUP BY periode_id, periode
         ORDER BY periode_id`,
        [eleveId, an.annee_id, an.classe_id]
      );
      an.periodes = periodes;

      const moyennes = periodes.map((p) => Number(p.moyenne)).filter(Number.isFinite);
      an.moyenne_annuelle = moyennes.length
        ? Number((moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2))
        : null;

      const { rows: abs } = await query(
        `SELECT COUNT(*) FILTER (WHERE a.type = 'absence')::int AS absences,
                COUNT(*) FILTER (WHERE a.type = 'retard')::int AS retards,
                COUNT(*) FILTER (WHERE a.type = 'absence' AND NOT a.justifiee)::int AS non_justifiees
         FROM absence a
         JOIN annee_scolaire an ON an.id = $2
         WHERE a.eleve_id = $1 AND a.date_abs BETWEEN an.date_debut AND an.date_fin`,
        [eleveId, an.annee_id]
      );
      an.assiduite = abs[0];

      const { rows: fin } = await query(
        `SELECT COALESCE(SUM(p.montant), 0)::numeric AS paye
         FROM paiement p
         WHERE p.eleve_id = $1 AND p.annee_id = $2 AND p.annule = false`,
        [eleveId, an.annee_id]
      );
      an.finances = { paye: Number(fin[0].paye) };

      an.decision_libelle = an.decision ? LIBELLES[an.decision] : null;
    }

    res.json({ eleve: eleve[0], annees: visibles });
  } catch (err) { next(err); }
});

/**
 * Feuille de fin d annee : tous les eleves d une classe avec leur moyenne
 * annuelle et la decision proposee, pour trancher en lot.
 */
router.get('/fin-annee/:classeId', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { classeId } = req.params;
    const { rows: cl } = await query(
      `SELECT c.id, c.libelle, c.niveau_id, c.annee_id,
              n.entite, n.ordre, n.libelle AS niveau
       FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
      [classeId]
    );
    if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
    if (!accesAutorise(req.user, cl[0].entite)) {
      return res.status(403).json({ erreur: 'Cette classe ne releve pas de votre entite' });
    }

    const { rows } = await query(
      `WITH moy_matiere AS (
         SELECT n.eleve_id, p.id AS periode_id, ev.matiere_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient),0) AS moy,
                COALESCE(mn.coefficient, 1) AS coef
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         JOIN periode p ON p.id = ev.periode_id
         LEFT JOIN matiere_niveau mn ON mn.matiere_id = ev.matiere_id AND mn.niveau_id = $2
         WHERE ev.classe_id = $1 AND p.annee_id = $3 AND n.valeur IS NOT NULL
         GROUP BY n.eleve_id, p.id, ev.matiere_id, mn.coefficient
       ),
       par_periode AS (
         SELECT eleve_id, periode_id,
                SUM(moy * coef) / NULLIF(SUM(coef),0) AS moyenne
         FROM moy_matiere GROUP BY eleve_id, periode_id
       ),
       annuelle AS (
         SELECT eleve_id, ROUND(AVG(moyenne), 2) AS moyenne
         FROM par_periode GROUP BY eleve_id
       )
       SELECT e.id AS eleve_id, e.matricule, e.prenom, e.nom,
              i.id AS inscription_id, i.redoublant, i.decision, i.motif_sortie,
              an.moyenne
       FROM inscription i
       JOIN eleve e ON e.id = i.eleve_id
       LEFT JOIN annuelle an ON an.eleve_id = e.id
       WHERE i.classe_id = $1 AND i.annee_id = $3
       ORDER BY an.moyenne DESC NULLS LAST, e.nom, e.prenom`,
      [classeId, cl[0].niveau_id, cl[0].annee_id]
    );

    // Le niveau suivant, pour proposer la classe d accueil
    const { rows: suivant } = await query(
      `SELECT id, libelle, entite FROM niveau
       WHERE ordre = $1 + 1 ORDER BY ordre LIMIT 1`,
      [cl[0].ordre]
    );

    const eleves = rows.map((r) => ({
      ...r,
      // Proposition : passe si la moyenne atteint 10, redouble sinon.
      // Sans moyenne, on ne propose rien.
      decision: r.decision
        ?? (r.moyenne == null ? null : Number(r.moyenne) >= 10 ? 'passe' : 'redouble'),
      propose: !r.decision,
    }));

    res.json({
      classe: cl[0],
      niveau_suivant: suivant[0] || null,
      eleves,
      synthese: {
        effectif: eleves.length,
        tranches: eleves.filter((e) => !e.propose).length,
        passent: eleves.filter((e) => e.decision === 'passe').length,
        redoublent: eleves.filter((e) => e.decision === 'redouble').length,
      },
    });
  } catch (err) { next(err); }
});

/** Enregistre la decision de fin d annee d un eleve. */
router.patch('/decision/:inscriptionId', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { decision, motif_sortie } = req.body;
    if (!['passe', 'redouble', 'parti', 'abandon', 'exclu'].includes(decision)) {
      return res.status(400).json({ erreur: 'Decision invalide' });
    }

    const { rows: insc } = await query(
      `SELECT i.id, i.eleve_id, n.entite
       FROM inscription i
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       WHERE i.id = $1`,
      [req.params.inscriptionId]
    );
    if (!insc[0]) return res.status(404).json({ erreur: 'Inscription introuvable' });
    if (!accesAutorise(req.user, insc[0].entite)) {
      return res.status(403).json({ erreur: 'Cet eleve ne releve pas de votre entite' });
    }

    // Le statut de l inscription et celui de l eleve decoulent de la decision
    const statutInscription = { passe: 'termine', redouble: 'termine',
      parti: 'transfere', abandon: 'abandon', exclu: 'exclu' }[decision];

    const rowsMaj = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE inscription
         SET decision = $2, motif_sortie = $3, statut = $4,
             decide_par = $5, decide_le = now()
         WHERE id = $1 RETURNING *`,
        [req.params.inscriptionId, decision, motif_sortie?.trim() || null,
         statutInscription, req.user.id]
      );

      // Un eleve qui part, abandonne ou est exclu n est plus actif
      if (['parti', 'abandon', 'exclu'].includes(decision)) {
        await client.query(
          `UPDATE eleve SET statut = $2 WHERE id = $1`,
          [insc[0].eleve_id, decision]
        );
      }
      return rows;
    });

    await tracer(req, `decision_${decision}`, 'inscription', Number(req.params.inscriptionId));
    res.json(rowsMaj[0]);
  } catch (err) { next(err); }
});

/**
 * Passage en lot : cree les inscriptions de l annee suivante pour les eleves
 * qui passent ou redoublent. Les partis, abandons et exclus sont ignores.
 */
router.post('/passage', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { classe_id, annee_cible_id, classe_cible_id, classe_redoublement_id } = req.body;
    if (!classe_id || !annee_cible_id) {
      return res.status(400).json({ erreur: 'Classe et annee cible requises' });
    }

    const { rows: cl } = await query(
      `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
      [classe_id]
    );
    if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
    if (!accesAutorise(req.user, cl[0].entite)) {
      return res.status(403).json({ erreur: 'Cette classe ne releve pas de votre entite' });
    }

    const { rows: inscriptions } = await query(
      `SELECT i.eleve_id, i.decision FROM inscription i
       WHERE i.classe_id = $1 AND i.decision IN ('passe','redouble')`,
      [classe_id]
    );

    const resultat = await transaction(async (client) => {
      let passes = 0;
      let redoubles = 0;
      let ignores = 0;

      for (const i of inscriptions) {
        const cible = i.decision === 'passe'
          ? classe_cible_id
          : (classe_redoublement_id || classe_id);
        if (!cible) { ignores++; continue; }

        // ON CONFLICT : relancer le passage ne cree pas de doublon
        const { rowCount } = await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_id, redoublant)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (eleve_id, annee_id) DO NOTHING`,
          [i.eleve_id, cible, annee_cible_id, i.decision === 'redouble']
        );
        if (rowCount) {
          if (i.decision === 'passe') passes++; else redoubles++;
        } else {
          ignores++;
        }
      }
      return { passes, redoubles, ignores };
    });

    await tracer(req, 'passage_annee', 'classe', Number(classe_id), resultat);
    res.json({
      message: `${resultat.passes} passage(s), ${resultat.redoubles} redoublement(s)`
        + (resultat.ignores ? `, ${resultat.ignores} ignore(s)` : ''),
      ...resultat,
    });
  } catch (err) { next(err); }
});

export default router;
