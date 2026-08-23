import { Router } from 'express';
import { query } from '../db/pool.js';
import { authentifier } from '../middleware/auth.js';
import { entiteDe } from '../middleware/entite.js';

const router = Router();
router.use(authentifier);

/** Statistiques globales adaptees au role de l utilisateur. */
router.get('/', async (req, res, next) => {
  try {
    const { rows: annee } = await query(`SELECT * FROM annee_scolaire WHERE active LIMIT 1`);
    if (!annee[0]) {
      return res.json({ annee: null, message: 'Aucune annee scolaire active' });
    }

    const base = {};
    // Un directeur ou un principal ne voit que les chiffres de son entite
    const entite = entiteDe(req.user);
    base.entite = entite;

    const { rows: eff } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.sexe = 'M')::int AS garcons,
              COUNT(*) FILTER (WHERE e.sexe = 'F')::int AS filles
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $1
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       WHERE e.statut = 'actif' AND ($2::text IS NULL OR n.entite = $2)`,
      [annee[0].id, entite]
    );
    base.effectifs = eff[0];

    const { rows: cl } = await query(
      `SELECT COUNT(*)::int AS classes,
              (SELECT COUNT(*)::int FROM enseignant en
               WHERE $2::text IS NULL OR en.entite = $2) AS enseignants
       FROM classe c
       JOIN niveau n ON n.id = c.niveau_id
       WHERE c.annee_id = $1 AND ($2::text IS NULL OR n.entite = $2)`,
      [annee[0].id, entite]
    );
    base.structure = cl[0];

    // Repartition par classe (pour les graphiques)
    const { rows: parClasse } = await query(
      `SELECT c.libelle AS classe, COUNT(i.id)::int AS effectif, c.capacite, n.entite
       FROM classe c
       JOIN niveau n ON n.id = c.niveau_id
       LEFT JOIN inscription i ON i.classe_id = c.id
       LEFT JOIN eleve e ON e.id = i.eleve_id AND e.statut = 'actif'
       WHERE c.annee_id = $1 AND ($2::text IS NULL OR n.entite = $2)
       GROUP BY c.id, n.entite, n.ordre ORDER BY n.ordre, c.libelle`,
      [annee[0].id, entite]
    );
    base.par_classe = parClasse;

    // Absences des 7 derniers jours, limitees a l entite
    const { rows: absRecentes } = await query(
      `SELECT a.date_abs::text AS date, COUNT(*)::int AS nombre
       FROM absence a
       JOIN inscription i ON i.eleve_id = a.eleve_id AND i.annee_id = $1
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       WHERE a.date_abs >= CURRENT_DATE - INTERVAL '7 days'
         AND ($2::text IS NULL OR n.entite = $2)
       GROUP BY a.date_abs ORDER BY a.date_abs`,
      [annee[0].id, entite]
    );
    base.absences_semaine = absRecentes;

    // Volet financier reserve aux profils habilites
    if (['admin', 'comptable'].includes(req.user.role)) {
      const { rows: fin } = await query(
        `SELECT
           (SELECT COALESCE(SUM(montant),0) FROM paiement
            WHERE NOT annule AND annee_id = $1) AS recettes,
           (SELECT COALESCE(SUM(montant),0) FROM depense WHERE annee_id = $1) AS depenses,
           (SELECT COALESCE(SUM(montant),0) FROM paiement
            WHERE NOT annule AND annee_id = $1
              AND date_paiement >= date_trunc('month', CURRENT_DATE)) AS recettes_mois`,
        [annee[0].id]
      );
      base.finances = {
        ...fin[0],
        solde: Number(fin[0].recettes) - Number(fin[0].depenses),
      };
    }

    // Tableau de bord enseignant : ses classes et evaluations a saisir
    if (req.user.role === 'enseignant') {
      const { rows: mes } = await query(
        `SELECT c.libelle AS classe, m.libelle AS matiere, c.id AS classe_id, m.id AS matiere_id
         FROM affectation a
         JOIN enseignant en ON en.id = a.enseignant_id
         JOIN classe c ON c.id = a.classe_id
         JOIN matiere m ON m.id = a.matiere_id
         WHERE en.utilisateur_id = $1 AND a.annee_id = $2
         ORDER BY c.libelle`,
        [req.user.id, annee[0].id]
      );
      base.mes_cours = mes;

      const { rows: aSaisir } = await query(
        `SELECT ev.id, ev.libelle, ev.date_eval, c.libelle AS classe, m.libelle AS matiere,
                (SELECT COUNT(*)::int FROM inscription i WHERE i.classe_id = ev.classe_id) AS attendus,
                (SELECT COUNT(*)::int FROM note n WHERE n.evaluation_id = ev.id) AS saisies
         FROM evaluation ev
         JOIN enseignant en ON en.id = ev.enseignant_id
         JOIN classe c ON c.id = ev.classe_id
         JOIN matiere m ON m.id = ev.matiere_id
         WHERE en.utilisateur_id = $1
         ORDER BY ev.date_eval DESC LIMIT 10`,
        [req.user.id]
      );
      base.evaluations_recentes = aSaisir;
    }

    // Derniers evenements pour le fil d activite
    const { rows: activite } = await query(
      `SELECT j.action, j.entite, j.cree_le, u.prenom, u.nom
       FROM journal_audit j
       LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
       ORDER BY j.cree_le DESC LIMIT 10`
    );
    base.activite = activite;

    res.json({ annee: annee[0], ...base });
  } catch (err) { next(err); }
});

export default router;
