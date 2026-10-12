import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { verifierEleveTuteur, estTuteur, eleveSuivi } from '../middleware/portee-tuteur.js';
import { prochainNumeroRecu } from '../db/recus.js';
import { montantEnLettres } from '../metier/montant-lettres.js';
import {
  moisDeLAnnee, moisDuFrais, nbMoisExigibles, etatDesMois, montantPourMois, repartirVersement,
} from '../metier/mensualites.js';

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
    const { niveau_id, libelle, montant, obligatoire, echeance, recurrent, mois_fin } = req.body;
    if (!libelle || montant == null) {
      return res.status(400).json({ erreur: 'Libelle et montant requis' });
    }
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const { rows } = await query(
      `INSERT INTO frais (annee_id, niveau_id, libelle, montant, obligatoire, echeance, recurrent, mois_fin)
       VALUES ($1,$2,$3,$4,COALESCE($5,true),$6,COALESCE($7,false),$8) RETURNING *`,
      [ar[0].id, niveau_id || null, libelle, montant, obligatoire, echeance || null, recurrent,
       recurrent && mois_fin ? Number(mois_fin) : null]
    );
    await tracer(req, 'creation', 'frais', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

/**
 * Bareme par classe : une grille niveaux x frais, comme la fiche de
 * renseignements de l etablissement (inscription, droit d inscription,
 * blouse, assurance, mensualite...). Une « colonne » regroupe les frais de
 * meme libelle ; chaque case est le montant pour un niveau (vide = ce frais
 * ne concerne pas ce niveau).
 */
/**
 * Cle de comparaison d un libelle de frais : sans accents, casse ni
 * ponctuation. « Mensualité » et « Mensualite » sont le meme frais.
 */
const cleFrais = (libelle) => String(libelle || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function lireBareme() {
  const { rows: an } = await query(`SELECT id, libelle FROM annee_scolaire WHERE active LIMIT 1`);
  if (!an[0]) return null;
  const { rows: niveaux } = await query(
    `SELECT id, libelle, cycle, entite, ordre FROM niveau ORDER BY ordre, libelle`
  );
  const { rows: frais } = await query(
    `SELECT f.*, (SELECT COUNT(*)::int FROM paiement p WHERE p.frais_id = f.id) AS paiements
     FROM frais f WHERE f.annee_id = $1 ORDER BY f.id`,
    [an[0].id]
  );
  const colonnes = [];
  for (const f of frais.filter((x) => x.niveau_id)) {
    let col = colonnes.find((c) => c.libelle.toLowerCase() === f.libelle.toLowerCase());
    if (!col) {
      col = { libelle: f.libelle, recurrent: f.recurrent, obligatoire: f.obligatoire, mois_fin: f.mois_fin, montants: {} };
      colonnes.push(col);
    }
    col.montants[f.niveau_id] = { id: f.id, montant: Number(f.montant), paiements: f.paiements };
  }
  return {
    annee: an[0],
    niveaux,
    colonnes,
    // Frais valables pour tous les niveaux, hors grille
    globaux: frais.filter((x) => !x.niveau_id).map((x) => ({ ...x, montant: Number(x.montant) })),
  };
}

router.get('/bareme', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const bareme = await lireBareme();
    if (!bareme) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });
    res.json(bareme);
  } catch (err) { next(err); }
});

/**
 * Enregistre la grille. Pour chaque colonne et chaque niveau : montant
 * saisi -> frais cree ou mis a jour ; case videe -> frais supprime, SAUF
 * s il porte deja des paiements (il est alors conserve et signale).
 */
router.put('/bareme', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const colonnes = Array.isArray(req.body.colonnes) ? req.body.colonnes : [];
    const { rows: an } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!an[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const vus = new Set();
    for (const c of colonnes) {
      const libelle = String(c.libelle || '').trim();
      if (!libelle) return res.status(400).json({ erreur: 'Chaque colonne doit avoir un libelle' });
      if (vus.has(cleFrais(libelle))) {
        return res.status(400).json({ erreur: `Le frais « ${libelle} » figure deux fois` });
      }
      vus.add(cleFrais(libelle));
      if (c.recurrent && c.mois_fin != null && c.mois_fin !== ''
          && !(Number(c.mois_fin) >= 1 && Number(c.mois_fin) <= 12)) {
        return res.status(400).json({ erreur: 'Dernier mois du invalide' });
      }
      for (const v of Object.values(c.montants || {})) {
        if (v !== null && v !== '' && !(Number(v) >= 0)) {
          return res.status(400).json({ erreur: `Montant invalide pour « ${libelle} »` });
        }
      }
    }

    // Un frais « pour tous les niveaux » du meme nom s ajouterait a celui du
    // niveau : l eleve le paierait deux fois
    const { rows: globaux } = await query(
      `SELECT libelle FROM frais WHERE annee_id = $1 AND niveau_id IS NULL`, [an[0].id]
    );
    const conflit = globaux.find((g) => vus.has(cleFrais(g.libelle)));
    if (conflit) {
      return res.status(409).json({
        erreur: `« ${conflit.libelle} » existe deja pour tous les niveaux : il serait compte deux fois. `
          + 'Renommez la colonne ou supprimez ce frais general.',
      });
    }

    const avertissements = [];
    await transaction(async (client) => {
      for (const c of colonnes) {
        const libelle = String(c.libelle).trim();
        const recurrent = Boolean(c.recurrent);
        const moisFin = recurrent && c.mois_fin ? Number(c.mois_fin) : null;
        const obligatoire = c.obligatoire !== false;
        for (const [niveauId, valeur] of Object.entries(c.montants || {})) {
          const { rows: ex } = await client.query(
            `SELECT f.id, (SELECT COUNT(*)::int FROM paiement p WHERE p.frais_id = f.id) AS paiements
             FROM frais f WHERE f.annee_id = $1 AND f.niveau_id = $2 AND lower(f.libelle) = lower($3)`,
            [an[0].id, Number(niveauId), libelle]
          );
          const vide = valeur === null || valeur === '';
          if (vide) {
            if (!ex[0]) continue;
            if (ex[0].paiements > 0) {
              avertissements.push(`« ${libelle} » conserve pour un niveau : des paiements y sont rattaches`);
              continue;
            }
            await client.query(`DELETE FROM frais WHERE id = $1`, [ex[0].id]);
          } else if (ex[0]) {
            await client.query(
              `UPDATE frais SET libelle = $2, montant = $3, recurrent = $4, obligatoire = $5, mois_fin = $6
               WHERE id = $1`,
              [ex[0].id, libelle, Number(valeur), recurrent, obligatoire, moisFin]
            );
          } else {
            await client.query(
              `INSERT INTO frais (annee_id, niveau_id, libelle, montant, recurrent, obligatoire, mois_fin)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [an[0].id, Number(niveauId), libelle, Number(valeur), recurrent, obligatoire, moisFin]
            );
          }
        }
      }
    });

    await tracer(req, 'modification_bareme', 'frais', null, { colonnes: colonnes.length });
    res.json({ ...(await lireBareme()), avertissements });
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

/**
 * Echeancier d un frais mensuel pour un eleve : mois de l annee active,
 * deja verse (cette annee uniquement) et etat de chaque mois.
 * `db` permet de lire dans une transaction en cours.
 */
async function echeancier(eleveId, fraisId, db = { query }) {
  const { rows } = await db.query(
    `SELECT f.id, f.libelle, f.montant, f.recurrent, f.mois_fin, a.date_debut, a.date_fin,
            COALESCE((SELECT SUM(p.montant) FROM paiement p
                      WHERE p.eleve_id = $1 AND p.frais_id = f.id
                        AND p.annee_id = f.annee_id AND NOT p.annule), 0) AS paye
     FROM frais f JOIN annee_scolaire a ON a.id = f.annee_id
     WHERE f.id = $2 AND a.active`,
    [eleveId, fraisId]
  );
  if (!rows[0]) return null;
  const f = rows[0];
  // « D octobre a juin » : les mois apres le dernier mois du ne sont pas dus
  const mois = moisDuFrais(moisDeLAnnee(f.date_debut, f.date_fin), f.mois_fin);
  return {
    id: f.id, libelle: f.libelle, montant: Number(f.montant), recurrent: f.recurrent,
    paye: Number(f.paye), mois, etat: etatDesMois(mois, f.montant, f.paye),
  };
}

/** Echeancier des frais mensuels d un eleve, pour le formulaire de caisse. */
router.get('/echeancier/:eleveId', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { rows: frais } = await query(
      `SELECT f.id FROM frais f
       LEFT JOIN inscription i ON i.eleve_id = $1 AND i.annee_id = f.annee_id
       LEFT JOIN classe c ON c.id = i.classe_id
       WHERE f.recurrent AND f.montant > 0
         AND f.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         AND (f.niveau_id IS NULL OR f.niveau_id = c.niveau_id)
       ORDER BY f.libelle`,
      [req.params.eleveId]
    );
    const resultat = [];
    for (const f of frais) {
      const e = await echeancier(Number(req.params.eleveId), f.id);
      if (e) resultat.push({ id: e.id, libelle: e.libelle, montant: e.montant, paye: e.paye, mois: e.etat });
    }
    res.json(resultat);
  } catch (err) { next(err); }
});

/**
 * Encaissement au guichet.
 *
 * Un encaissement peut regrouper plusieurs frais — a l inscription :
 * inscription, droit d inscription, blouse, assurance et premier mois — et
 * donne UN recu. `elements` : [{ frais_id, montant | nb_mois }]. L ancienne
 * forme (frais_id, montant, nb_mois a la racine) reste acceptee.
 *
 * Frais ponctuel : une ecriture. Frais MENSUEL : le versement est ventile
 * mois par mois, dans l ordre, a partir de ce qui est deja paye, soit en
 * `nb_mois` complets (montant calcule par le serveur), soit en `montant`
 * libre (avance, le dernier mois pouvant rester partiel). Toutes les
 * ecritures forment un lot : un seul recu, une seule annulation.
 */
router.post('/paiements', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { eleve_id, mode, reference, date_paiement } = req.body;
    if (!eleve_id) return res.status(400).json({ erreur: 'Eleve requis' });
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    const elements = Array.isArray(req.body.elements) && req.body.elements.length
      ? req.body.elements
      : [{
          frais_id: req.body.frais_id, montant: req.body.montant,
          nb_mois: req.body.nb_mois, mois_couvert: req.body.mois_couvert,
        }];

    // Tout est verifie avant la moindre ecriture
    const prepares = [];
    for (const el of elements) {
      const fraisId = el.frais_id ? Number(el.frais_id) : null;
      if (fraisId && prepares.some((p) => p.fraisId === fraisId)) {
        return res.status(400).json({ erreur: 'Un meme frais figure deux fois dans l encaissement' });
      }
      const ech = fraisId ? await echeancier(Number(eleve_id), fraisId) : null;
      if (fraisId && !ech) return res.status(400).json({ erreur: 'Frais introuvable pour l annee en cours' });
      const mensuel = Boolean(ech?.recurrent);

      let montant = Number(el.montant);
      if (mensuel && el.nb_mois != null && el.nb_mois !== '') {
        const nb = Number(el.nb_mois);
        montant = Number.isInteger(nb) ? montantPourMois(ech.etat, nb) : null;
        if (montant == null) {
          return res.status(400).json({ erreur: `${ech.libelle} : il ne reste pas autant de mois a regler` });
        }
      }
      if (!(montant > 0)) return res.status(400).json({ erreur: 'Eleve et montant positif requis' });
      prepares.push({ fraisId, libelle: ech?.libelle || null, mensuel, montant, mois: el.mois_couvert || null });
    }

    const lignes = await transaction(async (client) => {
      const creees = [];
      for (const p of prepares) {
        // Echeancier releve dans la transaction : un encaissement concurrent
        // ne doit pas faire couvrir deux fois le meme mois
        const etat = p.mensuel ? await echeancier(Number(eleve_id), p.fraisId, client) : null;
        const ventilation = p.mensuel
          ? repartirVersement(etat.mois, etat.montant, etat.paye, p.montant)
          : [{ mois: p.mois, montant: p.montant }];

        for (const v of ventilation) {
          // Numero de recu sequentiel, commun au guichet et au paiement Wave
          const numero = await prochainNumeroRecu(client);
          const { rows } = await client.query(
            `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, reference,
                                   numero_recu, mois_couvert, date_paiement, encaisse_par)
             VALUES ($1,$2,$3,$4,COALESCE($5,'especes'),$6,$7,$8,COALESCE($9,CURRENT_DATE),$10)
             RETURNING *`,
            [eleve_id, p.fraisId, ar[0].id, v.montant, mode, reference || null,
             numero, v.mois, date_paiement || null, req.user.id]
          );
          creees.push({ ...rows[0], frais: p.libelle });
        }
      }
      // Plusieurs ecritures : un lot, donc un seul recu et une seule annulation
      if (creees.length > 1) {
        await client.query(`UPDATE paiement SET lot = $1 WHERE id = ANY($2)`,
          [creees[0].id, creees.map((x) => x.id)]);
      }
      return creees;
    });

    const total = prepares.reduce((s, p) => s + p.montant, 0);
    await tracer(req, 'encaissement', 'paiement', lignes[0].id, {
      montant: total, ecritures: lignes.length,
    });
    // La premiere ecriture ouvre le recu ; le montant est celui de l encaissement
    const { frais: _f, ...premiere } = lignes[0];
    res.status(201).json({
      ...premiere,
      montant: total,
      lignes: lignes.map((l) => ({
        numero_recu: l.numero_recu, frais: l.frais, mois: l.mois_couvert, montant: Number(l.montant),
      })),
    });
  } catch (err) { next(err); }
});

// Annulation (on ne supprime jamais une ecriture comptable). Une ecriture
// d un lot annule tout le lot : c est un seul encaissement.
router.patch('/paiements/:id/annuler', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE paiement SET annule = true
       WHERE annule = false
         AND (id = $1 OR lot = (SELECT lot FROM paiement WHERE id = $1 AND lot IS NOT NULL))
       RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Paiement introuvable ou deja annule' });
    await tracer(req, 'annulation', 'paiement', Number(req.params.id), {
      motif: req.body.motif || null, ecritures: rows.length,
    });
    res.json({ message: 'Paiement annule', paiement: rows[0], ecritures: rows.length });
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
                        -- Seuls les versements de CETTE annee : un paiement
                        -- d une annee passee ne regle pas la scolarite en cours
                        WHERE p.eleve_id = $1 AND p.frais_id = f.id
                          AND p.annee_id = f.annee_id AND NOT p.annule), 0) AS paye
       FROM frais f
       WHERE f.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         AND (f.niveau_id IS NULL OR f.niveau_id = $2)
       ORDER BY f.libelle`,
      [req.params.eleveId, info[0].niveau_id]
    );

    const exigibles = await exigiblesParFrais();
    const lignes = frais.map((f) => {
      // Un frais mensuel est du pour chaque mois deja commence, jusqu a son
      // dernier mois (juin pour « octobre a juin »)
      const du = f.recurrent ? Number(f.montant) * (exigibles[f.id] ?? 0) : Number(f.montant);
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
 * Nombre de mensualites exigibles a ce jour, frais mensuel par frais
 * mensuel de l annee active : { [frais_id]: nombre }. Chaque frais s arrete
 * a son dernier mois du ; apres celui-ci, la totalite est due, jamais plus.
 */
async function exigiblesParFrais(maintenant = new Date()) {
  const { rows } = await query(
    `SELECT f.id, f.mois_fin, a.date_debut, a.date_fin
     FROM frais f JOIN annee_scolaire a ON a.id = f.annee_id
     WHERE a.active AND f.recurrent`
  );
  const resultat = {};
  for (const f of rows) {
    resultat[f.id] = nbMoisExigibles(moisDuFrais(moisDeLAnnee(f.date_debut, f.date_fin), f.mois_fin), maintenant);
  }
  return resultat;
}

// Liste des impayes
router.get('/impayes', autoriser(...CAISSE, 'censeur'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `WITH du_par_eleve AS (
         SELECT e.id AS eleve_id,
                SUM(CASE WHEN f.recurrent
                         THEN f.montant * COALESCE(($1::jsonb ->> f.id::text)::int, 0)
                         ELSE f.montant END) AS total_du
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
         AND p.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       GROUP BY e.id, e.matricule, e.prenom, e.nom, c.libelle, d.total_du
       HAVING d.total_du - COALESCE(SUM(p.montant) FILTER (WHERE NOT p.annule), 0) > 0
       ORDER BY reste DESC`,
      [JSON.stringify(await exigiblesParFrais())]
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

// ---------- Recus de paiement ----------
/**
 * Un recu par paiement : une ecriture du guichet, ou toutes les ecritures
 * nees d un meme paiement Wave (une par mois couvert). Les ecritures Wave
 * n existent qu apres la confirmation de la caisse : un paiement declare
 * mais pas encore verifie n a donc pas de recu.
 *
 * Acces : la caisse pour tous, le tuteur pour son seul enfant.
 */
function accesRecu(req, eleveId) {
  if (CAISSE.includes(req.user.role)) return true;
  return estTuteur(req.user) && Number(eleveSuivi(req.user)) === Number(eleveId);
}

/** Liste des recus d un eleve, les ecritures Wave regroupees par paiement. */
router.get('/recus', async (req, res, next) => {
  try {
    const eleveId = estTuteur(req.user) ? eleveSuivi(req.user) : Number(req.query.eleve_id);
    if (!eleveId || !accesRecu(req, eleveId)) {
      return res.status(403).json({ erreur: 'Acces refuse' });
    }
    const { rows } = await query(
      `SELECT MIN(p.id) AS id, MIN(p.numero_recu) AS numero_recu, COUNT(*)::int AS lignes,
              SUM(p.montant)::numeric AS montant, MIN(p.date_paiement) AS date_paiement,
              p.mode, f.libelle AS frais, bool_or(p.annule) AS annule,
              string_agg(p.mois_couvert, ',' ORDER BY p.id) AS mois
       FROM paiement p
       LEFT JOIN frais f ON f.id = p.frais_id
       WHERE p.eleve_id = $1 AND ($2::boolean OR NOT p.annule)
       -- Un recu par paiement Wave, par lot du guichet, sinon par ecriture
       GROUP BY COALESCE('w' || p.paiement_en_ligne_id, 'l' || p.lot, 'p' || p.id), p.mode, f.libelle
       ORDER BY MIN(p.date_paiement) DESC, MIN(p.id) DESC`,
      // Le tuteur ne voit pas les ecritures annulees : elles ne valent rien
      [eleveId, !estTuteur(req.user)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/** Recu complet, pret a imprimer. `:id` est l id d une ecriture du recu. */
router.get('/recus/:id', async (req, res, next) => {
  try {
    const { rows: base } = await query(
      `SELECT id, eleve_id, paiement_en_ligne_id, lot FROM paiement WHERE id = $1`,
      [Number(req.params.id)]
    );
    // 404 aussi quand l acces est refuse : ne pas reveler qu un recu existe
    if (!base[0] || !accesRecu(req, base[0].eleve_id)) {
      return res.status(404).json({ erreur: 'Recu introuvable' });
    }

    const { rows: lignes } = await query(
      `SELECT p.id, p.numero_recu, p.montant, p.mode, p.reference, p.mois_couvert,
              p.date_paiement, p.annule, p.cree_le, p.annee_id,
              f.libelle AS frais,
              u.prenom AS caissier_prenom, u.nom AS caissier_nom
       FROM paiement p
       LEFT JOIN frais f ON f.id = p.frais_id
       LEFT JOIN utilisateur u ON u.id = p.encaisse_par
       WHERE ${base[0].paiement_en_ligne_id ? 'p.paiement_en_ligne_id = $1'
         : base[0].lot ? 'p.lot = $1' : 'p.id = $1'}
       ORDER BY p.id`,
      [base[0].paiement_en_ligne_id || base[0].lot || base[0].id]
    );
    const premiere = lignes[0];

    const { rows: eleve } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom, c.libelle AS classe, a.libelle AS annee,
              (SELECT t.prenom || ' ' || t.nom FROM tuteur t
               JOIN eleve_tuteur et ON et.tuteur_id = t.id
               WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1) AS tuteur
       FROM eleve e
       LEFT JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $2
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN annee_scolaire a ON a.id = $2
       WHERE e.id = $1`,
      [base[0].eleve_id, premiere.annee_id]
    );

    let wave = null;
    if (base[0].paiement_en_ligne_id) {
      const { rows } = await query(
        `SELECT pel.transaction_id, pel.telephone_payeur, pel.confirme_le,
                pel.declare_le, pel.mode,
                v.prenom AS verificateur_prenom, v.nom AS verificateur_nom,
                ini.prenom || ' ' || ini.nom AS payeur
         FROM paiement_en_ligne pel
         LEFT JOIN utilisateur v ON v.id = pel.verifie_par
         LEFT JOIN utilisateur ini ON ini.id = pel.initie_par
         WHERE pel.id = $1`,
        [base[0].paiement_en_ligne_id]
      );
      wave = rows[0] || null;
    }

    const { rows: etab } = await query(
      `SELECT nom, sigle, adresse, telephone, email FROM etablissement ORDER BY id LIMIT 1`
    );

    const valides = lignes.filter((l) => !l.annule);
    const total = valides.reduce((s, l) => s + Number(l.montant), 0);
    res.json({
      etablissement: etab[0] || null,
      eleve: eleve[0],
      numeros: lignes.map((l) => l.numero_recu),
      date_paiement: premiere.date_paiement,
      mode: premiere.mode,
      reference: wave?.transaction_id || premiere.reference || null,
      annule: valides.length === 0,
      lignes: lignes.map((l) => ({
        numero_recu: l.numero_recu, frais: l.frais, mois: l.mois_couvert,
        montant: Number(l.montant), annule: l.annule,
      })),
      total,
      total_lettres: montantEnLettres(total),
      // Qui a encaisse au guichet, ou qui a confirme le paiement Wave
      valide_par: premiere.caissier_prenom
        ? `${premiere.caissier_prenom} ${premiere.caissier_nom}`
        : wave?.verificateur_prenom ? `${wave.verificateur_prenom} ${wave.verificateur_nom}` : null,
      valide_le: wave?.confirme_le || premiere.cree_le,
      payeur: wave?.payeur || eleve[0]?.tuteur || null,
      wave,
    });
  } catch (err) { next(err); }
});

export default router;
