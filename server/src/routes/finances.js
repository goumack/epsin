import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { verifierEleveTuteur } from '../middleware/portee-tuteur.js';

const router = Router();
router.use(authentifier);

const CAISSE = ['admin', 'comptable'];

// ---------- Bareme des frais ----------
router.get('/frais', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, n.libelle AS niveau FROM frais f
       LEFT JOIN niveau n ON n.id = f.niveau_id
       WHERE f.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       ORDER BY n.ordre NULLS FIRST, f.libelle`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/frais', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { niveau_id, libelle, montant, obligatoire, echeance, recurrent } = req.body;
    if (!libelle || montant == null) {
      return res.status(400).json({ erreur: 'Libelle et montant requis' });
    }
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const { rows } = await query(
      `INSERT INTO frais (annee_id, niveau_id, libelle, montant, obligatoire, echeance, recurrent)
       VALUES ($1,$2,$3,$4,COALESCE($5,true),$6,COALESCE($7,false)) RETURNING *`,
      [ar[0].id, niveau_id || null, libelle, montant, obligatoire, echeance || null, recurrent]
    );
    await tracer(req, 'creation', 'frais', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Paiements ----------
router.get('/paiements', autoriser(...CAISSE, 'censeur'), async (req, res, next) => {
  try {
    const { eleve_id, du, au, mode, page = 1, taille = 30 } = req.query;
    const limite = Math.min(Number(taille) || 30, 100);
    const decalage = (Math.max(Number(page) || 1, 1) - 1) * limite;

    const conditions = ['p.annule = false'];
    const params = [];
    if (eleve_id) { params.push(Number(eleve_id)); conditions.push(`p.eleve_id = $${params.length}`); }
    if (du) { params.push(du); conditions.push(`p.date_paiement >= $${params.length}`); }
    if (au) { params.push(au); conditions.push(`p.date_paiement <= $${params.length}`); }
    if (mode) { params.push(mode); conditions.push(`p.mode = $${params.length}`); }

    const { rows } = await query(
      `SELECT p.*, e.matricule, e.prenom, e.nom, f.libelle AS frais,
              COUNT(*) OVER()::int AS total,
              SUM(p.montant) OVER()::numeric AS total_montant
       FROM paiement p
       JOIN eleve e ON e.id = p.eleve_id
       LEFT JOIN frais f ON f.id = p.frais_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.date_paiement DESC, p.id DESC
       LIMIT ${limite} OFFSET ${decalage}`,
      params
    );
    res.json({
      donnees: rows.map(({ total, total_montant, ...r }) => r),
      total: rows[0]?.total ?? 0,
      total_montant: rows[0]?.total_montant ?? 0,
    });
  } catch (err) { next(err); }
});

router.post('/paiements', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { eleve_id, frais_id, montant, mode, reference, mois_couvert, date_paiement } = req.body;
    if (!eleve_id || !montant || Number(montant) <= 0) {
      return res.status(400).json({ erreur: 'Eleve et montant positif requis' });
    }
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const paiement = await transaction(async (client) => {
      // Numero de recu sequentiel, verrouille le temps de la transaction
      const { rows: nr } = await client.query(
        `SELECT COUNT(*)::int AS n FROM paiement WHERE annee_id = $1`, [ar[0].id]
      );
      const numero = `REC-${new Date().getFullYear()}-${String(nr[0].n + 1).padStart(5, '0')}`;

      const { rows } = await client.query(
        `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, reference,
                               numero_recu, mois_couvert, date_paiement, encaisse_par)
         VALUES ($1,$2,$3,$4,COALESCE($5,'especes'),$6,$7,$8,COALESCE($9,CURRENT_DATE),$10)
         RETURNING *`,
        [eleve_id, frais_id || null, ar[0].id, montant, mode, reference || null,
         numero, mois_couvert || null, date_paiement || null, req.user.id]
      );
      return rows[0];
    });

    await tracer(req, 'encaissement', 'paiement', paiement.id, { montant });
    res.status(201).json(paiement);
  } catch (err) { next(err); }
});

// Annulation (on ne supprime jamais une ecriture comptable)
router.patch('/paiements/:id/annuler', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE paiement SET annule = true WHERE id = $1 AND annule = false RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Paiement introuvable ou deja annule' });
    await tracer(req, 'annulation', 'paiement', rows[0].id, { motif: req.body.motif || null });
    res.json({ message: 'Paiement annule', paiement: rows[0] });
  } catch (err) { next(err); }
});

// Situation financiere d un eleve : du / paye / reste
router.get('/situation/:eleveId', async (req, res, next) => {
  try {
    // Un tuteur ne consulte que la situation de son propre enfant
    const controleTuteur = verifierEleveTuteur(req.user, req.params.eleveId);
    if (!controleTuteur.ok) {
      return res.status(controleTuteur.code).json({ erreur: controleTuteur.message });
    }

    const { rows: info } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom, c.libelle AS classe, c.niveau_id
       FROM eleve e
       LEFT JOIN inscription i ON i.eleve_id = e.id
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = i.classe_id
       WHERE e.id = $1`,
      [req.params.eleveId]
    );
    if (!info[0]) return res.status(404).json({ erreur: 'Eleve introuvable' });

    const { rows: frais } = await query(
      `SELECT f.*,
              COALESCE((SELECT SUM(p.montant) FROM paiement p
                        WHERE p.eleve_id = $1 AND p.frais_id = f.id AND NOT p.annule), 0) AS paye
       FROM frais f
       WHERE f.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         AND (f.niveau_id IS NULL OR f.niveau_id = $2)
       ORDER BY f.libelle`,
      [req.params.eleveId, info[0].niveau_id]
    );

    const mois = await moisExigibles();
    const lignes = frais.map((f) => {
      // Un frais recurrent est du pour chaque mois ecoule depuis la rentree
      const du = f.recurrent ? Number(f.montant) * mois : Number(f.montant);
      return { ...f, du, reste: Math.max(du - Number(f.paye), 0) };
    });

    const totalDu = lignes.reduce((s, l) => s + l.du, 0);
    const totalPaye = lignes.reduce((s, l) => s + Number(l.paye), 0);

    res.json({
      eleve: info[0],
      lignes,
      total_du: totalDu,
      total_paye: totalPaye,
      reste: Math.max(totalDu - totalPaye, 0),
      a_jour: totalPaye >= totalDu,
    });
  } catch (err) { next(err); }
});

/**
 * Nombre de mensualites exigibles a ce jour pour une annee scolaire.
 * Compte les mois ecoules depuis la rentree, borne au nombre total de mois
 * de l annee : apres la fin de l annee, la totalite est due, jamais plus.
 */
function mensualitesDues(debut, fin) {
  if (!debut || !fin) return 1;
  const d = new Date(debut), f = new Date(fin);
  const now = new Date();
  const moisEntre = (a, b) =>
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  const total = Math.max(moisEntre(d, f), 1);
  if (now < d) return 0;
  return Math.min(Math.max(moisEntre(d, now), 1), total);
}

/** Charge l annee active et calcule le nombre de mensualites exigibles. */
async function moisExigibles() {
  const { rows } = await query(
    `SELECT date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`
  );
  if (!rows[0]) return 1;
  return mensualitesDues(rows[0].date_debut, rows[0].date_fin);
}

// Liste des impayes
router.get('/impayes', autoriser(...CAISSE, 'censeur'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `WITH du_par_eleve AS (
         SELECT e.id AS eleve_id,
                SUM(CASE WHEN f.recurrent THEN f.montant * $1 ELSE f.montant END) AS total_du
         FROM eleve e
         JOIN inscription i ON i.eleve_id = e.id
           AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         JOIN classe c ON c.id = i.classe_id
         JOIN frais f ON (f.niveau_id IS NULL OR f.niveau_id = c.niveau_id)
           AND f.annee_id = i.annee_id AND f.obligatoire
         WHERE e.statut = 'actif'
         GROUP BY e.id
       )
       SELECT e.id, e.matricule, e.prenom, e.nom, c.libelle AS classe,
              d.total_du,
              COALESCE(SUM(p.montant) FILTER (WHERE NOT p.annule), 0) AS total_paye,
              d.total_du - COALESCE(SUM(p.montant) FILTER (WHERE NOT p.annule), 0) AS reste,
              (SELECT t.telephone FROM tuteur t
               JOIN eleve_tuteur et ON et.tuteur_id = t.id
               WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1) AS contact
       FROM du_par_eleve d
       JOIN eleve e ON e.id = d.eleve_id
       LEFT JOIN inscription i ON i.eleve_id = e.id
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN paiement p ON p.eleve_id = e.id
       GROUP BY e.id, e.matricule, e.prenom, e.nom, c.libelle, d.total_du
       HAVING d.total_du - COALESCE(SUM(p.montant) FILTER (WHERE NOT p.annule), 0) > 0
       ORDER BY reste DESC`,
      [await moisExigibles()]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- Depenses ----------
router.get('/depenses', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.*, u.prenom, u.nom FROM depense d
       LEFT JOIN utilisateur u ON u.id = d.saisie_par
       WHERE d.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       ORDER BY d.date_depense DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/depenses', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { categorie, libelle, montant, date_depense } = req.body;
    if (!categorie || !libelle || !montant) {
      return res.status(400).json({ erreur: 'Categorie, libelle et montant requis' });
    }
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    const { rows } = await query(
      `INSERT INTO depense (annee_id, categorie, libelle, montant, date_depense, saisie_par)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6) RETURNING *`,
      [ar[0].id, categorie, libelle, montant, date_depense || null, req.user.id]
    );
    await tracer(req, 'creation', 'depense', rows[0].id, { montant });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Synthese : recettes, depenses, solde, evolution mensuelle
router.get('/synthese', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { rows: totaux } = await query(
      `SELECT
         (SELECT COALESCE(SUM(montant),0) FROM paiement
          WHERE NOT annule AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)) AS recettes,
         (SELECT COALESCE(SUM(montant),0) FROM depense
          WHERE annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)) AS depenses`
    );
    const { rows: parMois } = await query(
      `SELECT to_char(date_paiement, 'YYYY-MM') AS mois, SUM(montant) AS montant
       FROM paiement
       WHERE NOT annule AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       GROUP BY mois ORDER BY mois`
    );
    const { rows: parMode } = await query(
      `SELECT mode, SUM(montant) AS montant, COUNT(*)::int AS nombre
       FROM paiement
       WHERE NOT annule AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       GROUP BY mode ORDER BY montant DESC`
    );
    res.json({
      ...totaux[0],
      solde: Number(totaux[0].recettes) - Number(totaux[0].depenses),
      par_mois: parMois,
      par_mode: parMode,
    });
  } catch (err) { next(err); }
});

export default router;
