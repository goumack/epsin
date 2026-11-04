import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';

/**
 * Paie des maitres et professeurs : le personnel paye, la paie de chaque
 * mois, et son paiement — qui devient une depense « Salaires ».
 * Reserve a la caisse (administrateur, comptable).
 */
const router = Router();
router.use(authentifier);
router.use(autoriser('admin', 'comptable'));

const FORMAT_MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const MODES = ['especes', 'wave', 'om', 'virement', 'cheque'];
const CYCLES = ['elementaire', 'college'];
const MODES_PAIE = ['mensuel', 'horaire'];

/** « 2026-11 » -> « novembre 2026 » */
const moisLong = (m) => {
  const [a, n] = m.split('-').map(Number);
  return new Date(a, n - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
const erreur = (status, message) => Object.assign(new Error(message), { status });

/** Champs d un salarie, verifies. */
function lireSalarie(corps, existant = {}) {
  const prenom = String(corps.prenom ?? existant.prenom ?? '').trim();
  const nom = String(corps.nom ?? existant.nom ?? '').trim();
  const fonction = String(corps.fonction ?? existant.fonction ?? 'Maître').trim() || 'Maître';
  const telephone = corps.telephone !== undefined ? (String(corps.telephone).trim() || null) : (existant.telephone ?? null);
  const salaire = Number(corps.salaire_mensuel ?? existant.salaire_mensuel ?? 0);
  if (!prenom || !nom) throw erreur(400, 'Prenom et nom requis');
  if (!Number.isFinite(salaire) || salaire < 0) throw erreur(400, 'Salaire mensuel invalide');
  const actif = corps.actif !== undefined ? Boolean(corps.actif) : (existant.actif ?? true);
  const cycle = String(corps.cycle ?? existant.cycle ?? 'elementaire');
  if (!CYCLES.includes(cycle)) throw erreur(400, 'Cycle invalide (elementaire ou college)');
  const modePaie = String(corps.mode_paie ?? existant.mode_paie ?? 'mensuel');
  if (!MODES_PAIE.includes(modePaie)) throw erreur(400, 'Mode de paie invalide (mensuel ou horaire)');
  const tauxBrut = corps.taux_horaire ?? existant.taux_horaire ?? null;
  const taux = tauxBrut === null || tauxBrut === '' ? null : Number(tauxBrut);
  if (modePaie === 'horaire' && !(taux > 0)) throw erreur(400, 'Taux horaire requis pour une paie a l heure');
  if (modePaie === 'mensuel' && !(salaire > 0)) throw erreur(400, 'Salaire mensuel requis');
  return {
    prenom, nom, fonction, telephone, actif, cycle, modePaie,
    salaire: modePaie === 'mensuel' ? Math.round(salaire) : 0,
    taux: modePaie === 'horaire' ? Math.round(taux) : null,
  };
}

// ---------- Personnel paye ----------
router.get('/salaries', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*, (SELECT COUNT(*)::int FROM paie p WHERE p.salarie_id = s.id) AS nb_paies
       FROM salarie s ORDER BY s.actif DESC, s.cycle DESC, s.salaire_mensuel DESC, s.nom, s.prenom`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/salaries', async (req, res, next) => {
  try {
    const s = lireSalarie(req.body);
    const { rows } = await query(
      `INSERT INTO salarie (prenom, nom, fonction, telephone, salaire_mensuel, actif, cycle, mode_paie, taux_horaire)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [s.prenom, s.nom, s.fonction, s.telephone, s.salaire, s.actif, s.cycle, s.modePaie, s.taux]
    );
    await tracer(req, 'creation', 'salarie', rows[0].id, { salaire: s.salaire });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/salaries/:id', async (req, res, next) => {
  try {
    const { rows: ex } = await query(`SELECT * FROM salarie WHERE id = $1`, [req.params.id]);
    if (!ex[0]) return res.status(404).json({ erreur: 'Salarie introuvable' });
    const s = lireSalarie(req.body, ex[0]);
    const { rows } = await query(
      `UPDATE salarie SET prenom=$2, nom=$3, fonction=$4, telephone=$5, salaire_mensuel=$6, actif=$7, cycle=$8,
                          mode_paie=$9, taux_horaire=$10
       WHERE id = $1 RETURNING *`,
      [req.params.id, s.prenom, s.nom, s.fonction, s.telephone, s.salaire, s.actif, s.cycle, s.modePaie, s.taux]
    );
    await tracer(req, 'modification', 'salarie', rows[0].id, { salaire: s.salaire, actif: s.actif });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Paie d un mois ----------
/**
 * Paie du mois : les lignes deja preparees, et le personnel actif qui n en
 * a pas encore (a ajouter avec « Preparer »).
 */
router.get('/paie', async (req, res, next) => {
  try {
    const mois = String(req.query.mois || '');
    if (!FORMAT_MOIS.test(mois)) return res.status(400).json({ erreur: 'Mois invalide (AAAA-MM)' });
    const { rows: lignes } = await query(
      `SELECT p.*, s.prenom, s.nom, s.fonction, s.telephone, s.salaire_mensuel, s.cycle,
              s.mode_paie, s.taux_horaire,
              u.prenom AS paye_par_prenom, u.nom AS paye_par_nom
       FROM paie p JOIN salarie s ON s.id = p.salarie_id
       LEFT JOIN utilisateur u ON u.id = p.paye_par
       WHERE p.mois = $1 ORDER BY s.cycle DESC, s.salaire_mensuel DESC, s.nom, s.prenom`,
      [mois]
    );
    const { rows: manquants } = await query(
      `SELECT s.id, s.prenom, s.nom, s.fonction, s.cycle, s.mode_paie, s.salaire_mensuel FROM salarie s
       WHERE s.actif AND NOT EXISTS (SELECT 1 FROM paie p WHERE p.salarie_id = s.id AND p.mois = $1)
       ORDER BY s.fonction, s.nom`,
      [mois]
    );
    const total = lignes.reduce((t, l) => t + Number(l.montant), 0);
    const paye = lignes.filter((l) => l.statut === 'paye').reduce((t, l) => t + Number(l.montant), 0);
    // Un etat par cycle, comme sur les feuilles de paie de l ecole
    const parCycle = Object.fromEntries(CYCLES.map((c) => {
      const l = lignes.filter((x) => x.cycle === c);
      const t = l.reduce((a, x) => a + Number(x.montant), 0);
      const p = l.filter((x) => x.statut === 'paye').reduce((a, x) => a + Number(x.montant), 0);
      return [c, { total: t, paye: p, reste: t - p, lignes: l.length }];
    }));
    res.json({ mois, libelle: moisLong(mois), lignes, a_preparer: manquants, total, paye, reste: total - paye, par_cycle: parCycle });
  } catch (err) { next(err); }
});

/** Prepare la paie du mois : une ligne par salarie actif, au salaire habituel. */
router.post('/paie/preparer', async (req, res, next) => {
  try {
    const mois = String(req.body.mois || '');
    if (!FORMAT_MOIS.test(mois)) return res.status(400).json({ erreur: 'Mois invalide (AAAA-MM)' });
    const { rows: an } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!an[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });
    const { rows } = await query(
      `INSERT INTO paie (salarie_id, annee_id, mois, montant, taux)
       SELECT s.id, $2, $1,
              CASE WHEN s.mode_paie = 'horaire' THEN 0 ELSE s.salaire_mensuel END,
              CASE WHEN s.mode_paie = 'horaire' THEN s.taux_horaire END
       FROM salarie s
       WHERE s.actif AND (s.mode_paie = 'horaire' OR s.salaire_mensuel > 0)
       ON CONFLICT (salarie_id, mois) DO NOTHING
       RETURNING id`,
      [mois, an[0].id]
    );
    await tracer(req, 'preparation_paie', 'paie', null, { mois, lignes: rows.length });
    res.status(201).json({ mois, ajoutees: rows.length });
  } catch (err) { next(err); }
});

/**
 * Saisie du mois, avant paiement seulement :
 *   - paie a l heure : `heures` -> montant = heures x taux ;
 *   - salaire fixe : `montant` ajuste (absence, avance), avec une `note`.
 * Un `montant` fourni l emporte toujours (arrondi, prime...).
 */
router.put('/paie/:id', async (req, res, next) => {
  try {
    const { rows: ex } = await query(
      `SELECT p.*, s.taux_horaire FROM paie p JOIN salarie s ON s.id = p.salarie_id WHERE p.id = $1`, [req.params.id]
    );
    if (!ex[0] || ex[0].statut !== 'a_payer') {
      return res.status(409).json({ erreur: 'Paie introuvable ou deja payee : annulez d abord le paiement' });
    }
    let heures = ex[0].heures;
    const taux = ex[0].taux ?? ex[0].taux_horaire;
    let montant = Number(ex[0].montant);
    if (req.body.heures !== undefined && req.body.heures !== '') {
      heures = Number(req.body.heures);
      if (!Number.isFinite(heures) || heures < 0 || heures > 400) return res.status(400).json({ erreur: 'Nombre d heures invalide' });
      if (!(Number(taux) > 0)) return res.status(400).json({ erreur: 'Pas de taux horaire pour cette personne' });
      montant = Math.round(heures * Number(taux));
    }
    if (req.body.montant !== undefined && req.body.montant !== '') {
      montant = Math.round(Number(req.body.montant));
      if (!Number.isFinite(montant) || montant < 0) return res.status(400).json({ erreur: 'Montant invalide' });
    }
    const note = req.body.note !== undefined ? (String(req.body.note).trim() || null) : ex[0].note;
    const { rows } = await query(
      `UPDATE paie SET montant = $2, heures = $3, taux = $4, note = $5 WHERE id = $1 RETURNING *`,
      [req.params.id, montant, heures, taux, note]
    );
    await tracer(req, 'ajustement_paie', 'paie', rows[0].id, { montant, heures, note });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/** Retire une ligne non payee (depart en cours de mois...). */
router.delete('/paie/:id', async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM paie WHERE id = $1 AND statut = 'a_payer' RETURNING id, mois`, [req.params.id]);
    if (!rows[0]) return res.status(409).json({ erreur: 'Paie introuvable ou deja payee' });
    await tracer(req, 'suppression_paie', 'paie', rows[0].id, { mois: rows[0].mois });
    res.json({ message: 'Ligne retiree' });
  } catch (err) { next(err); }
});

/**
 * Paie un salaire : la ligne passe « payee » et une depense « Salaires » est
 * creee, liee a elle. Le tout en une transaction, une seule fois.
 */
router.post('/paie/:id/payer', async (req, res, next) => {
  try {
    const mode = MODES.includes(req.body.mode) ? req.body.mode : 'especes';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || '')) ? req.body.date : null;
    const resultat = await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT p.*, s.prenom, s.nom, s.fonction FROM paie p JOIN salarie s ON s.id = p.salarie_id
         WHERE p.id = $1 FOR UPDATE OF p`,
        [req.params.id]
      );
      const p = rows[0];
      if (!p) throw erreur(404, 'Paie introuvable');
      if (p.statut === 'paye') throw erreur(409, 'Ce salaire est deja paye');
      if (!(Number(p.montant) > 0)) {
        throw erreur(400, p.heures == null && p.taux != null
          ? 'Saisissez d abord les heures du mois' : 'Montant nul : ajustez-le ou retirez la ligne');
      }
      const heures = p.heures != null ? `, ${Number(p.heures).toLocaleString('fr-FR')} h` : '';
      const libelle = `Salaire ${moisLong(p.mois)} — ${p.prenom} ${p.nom} (${p.fonction}${heures})`;
      const { rows: d } = await client.query(
        `INSERT INTO depense (annee_id, categorie, libelle, montant, date_depense, saisie_par)
         VALUES ($1, 'Salaires', $2, $3, COALESCE($4, CURRENT_DATE), $5) RETURNING id`,
        [p.annee_id, libelle, p.montant, date, req.user.id]
      );
      const { rows: maj } = await client.query(
        `UPDATE paie SET statut = 'paye', mode = $2, paye_le = COALESCE($3, CURRENT_DATE),
                         paye_par = $4, depense_id = $5
         WHERE id = $1 RETURNING *`,
        [p.id, mode, date, req.user.id, d[0].id]
      );
      return maj[0];
    });
    await tracer(req, 'paiement_salaire', 'paie', resultat.id, { montant: Number(resultat.montant), mois: resultat.mois });
    res.json(resultat);
  } catch (err) { next(err); }
});

/** Annule un paiement de salaire : la depense liee est retiree, la ligne redevient a payer. */
router.post('/paie/:id/annuler', async (req, res, next) => {
  try {
    const motif = String(req.body.motif || '').trim();
    if (!motif) return res.status(400).json({ erreur: 'Indiquez le motif de l annulation' });
    const resultat = await transaction(async (client) => {
      const { rows } = await client.query(`SELECT * FROM paie WHERE id = $1 FOR UPDATE`, [req.params.id]);
      const p = rows[0];
      if (!p || p.statut !== 'paye') throw erreur(409, 'Ce salaire n est pas paye');
      const { rows: maj } = await client.query(
        `UPDATE paie SET statut = 'a_payer', mode = NULL, paye_le = NULL, paye_par = NULL, depense_id = NULL
         WHERE id = $1 RETURNING *`,
        [p.id]
      );
      if (p.depense_id) await client.query(`DELETE FROM depense WHERE id = $1`, [p.depense_id]);
      return { ...maj[0], depense_retiree: p.depense_id };
    });
    await tracer(req, 'annulation_salaire', 'paie', resultat.id, { motif, depense: resultat.depense_retiree });
    res.json(resultat);
  } catch (err) { next(err); }
});

export default router;
