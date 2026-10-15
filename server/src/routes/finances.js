import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { verifierEleveTuteur, estTuteur, eleveSuivi } from '../middleware/portee-tuteur.js';
import { prochainNumeroRecu } from '../db/recus.js';
import { montantEnLettres } from '../metier/montant-lettres.js';
import {
  moisDeLAnnee, moisDuFrais, nbMoisExigibles, etatDesMois, resteExigible,
  montantPourMois, ventilerVersement, resteAnnee, deduireEnCours, moisCourant,
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
  const { rows: an } = await query(
    `SELECT id, libelle, date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`
  );
  if (!an[0]) return null;
  // Annee active deja terminee : le bareme serait saisi sur la mauvaise annee
  an[0].terminee = new Date(an[0].date_fin) < new Date();
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
    // Le dernier mois du peut varier d un niveau a l autre (juillet en 3eme)
    col.montants[f.niveau_id] = {
      id: f.id, montant: Number(f.montant), paiements: f.paiements, mois_fin: f.mois_fin,
    };
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
        const montant = v !== null && typeof v === 'object' ? v.montant : v;
        if (montant !== null && montant !== '' && montant !== undefined && !(Number(montant) >= 0)) {
          return res.status(400).json({ erreur: `Montant invalide pour « ${libelle} »` });
        }
        const fin = v !== null && typeof v === 'object' ? v.mois_fin : null;
        if (fin != null && fin !== '' && !(Number(fin) >= 1 && Number(fin) <= 12)) {
          return res.status(400).json({ erreur: 'Dernier mois du invalide' });
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
        for (const [niveauId, cellule] of Object.entries(c.montants || {})) {
          // Une case : un montant, ou { montant, mois_fin } quand le dernier
          // mois du differe de celui de la colonne (3eme : juillet)
          const enObjet = cellule !== null && typeof cellule === 'object';
          const valeur = enObjet ? cellule.montant ?? null : cellule;
          const moisFinCase = recurrent && enObjet && cellule.mois_fin ? Number(cellule.mois_fin) : moisFin;
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
              [ex[0].id, libelle, Number(valeur), recurrent, obligatoire, moisFinCase]
            );
          } else {
            await client.query(
              `INSERT INTO frais (annee_id, niveau_id, libelle, montant, recurrent, obligatoire, mois_fin)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [an[0].id, Number(niveauId), libelle, Number(valeur), recurrent, obligatoire, moisFinCase]
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

/** Montant lisible dans un message : 10 000 F. */
const enFrancs = (n) => `${Math.round(Number(n)).toLocaleString('fr-FR')} F`;
const refus = (message) => Object.assign(new Error(message), { status: 409 });

/** Sommes declarees par Wave par le parent, que la caisse n a pas encore verifiees. */
export async function montantEnVerification(db, eleveId, fraisId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(montant), 0)::numeric AS n FROM paiement_en_ligne
     WHERE eleve_id = $1 AND frais_id = $2 AND statut = 'a_verifier'`,
    [eleveId, fraisId]
  );
  return Number(rows[0].n);
}

/**
 * Controles avant d encaisser un frais, dans la transaction (l eleve est
 * verrouille) : rien ne se paie deux fois.
 *   - frais unique (droit d inscription, blouse...) : pas au-dela de son
 *     montant ;
 *   - mensualite : pas au-dela de ce qui reste sur l annee, et pas un mois
 *     que le parent vient de declarer par Wave sans verification.
 * Leve une erreur 409 au message pret a afficher.
 */
async function controlerEncaissement(client, eleveId, p) {
  if (!p.fraisId) return;
  if (p.mensuel) {
    const { etat } = await echeancier(eleveId, p.fraisId, client);
    const reste = resteAnnee(etat);
    if (reste <= 0) throw refus(`${p.libelle} : toute l'année est déjà réglée`);
    if (p.montant > reste) {
      const n = etat.filter((e) => e.reste_du > 0).length;
      throw refus(`${p.libelle} : il ne reste que ${enFrancs(reste)} à payer sur l'année (${n} mois)`);
    }
    const enCours = await montantEnVerification(client, eleveId, p.fraisId);
    if (enCours > 0 && p.montant > reste - enCours) {
      throw refus(`${p.libelle} : le parent a déclaré un paiement Wave de ${enFrancs(enCours)} qui attend `
        + "votre vérification (Finances → Paiements Wave). Validez-le ou rejetez-le avant d'encaisser ces mois.");
    }
    return;
  }
  const { rows } = await client.query(
    `SELECT f.montant, COALESCE((SELECT SUM(p.montant) FROM paiement p
              WHERE p.eleve_id = $1 AND p.frais_id = f.id AND p.annee_id = f.annee_id AND NOT p.annule), 0) AS paye
     FROM frais f WHERE f.id = $2`,
    [eleveId, p.fraisId]
  );
  const reste = Number(rows[0].montant) - Number(rows[0].paye);
  if (reste <= 0) throw refus(`${p.libelle} : déjà réglé (${enFrancs(rows[0].paye)} payés)`);
  if (p.montant > reste) {
    throw refus(`${p.libelle} : il ne reste que ${enFrancs(reste)} à payer (déjà payé : ${enFrancs(rows[0].paye)})`);
  }
}
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
    `SELECT f.id, f.libelle, f.montant, f.recurrent, f.mois_fin, a.date_debut, a.date_fin
     FROM frais f JOIN annee_scolaire a ON a.id = f.annee_id
     WHERE f.id = $1 AND a.active`,
    [fraisId]
  );
  if (!rows[0]) return null;
  const f = rows[0];
  // Chaque versement avec son mois : celui paye a l inscription (le dernier
  // mois) regle ce mois-la, pas octobre
  const { rows: versements } = await db.query(
    `SELECT montant, mois_couvert AS mois FROM paiement
     WHERE eleve_id = $1 AND frais_id = $2 AND NOT annule
       AND annee_id = (SELECT annee_id FROM frais WHERE id = $2)
     ORDER BY id`,
    [eleveId, fraisId]
  );
  // « D octobre a juin » : les mois apres le dernier mois du ne sont pas dus
  const mois = moisDuFrais(moisDeLAnnee(f.date_debut, f.date_fin), f.mois_fin);
  return {
    id: f.id, libelle: f.libelle, montant: Number(f.montant), recurrent: f.recurrent,
    paye: versements.reduce((t, v) => t + Number(v.montant), 0),
    mois, etat: etatDesMois(mois, f.montant, versements),
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
      if (e) {
        resultat.push({
          id: e.id, libelle: e.libelle, montant: e.montant, paye: e.paye, mois: e.etat,
          en_verification: await montantEnVerification({ query }, Number(req.params.eleveId), e.id),
        });
      }
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

      // A l inscription, le mois paye est le dernier de l annee (juin, ou
      // juillet pour une classe d examen), pas le mois en cours
      const dernierDabord = mensuel && Boolean(el.dernier_mois);
      let montant = Number(el.montant);
      if (mensuel && el.nb_mois != null && el.nb_mois !== '') {
        const nb = Number(el.nb_mois);
        montant = Number.isInteger(nb) ? montantPourMois(ech.etat, nb, { dernierDabord }) : null;
        if (montant == null) {
          return res.status(400).json({ erreur: `${ech.libelle} : il ne reste pas autant de mois a regler` });
        }
      }
      if (!(montant > 0)) return res.status(400).json({ erreur: 'Eleve et montant positif requis' });
      prepares.push({
        fraisId, libelle: ech?.libelle || null, mensuel, dernierDabord, montant, mois: el.mois_couvert || null,
      });
    }

    // Ce que verse un eleve cas social n est pas une recette de scolarite
    const { rows: [el] } = await query(`SELECT cas_social FROM eleve WHERE id = $1`, [Number(eleve_id)]);
    if (!el) return res.status(404).json({ erreur: 'Eleve introuvable' });
    const categorie = el.cas_social ? 'autres_recettes' : 'scolarite';

    const lignes = await transaction(async (client) => {
      // Un encaissement a la fois par eleve : deux caisses ne peuvent pas
      // regler le meme mois en meme temps
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('epsin_paiement'), $1)`, [Number(eleve_id)]);
      for (const p of prepares) await controlerEncaissement(client, Number(eleve_id), p);
      const creees = [];
      for (const p of prepares) {
        // Echeancier releve dans la transaction : un encaissement concurrent
        // ne doit pas faire couvrir deux fois le meme mois
        const etat = p.mensuel ? await echeancier(Number(eleve_id), p.fraisId, client) : null;
        const ventilation = p.mensuel
          ? ventilerVersement(etat.etat, p.montant, { dernierDabord: p.dernierDabord })
          : [{ mois: p.mois, montant: p.montant }];

        for (const v of ventilation) {
          // Numero de recu sequentiel, commun au guichet et au paiement Wave
          const numero = await prochainNumeroRecu(client);
          const { rows } = await client.query(
            `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, reference,
                                   numero_recu, mois_couvert, date_paiement, encaisse_par, categorie)
             VALUES ($1,$2,$3,$4,COALESCE($5,'especes'),$6,$7,$8,COALESCE($9,CURRENT_DATE),$10,$11)
             RETURNING *`,
            [eleve_id, p.fraisId, ar[0].id, v.montant, mode, reference || null,
             numero, v.mois, date_paiement || null, req.user.id, categorie]
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

    const situation = await calculerSituation(req.params.eleveId);
    if (!situation) return res.status(404).json({ erreur: 'Eleve introuvable' });
    res.json(situation);
  } catch (err) { next(err); }
});

/**
 * Situation financiere d un eleve sur l annee active : du a ce jour, paye,
 * reste, frais par frais. Partagee par la fiche Finances et le recu, pour
 * qu ils affichent toujours les memes chiffres. null si l eleve n existe pas.
 */
async function calculerSituation(eleveId) {
  const { rows: info } = await query(
    `SELECT e.id, e.matricule, e.prenom, e.nom, c.libelle AS classe, c.niveau_id,
            e.cas_social, e.cas_social_motif,
            (SELECT libelle FROM annee_scolaire WHERE active LIMIT 1) AS annee
     FROM eleve e
     LEFT JOIN inscription i ON i.eleve_id = e.id
       AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
     LEFT JOIN classe c ON c.id = i.classe_id
     WHERE e.id = $1`,
    [eleveId]
  );
  if (!info[0]) return null;

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
    [eleveId, info[0].niveau_id]
  );

  // Annee et versements de l eleve, mois par mois
  const { rows: an } = await query(
    `SELECT date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`
  );
  const moisAnnee = an[0] ? moisDeLAnnee(an[0].date_debut, an[0].date_fin) : [];
  const { rows: versements } = await query(
    `SELECT frais_id, montant, mois_couvert AS mois FROM paiement
     WHERE eleve_id = $1 AND NOT annule
       AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
     ORDER BY id`,
    [eleveId]
  );

  const lignes = frais.map((f) => {
    // Cas social : rien n est du. reste_frais garde ce qui reste sur le
    // frais lui-meme, pour une contribution volontaire au guichet.
    if (info[0].cas_social) {
      const resteFrais = f.recurrent ? null : Math.max(Number(f.montant) - Number(f.paye), 0);
      return { ...f, du: 0, reste: 0, reste_frais: resteFrais };
    }
    if (!f.recurrent) {
      const du = Number(f.montant);
      return { ...f, du, reste: Math.max(du - Number(f.paye), 0) };
    }
    // Un frais mensuel est du pour chaque mois deja commence, jusqu a son
    // dernier mois (juin, ou juillet pour une classe d examen). Le mois paye
    // d avance a l inscription ne dispense pas des mois en cours.
    const mois = moisDuFrais(moisAnnee, f.mois_fin);
    const etat = etatDesMois(mois, f.montant, versements.filter((v) => v.frais_id === f.id));
    return {
      ...f, etat,
      du: Number(f.montant) * nbMoisExigibles(mois),
      reste: resteExigible(etat),
    };
  });

  // Versements sans frais precis (contribution d un cas social) : payes aussi
  const horsFrais = versements.filter((v) => !v.frais_id).reduce((s, v) => s + Number(v.montant), 0);
  const totalDu = lignes.reduce((s, l) => s + l.du, 0);
  const totalPaye = lignes.reduce((s, l) => s + Number(l.paye), 0) + horsFrais;
  const totalReste = lignes.reduce((s, l) => s + l.reste, 0);

  return {
    eleve: info[0],
    lignes,
    total_du: totalDu,
    total_paye: totalPaye,
    reste: totalReste,
    a_jour: totalReste === 0,
  };
}

/**
 * Suivi d un mois, classe par classe : qui a paye la mensualite de ce mois,
 * qui ne l a pas payee — pour relancer les parents. Par defaut le mois en
 * cours (borne a l annee scolaire). Pour chaque eleve : statut du mois,
 * reste du mois, et retard cumule jusqu a ce mois inclus (les mois
 * precedents non regles), avec le contact du tuteur.
 *
 * Une declaration Wave en attente de verification couvre ses mois : statut
 * « en_verification », on ne relance pas un parent qui a deja paye.
 */
router.get('/suivi-mois', autoriser(...CAISSE, 'censeur'), async (req, res, next) => {
  try {
    const { rows: an } = await query(
      `SELECT id, libelle, date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`
    );
    if (!an[0]) return res.json({ annee: null, mois: null, mois_disponibles: [], classes: [] });
    const moisAnnee = moisDeLAnnee(an[0].date_debut, an[0].date_fin);
    const demande = /^\d{4}-\d{2}$/.test(String(req.query.mois || '')) ? req.query.mois : moisCourant();
    const mois = moisAnnee.includes(demande) ? demande
      : (demande < moisAnnee[0] ? moisAnnee[0] : moisAnnee.at(-1));

    const { rows: eleves } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom, e.sexe, e.cas_social,
              c.id AS classe_id, c.libelle AS classe, c.niveau_id, n.ordre,
              t.prenom || ' ' || t.nom AS tuteur, t.telephone
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $1
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       LEFT JOIN LATERAL (
         SELECT t.prenom, t.nom, t.telephone FROM tuteur t
         JOIN eleve_tuteur et ON et.tuteur_id = t.id
         WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1
       ) t ON true
       WHERE e.statut = 'actif'
       ORDER BY n.ordre, c.libelle, e.nom, e.prenom`,
      [an[0].id]
    );
    // Mensualites obligatoires (un frais facultatif comme la cantine n est pas du par tous)
    const { rows: frais } = await query(
      `SELECT id, niveau_id, libelle, montant, mois_fin FROM frais
       WHERE annee_id = $1 AND recurrent AND obligatoire AND montant > 0`,
      [an[0].id]
    );
    const { rows: versements } = await query(
      `SELECT eleve_id, frais_id, montant, mois_couvert AS mois FROM paiement
       WHERE annee_id = $1 AND NOT annule AND frais_id IS NOT NULL ORDER BY id`,
      [an[0].id]
    );
    const { rows: enCours } = await query(
      `SELECT eleve_id, frais_id, SUM(montant)::numeric AS montant FROM paiement_en_ligne
       WHERE annee_id = $1 AND statut = 'a_verifier' GROUP BY eleve_id, frais_id`,
      [an[0].id]
    );
    const cle = (e, f) => `${e}:${f}`;
    const parCle = new Map();
    for (const v of versements) {
      if (!parCle.has(cle(v.eleve_id, v.frais_id))) parCle.set(cle(v.eleve_id, v.frais_id), []);
      parCle.get(cle(v.eleve_id, v.frais_id)).push(v);
    }
    const attente = new Map(enCours.map((x) => [cle(x.eleve_id, x.frais_id), Number(x.montant)]));

    const classes = new Map();
    for (const e of eleves) {
      let du = 0, verse = 0, reste = 0, verification = 0, retard = 0;
      const moisRetard = new Set();
      for (const f of frais.filter((x) => !x.niveau_id || x.niveau_id === e.niveau_id)) {
        const liste = moisDuFrais(moisAnnee, f.mois_fin);
        if (!liste.includes(mois)) continue;
        const etat = deduireEnCours(
          etatDesMois(liste, f.montant, parCle.get(cle(e.id, f.id)) || []),
          attente.get(cle(e.id, f.id)) || 0
        );
        const m = etat.find((x) => x.mois === mois);
        du += Number(f.montant);
        verse += m.verse;
        reste += m.reste_du;
        verification += m.en_verification || 0;
        for (const x of etat.filter((y) => y.mois <= mois && y.reste_du > 0)) {
          retard += x.reste_du;
          moisRetard.add(x.mois);
        }
      }
      let statut;
      if (e.cas_social) statut = 'cas_social';
      else if (du === 0) statut = 'sans_mensualite';
      else if (reste === 0) statut = verification > 0 && verse < du ? 'en_verification' : 'paye';
      else if (verse > 0 || verification > 0) statut = 'partiel';
      else statut = 'non_paye';

      if (!classes.has(e.classe_id)) {
        classes.set(e.classe_id, { id: e.classe_id, libelle: e.classe, eleves: [] });
      }
      classes.get(e.classe_id).eleves.push({
        id: e.id, matricule: e.matricule, prenom: e.prenom, nom: e.nom, sexe: e.sexe,
        tuteur: e.tuteur, telephone: e.telephone,
        statut, du, verse, reste, en_verification: verification,
        retard, mois_retard: [...moisRetard].sort(),
      });
    }
    res.json({
      annee: an[0].libelle,
      mois,
      mois_disponibles: moisAnnee,
      classes: [...classes.values()],
    });
  } catch (err) { next(err); }
});

// Liste des impayes
router.get('/impayes', autoriser(...CAISSE, 'censeur'), async (req, res, next) => {
  try {
    // Meme regle que la situation de chaque eleve : un mois paye d avance
    // (juin a l inscription) ne dispense pas des mois deja commences
    const { rows: an } = await query(
      `SELECT id, date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`
    );
    if (!an[0]) return res.json([]);
    const moisAnnee = moisDeLAnnee(an[0].date_debut, an[0].date_fin);

    const { rows: eleves } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom, c.libelle AS classe, c.niveau_id,
              (SELECT t.telephone FROM tuteur t
               JOIN eleve_tuteur et ON et.tuteur_id = t.id
               WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1) AS contact
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $1
       JOIN classe c ON c.id = i.classe_id
       WHERE e.statut = 'actif' AND NOT e.cas_social`,
      [an[0].id]
    );
    const { rows: frais } = await query(
      `SELECT id, niveau_id, montant, recurrent, mois_fin FROM frais
       WHERE annee_id = $1 AND obligatoire AND montant > 0`,
      [an[0].id]
    );
    const { rows: versements } = await query(
      `SELECT eleve_id, frais_id, montant, mois_couvert AS mois FROM paiement
       WHERE annee_id = $1 AND NOT annule AND frais_id IS NOT NULL ORDER BY id`,
      [an[0].id]
    );
    const parCle = new Map();
    for (const v of versements) {
      const cle = `${v.eleve_id}:${v.frais_id}`;
      if (!parCle.has(cle)) parCle.set(cle, []);
      parCle.get(cle).push(v);
    }

    const impayes = [];
    for (const e of eleves) {
      let du = 0, paye = 0, reste = 0;
      for (const f of frais.filter((x) => !x.niveau_id || x.niveau_id === e.niveau_id)) {
        const vs = parCle.get(`${e.id}:${f.id}`) || [];
        const verse = vs.reduce((t, v) => t + Number(v.montant), 0);
        paye += verse;
        if (f.recurrent) {
          const mois = moisDuFrais(moisAnnee, f.mois_fin);
          du += Number(f.montant) * nbMoisExigibles(mois);
          reste += resteExigible(etatDesMois(mois, f.montant, vs));
        } else {
          du += Number(f.montant);
          reste += Math.max(Number(f.montant) - verse, 0);
        }
      }
      if (reste > 0) {
        const { niveau_id: _n, ...ligne } = e;
        impayes.push({ ...ligne, total_du: du, total_paye: paye, reste });
      }
    }
    impayes.sort((a, b) => b.reste - a.reste);
    res.json(impayes);
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
    const { rows: parCategorie } = await query(
      `SELECT categorie, SUM(montant) AS montant, COUNT(*)::int AS nombre
       FROM paiement
       WHERE NOT annule AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       GROUP BY categorie`
    );
    const categorie = (c) => Number(parCategorie.find((x) => x.categorie === c)?.montant || 0);
    res.json({
      ...totaux[0],
      solde: Number(totaux[0].recettes) - Number(totaux[0].depenses),
      recettes_scolarite: categorie('scolarite'),
      autres_recettes: categorie('autres_recettes'),
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
              MIN(p.mode) AS mode, bool_or(p.annule) AS annule,
              bool_or(p.categorie = 'autres_recettes') AS autres_recettes,
              string_agg(DISTINCT f.libelle, ', ') AS frais,
              string_agg(p.mois_couvert, ',' ORDER BY p.id) AS mois,
              -- Detail du recu : chaque frais avec son mois et son montant
              json_agg(json_build_object('frais', f.libelle, 'mois', p.mois_couvert, 'montant', p.montant)
                       ORDER BY p.id) AS details
       FROM paiement p
       LEFT JOIN frais f ON f.id = p.frais_id
       WHERE p.eleve_id = $1 AND ($2::boolean OR NOT p.annule)
       -- Un recu par paiement Wave, par lot du guichet (inscription : tous
       -- les frais ensemble), sinon par ecriture
       GROUP BY COALESCE('w' || p.paiement_en_ligne_id, 'l' || p.lot, 'p' || p.id)
       ORDER BY MIN(p.date_paiement) DESC, MIN(p.id) DESC`,
      // Le tuteur ne voit pas les ecritures annulees : elles ne valent rien
      [eleveId, !estTuteur(req.user)]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * Situation de l eleve imprimee sur le recu (a la date d edition) : du a ce
 * jour, paye, reste, et dernier mois regle de chaque mensualite.
 */
async function situationPourRecu(eleveId) {
  const sit = await calculerSituation(eleveId);
  if (!sit) return null;
  const mensualites = [];
  for (const l of sit.lignes.filter((x) => x.recurrent)) {
    const e = await echeancier(eleveId, l.id);
    if (!e) continue;
    const regles = e.etat.filter((m) => m.statut === 'paye');
    mensualites.push({
      libelle: l.libelle,
      regle_jusqu_a: regles.length ? regles.at(-1).mois : null,
      mois_restants: e.etat.filter((m) => m.statut !== 'paye').length,
    });
  }
  return {
    total_du: sit.total_du, total_paye: sit.total_paye, reste: sit.reste,
    mensualites: sit.eleve.cas_social ? [] : mensualites,
    cas_social: Boolean(sit.eleve.cas_social),
  };
}

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
      `SELECT e.id, e.matricule, e.prenom, e.nom, e.sexe, e.date_naissance, e.lieu_naissance,
              c.libelle AS classe, n.libelle AS niveau, a.libelle AS annee,
              t.prenom || ' ' || t.nom AS tuteur, t.telephone AS tuteur_telephone, t.lien AS tuteur_lien
       FROM eleve e
       LEFT JOIN LATERAL (
         SELECT t.prenom, t.nom, t.telephone, et.lien FROM tuteur t
         JOIN eleve_tuteur et ON et.tuteur_id = t.id
         WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1
       ) t ON true
       LEFT JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $2
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN niveau n ON n.id = c.niveau_id
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
      situation: await situationPourRecu(base[0].eleve_id),
    });
  } catch (err) { next(err); }
});

export default router;
