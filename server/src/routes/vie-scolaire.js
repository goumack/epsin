import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { entiteDe, accesAutorise } from '../middleware/entite.js';
import { estEnseignant, accesClasse } from '../middleware/portee-enseignant.js';
import { estTuteur, accesEleve, eleveSuivi } from '../middleware/portee-tuteur.js';

const router = Router();
router.use(authentifier);

const SAISIE = ['admin', 'censeur', 'directeur', 'proviseur', 'enseignant'];
const ENCADREMENT = ['admin', 'censeur', 'directeur', 'proviseur'];

/**
 * Verifie qu un eleve releve bien du perimetre du demandeur : son entite,
 * et pour un enseignant, l une de ses propres classes.
 */
async function verifierEleve(req, eleveId) {
  const { rows } = await query(
    `SELECT n.entite, i.classe_id FROM inscription i
     JOIN classe c ON c.id = i.classe_id
     JOIN niveau n ON n.id = c.niveau_id
     WHERE i.eleve_id = $1
       AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
    [eleveId]
  );
  if (!accesAutorise(req.user, rows[0]?.entite ?? null)) return false;
  if (estEnseignant(req.user)) {
    if (!rows[0]) return false;
    return accesClasse(req.user, rows[0].classe_id);
  }
  // Un tuteur ne consulte que l assiduite de son propre enfant
  if (estTuteur(req.user)) return accesEleve(req.user, eleveId);
  return true;
}

/**
 * Signalement d une absence par le tuteur (maladie, rendez-vous...).
 *
 * L absence est enregistree mais NON confirmee : elle reste « a confirmer »
 * tant que la vie scolaire ne l a pas validee. Un parent signale, l ecole
 * justifie — c est elle qui tient le registre d assiduite.
 */
router.post('/absences/signaler', autoriser('parent'), async (req, res, next) => {
  try {
    const { date_abs, date_fin, type, motif } = req.body;
    if (!date_abs || !motif?.trim()) {
      return res.status(400).json({ erreur: 'Date et motif obligatoires' });
    }
    const eleveId = eleveSuivi(req.user);
    if (!eleveId) return res.status(403).json({ erreur: 'Aucun enfant rattache a ce compte' });

    // Une absence peut couvrir plusieurs jours : on cree une ligne par jour
    // pour rester coherent avec le registre d appel quotidien.
    const debut = new Date(date_abs);
    const fin = date_fin ? new Date(date_fin) : debut;
    if (fin < debut) {
      return res.status(400).json({ erreur: 'La date de fin precede la date de debut' });
    }
    const MAX_JOURS = 30;
    const jours = Math.floor((fin - debut) / 86400000) + 1;
    if (jours > MAX_JOURS) {
      return res.status(400).json({ erreur: `Periode trop longue (max ${MAX_JOURS} jours)` });
    }

    const creees = [];
    for (let i = 0; i < jours; i++) {
      const jour = new Date(debut.getTime() + i * 86400000);
      const iso = jour.toISOString().slice(0, 10);
      // Ne pas dupliquer une absence deja enregistree ce jour-la
      const { rows: deja } = await query(
        `SELECT 1 FROM absence WHERE eleve_id = $1 AND date_abs = $2`,
        [eleveId, iso]
      );
      if (deja.length) continue;

      const { rows } = await query(
        `INSERT INTO absence (eleve_id, date_abs, type, justifiee, confirmee,
                              signalee_par, motif_tuteur)
         VALUES ($1,$2,$3,false,false,$4,$5) RETURNING *`,
        [eleveId, iso, type || 'absence', req.user.id, motif.trim()]
      );
      creees.push(rows[0]);
    }

    await tracer(req, 'signalement_absence', 'eleve', eleveId, { jours: creees.length });
    res.status(201).json({
      message: creees.length
        ? `${creees.length} journee(s) signalee(s), en attente de confirmation`
        : 'Ces journees etaient deja enregistrees',
      absences: creees,
    });
  } catch (err) { next(err); }
});

/** Confirmation par la vie scolaire d une absence signalee par un tuteur. */
router.patch('/absences/:id/confirmer', autoriser(...ENCADREMENT), async (req, res, next) => {
  try {
    const { rows: cible } = await query(
      `SELECT eleve_id FROM absence WHERE id = $1`, [req.params.id]
    );
    if (!cible[0]) return res.status(404).json({ erreur: 'Absence introuvable' });
    if (!(await verifierEleve(req, cible[0].eleve_id))) {
      return res.status(403).json({ erreur: 'Cet eleve ne releve pas de votre perimetre' });
    }

    const { justifiee = true } = req.body;
    const { rows } = await query(
      `UPDATE absence SET confirmee = true, justifiee = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, justifiee]
    );
    await tracer(req, 'confirmation_absence', 'absence', rows[0].id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Absences ----------
router.get('/absences', async (req, res, next) => {
  try {
    const { eleve_id, classe_id, du, au, justifiee } = req.query;
    const conditions = [];
    const params = [];
    if (eleve_id) { params.push(Number(eleve_id)); conditions.push(`a.eleve_id = $${params.length}`); }
    if (classe_id) { params.push(Number(classe_id)); conditions.push(`i.classe_id = $${params.length}`); }
    if (du) { params.push(du); conditions.push(`a.date_abs >= $${params.length}`); }
    if (au) { params.push(au); conditions.push(`a.date_abs <= $${params.length}`); }
    if (justifiee !== undefined) {
      params.push(justifiee === 'true'); conditions.push(`a.justifiee = $${params.length}`);
    }
    const entite = entiteDe(req.user);
    if (entite) { params.push(entite); conditions.push(`n.entite = $${params.length}`); }
    // Un tuteur ne voit que les absences de son enfant, meme sans filtre
    const suivi = eleveSuivi(req.user);
    if (suivi != null) { params.push(suivi); conditions.push(`a.eleve_id = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT a.*, e.matricule, e.prenom, e.nom, c.libelle AS classe, m.libelle AS matiere
       FROM absence a
       JOIN eleve e ON e.id = a.eleve_id
       LEFT JOIN inscription i ON i.eleve_id = e.id
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN niveau n ON n.id = c.niveau_id
       LEFT JOIN matiere m ON m.id = a.matiere_id
       ${where}
       ORDER BY a.date_abs DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Appel : saisie groupee pour une classe et une date
router.post('/appel', autoriser(...SAISIE), async (req, res, next) => {
  try {
    const { date_abs, matiere_id, heure_debut, heure_fin, absents = [] } = req.body;
    if (!date_abs) return res.status(400).json({ erreur: 'Date requise' });

    // Aucun absent ne doit relever d une autre entite
    for (const a of absents) {
      if (!(await verifierEleve(req, a.eleve_id))) {
        return res.status(403).json({ erreur: "Un des élèves ne relève pas de votre entité" });
      }
    }

    await transaction(async (client) => {
      for (const a of absents) {
        await client.query(
          `INSERT INTO absence (eleve_id, date_abs, heure_debut, heure_fin, matiere_id,
                                type, motif, saisie_par)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6,'absence'),$7,$8)`,
          [a.eleve_id, date_abs, heure_debut || null, heure_fin || null,
           matiere_id || null, a.type, a.motif || null, req.user.id]
        );
        // Notification au parent rattache
        await client.query(
          `INSERT INTO notification (utilisateur_id, type, titre, contenu)
           SELECT t.utilisateur_id, 'absence',
                  'Absence signalee',
                  'Votre enfant ' || e.prenom || ' ' || e.nom || ' a ete porte absent le ' || $2
           FROM eleve e
           JOIN eleve_tuteur et ON et.eleve_id = e.id
           JOIN tuteur t ON t.id = et.tuteur_id
           WHERE e.id = $1 AND t.utilisateur_id IS NOT NULL`,
          [a.eleve_id, date_abs]
        );
      }
    });
    await tracer(req, 'appel', 'absence', null, { date_abs, nombre: absents.length });
    res.status(201).json({ message: `${absents.length} absence(s) enregistree(s)` });
  } catch (err) { next(err); }
});

router.patch('/absences/:id/justifier', autoriser(...SAISIE), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE absence SET justifiee = true, motif = COALESCE($2, motif) WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.motif || null]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Absence introuvable' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/absences/:id', autoriser(...ENCADREMENT), async (req, res, next) => {
  try {
    await query(`DELETE FROM absence WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Absence supprimee' });
  } catch (err) { next(err); }
});

// Statistiques d assiduite par classe
router.get('/assiduite/:classeId', async (req, res, next) => {
  try {
    const { rows: cl } = await query(
      `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
      [req.params.classeId]
    );
    if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
    if (!accesAutorise(req.user, cl[0].entite)) {
      return res.status(403).json({ erreur: "Cette classe ne relève pas de votre entité" });
    }

    const { rows } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom,
              COUNT(*) FILTER (WHERE a.type = 'absence')::int AS absences,
              COUNT(*) FILTER (WHERE a.type = 'retard')::int AS retards,
              COUNT(*) FILTER (WHERE a.type = 'absence' AND NOT a.justifiee)::int AS non_justifiees
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id
       LEFT JOIN absence a ON a.eleve_id = e.id
       WHERE i.classe_id = $1 AND e.statut = 'actif'
       GROUP BY e.id ORDER BY non_justifiees DESC, e.nom`,
      [req.params.classeId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- Sanctions ----------
router.get('/sanctions', async (req, res, next) => {
  try {
    const entite = entiteDe(req.user);
    // Filtre optionnel sur un eleve, pour son dossier individuel
    const eleveId = req.query.eleve_id ? Number(req.query.eleve_id) : null;
    const { rows } = await query(
      `SELECT s.*, e.matricule, e.prenom, e.nom, c.libelle AS classe
       FROM sanction s
       JOIN eleve e ON e.id = s.eleve_id
       LEFT JOIN inscription i ON i.eleve_id = e.id
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN niveau n ON n.id = c.niveau_id
       WHERE ($1::text IS NULL OR n.entite = $1)
         AND ($2::int IS NULL OR s.eleve_id = $2)
       ORDER BY s.date_debut DESC LIMIT 100`,
      [entite, eleveId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/sanctions', autoriser(...ENCADREMENT), async (req, res, next) => {
  try {
    const { eleve_id, type, motif, date_debut, date_fin } = req.body;
    if (!eleve_id || !type || !motif) {
      return res.status(400).json({ erreur: 'Eleve, type et motif requis' });
    }
    if (!(await verifierEleve(req, eleve_id))) {
      return res.status(403).json({ erreur: "Cet élève ne relève pas de votre entité" });
    }
    const { rows } = await query(
      `INSERT INTO sanction (eleve_id, type, motif, date_debut, date_fin, decidee_par)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6) RETURNING *`,
      [eleve_id, type, motif, date_debut || null, date_fin || null, req.user.id]
    );
    await tracer(req, 'sanction', 'eleve', eleve_id, { type });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Infirmerie ----------
router.get('/infirmerie', autoriser(...ENCADREMENT), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT v.*, e.matricule, e.prenom, e.nom FROM visite_infirmerie v
       JOIN eleve e ON e.id = v.eleve_id
       ORDER BY v.date_visite DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/infirmerie', autoriser(...ENCADREMENT), async (req, res, next) => {
  try {
    const { eleve_id, motif, traitement, parent_prevenu } = req.body;
    if (!eleve_id || !motif) return res.status(400).json({ erreur: 'Eleve et motif requis' });
    const { rows } = await query(
      `INSERT INTO visite_infirmerie (eleve_id, motif, traitement, parent_prevenu)
       VALUES ($1,$2,$3,COALESCE($4,false)) RETURNING *`,
      [eleve_id, motif, traitement || null, parent_prevenu]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

export default router;
