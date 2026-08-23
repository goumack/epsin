import { Router } from 'express';
import { query } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { entiteDe, VALIDATION_ABSENCES } from '../middleware/entite.js';

/**
 * Demandes d absence / conge des enseignants.
 *
 * Regle hierarchique : un enseignant adresse sa demande au chef de SON
 * entite — le DIRECTEUR pour un maitre de l elementaire, le PROVISEUR pour
 * un professeur du moyen/secondaire. Le destinataire n est jamais choisi
 * par le demandeur : il decoule de l entite de l enseignant, ce qui evite
 * qu une demande atterrisse chez le mauvais chef.
 *
 * Le censeur, bien qu il encadre la vie scolaire du secondaire, ne statue
 * PAS sur les conges du personnel : cela reste une prerogative du chef
 * d etablissement.
 */
const router = Router();
router.use(authentifier);

/** Enseignant lie au compte connecte, ou null si le compte n en est pas un. */
async function enseignantDuCompte(utilisateurId) {
  const { rows } = await query(
    `SELECT e.id, e.entite FROM enseignant e WHERE e.utilisateur_id = $1`,
    [utilisateurId]
  );
  return rows[0] || null;
}

// ---------- Liste des demandes ----------
// Un enseignant ne voit que les siennes ; un chef voit celles de son entite ;
// l admin voit tout l etablissement.
router.get('/demandes-absence', async (req, res, next) => {
  try {
    const { statut } = req.query;
    const conditions = [];
    const params = [];

    if (req.user.role === 'enseignant') {
      const ens = await enseignantDuCompte(req.user.id);
      if (!ens) return res.json([]);
      params.push(ens.id);
      conditions.push(`d.enseignant_id = $${params.length}`);
    } else {
      const entite = entiteDe(req.user);
      if (entite) {
        params.push(entite);
        conditions.push(`e.entite = $${params.length}`);
      }
    }

    if (statut) {
      params.push(statut);
      conditions.push(`d.statut = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT d.*,
              u.prenom, u.nom, u.email,
              e.matricule, e.specialite, e.entite,
              dec.prenom AS decideur_prenom, dec.nom AS decideur_nom,
              (d.date_fin - d.date_debut + 1) AS nb_jours
       FROM demande_absence d
       JOIN enseignant e ON e.id = d.enseignant_id
       JOIN utilisateur u ON u.id = e.utilisateur_id
       LEFT JOIN utilisateur dec ON dec.id = d.decideur_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY
         CASE d.statut WHEN 'soumise' THEN 0 ELSE 1 END,
         d.date_debut DESC`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ---------- Compteur de demandes en attente ----------
// Sert la pastille de notification du chef : combien de demandes attendent
// sa decision dans son entite.
router.get('/demandes-absence/en-attente', async (req, res, next) => {
  try {
    if (!VALIDATION_ABSENCES.includes(req.user.role)) return res.json({ total: 0 });
    const entite = entiteDe(req.user);
    const params = [];
    let filtre = '';
    if (entite) {
      params.push(entite);
      filtre = `AND e.entite = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT COUNT(*)::int AS total
       FROM demande_absence d
       JOIN enseignant e ON e.id = d.enseignant_id
       WHERE d.statut = 'soumise' ${filtre}`,
      params
    );
    res.json({ total: rows[0].total });
  } catch (e) { next(e); }
});

// ---------- Depot d une demande ----------
// Reserve aux enseignants : un chef ne depose pas de demande via ce module.
router.post('/demandes-absence',
  autoriser('enseignant'),
  async (req, res, next) => {
    try {
      const { type, date_debut, date_fin, motif } = req.body;
      if (!date_debut || !date_fin || !motif?.trim()) {
        return res.status(400).json({ erreur: 'Dates et motif obligatoires' });
      }
      if (new Date(date_fin) < new Date(date_debut)) {
        return res.status(400).json({ erreur: 'La date de fin precede la date de debut' });
      }

      const ens = await enseignantDuCompte(req.user.id);
      if (!ens) {
        return res.status(403).json({ erreur: 'Compte non rattache a un enseignant' });
      }

      const { rows: annee } = await query(
        `SELECT id FROM annee_scolaire WHERE active LIMIT 1`
      );
      if (!annee[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

      const { rows } = await query(
        `INSERT INTO demande_absence
           (enseignant_id, annee_id, type, date_debut, date_fin, motif)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [ens.id, annee[0].id, type || 'absence', date_debut, date_fin, motif.trim()]
      );
      await tracer(req, 'depot_demande_absence', 'demande_absence', rows[0].id);
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

// ---------- Decision du chef ----------
router.patch('/demandes-absence/:id',
  autoriser(...VALIDATION_ABSENCES),
  async (req, res, next) => {
    try {
      const { statut, commentaire } = req.body;
      if (!['approuvee', 'refusee'].includes(statut)) {
        return res.status(400).json({ erreur: 'Statut invalide' });
      }

      // La demande doit relever de l entite du chef : un directeur ne
      // statue pas sur le conge d un professeur de lycee.
      const { rows: cible } = await query(
        `SELECT d.statut, e.entite
         FROM demande_absence d
         JOIN enseignant e ON e.id = d.enseignant_id
         WHERE d.id = $1`,
        [req.params.id]
      );
      if (!cible[0]) return res.status(404).json({ erreur: 'Demande introuvable' });

      const entite = entiteDe(req.user);
      if (entite && cible[0].entite !== entite) {
        return res.status(403).json({ erreur: 'Cette demande releve d une autre entite' });
      }
      if (cible[0].statut !== 'soumise') {
        return res.status(409).json({ erreur: 'Cette demande a deja ete traitee' });
      }

      const { rows } = await query(
        `UPDATE demande_absence
         SET statut = $1, commentaire = $2, decideur_id = $3, date_decision = now()
         WHERE id = $4 RETURNING *`,
        [statut, commentaire?.trim() || null, req.user.id, req.params.id]
      );
      await tracer(req, `demande_absence_${statut}`, 'demande_absence', rows[0].id);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

// ---------- Retrait par le demandeur ----------
router.patch('/demandes-absence/:id/annuler',
  autoriser('enseignant'),
  async (req, res, next) => {
    try {
      const ens = await enseignantDuCompte(req.user.id);
      if (!ens) return res.status(403).json({ erreur: 'Compte non rattache a un enseignant' });

      const { rows } = await query(
        `UPDATE demande_absence
         SET statut = 'annulee'
         WHERE id = $1 AND enseignant_id = $2 AND statut = 'soumise'
         RETURNING *`,
        [req.params.id, ens.id]
      );
      if (!rows[0]) {
        return res.status(404).json({ erreur: 'Demande introuvable ou deja traitee' });
      }
      await tracer(req, 'annulation_demande_absence', 'demande_absence', rows[0].id);
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

export default router;
