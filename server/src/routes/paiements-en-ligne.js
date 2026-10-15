import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { eleveSuivi, estTuteur } from '../middleware/portee-tuteur.js';
import { prochainNumeroRecu } from '../db/recus.js';
import {
  moisDeLAnnee, moisDuFrais, moisCourant, etatDesMois, montantPourMois, ventilerVersement,
  deduireEnCours, resteAnnee,
} from '../metier/mensualites.js';
import {
  waveConfigure, modePaiement, lienAvecMontant,
  creerSession, lireSession, signatureValide,
} from '../services/wave.js';

/**
 * Paiement des mensualites en ligne par le tuteur, via Wave.
 *
 * Le montant est TOUJOURS calcule par le serveur a partir du nombre de mois
 * choisi : le client ne propose jamais de somme. Les ecritures comptables
 * ne sont creees qu a la confirmation — par la caisse (lien marchand) ou
 * par Wave (API). Une tentative abandonnee ne laisse aucune trace en caisse.
 */
const router = Router();
router.use(authentifier);

const CAISSE = ['admin', 'comptable'];
const MAX_MOIS = 12;
/** Identifiant de transaction Wave : lettres, chiffres, tirets, soulignes. */
const FORMAT_TRANSACTION = /^[A-Za-z0-9_.-]{4,64}$/;

/** Adresse de l interface, vers laquelle Wave renvoie le tuteur (mode api). */
function urlInterface() {
  const url = process.env.APP_URL || process.env.CORS_ORIGIN?.split(',')[0];
  return url ? url.trim().replace(/\/$/, '') : null;
}

/**
 * Mensualites d un eleve pour une annee : chaque frais recurrent obligatoire applicable
 * a son niveau, ce qui est deja verse, et l etat mois par mois.
 * `db` permet de lire dans une transaction en cours.
 */
async function mensualitesDe(eleveId, anneeId = null, db = { query }) {
  const { rows: an } = await db.query(
    anneeId
      ? `SELECT id, libelle, date_debut, date_fin FROM annee_scolaire WHERE id = $1`
      : `SELECT id, libelle, date_debut, date_fin FROM annee_scolaire WHERE active LIMIT 1`,
    anneeId ? [anneeId] : []
  );
  if (!an[0]) return { annee: null, mois: [], frais: [] };

  const { rows: insc } = await db.query(
    `SELECT c.niveau_id, e.cas_social FROM inscription i
     JOIN classe c ON c.id = i.classe_id JOIN eleve e ON e.id = i.eleve_id
     WHERE i.eleve_id = $1 AND i.annee_id = $2`,
    [eleveId, an[0].id]
  );
  if (!insc[0]) return { annee: an[0], mois: [], frais: [] };
  // Cas social : aucune mensualite due, rien a payer en ligne
  if (insc[0].cas_social) return { annee: an[0], mois: [], frais: [], cas_social: true };

  const { rows: frais } = await db.query(
    `SELECT f.id, f.libelle, f.montant, f.mois_fin,
            COALESCE((SELECT SUM(p.montant) FROM paiement p
                      WHERE p.eleve_id = $1 AND p.frais_id = f.id
                        AND p.annee_id = f.annee_id AND NOT p.annule), 0) AS paye
     FROM frais f
     -- Seuls les frais mensuels OBLIGATOIRES : un frais facultatif (cantine)
     -- n est pas du par tous, l afficher « a regler » serait faux.
     WHERE f.annee_id = $2 AND f.recurrent AND f.obligatoire AND f.montant > 0
       AND (f.niveau_id IS NULL OR f.niveau_id = $3)
     ORDER BY f.libelle`,
    [eleveId, an[0].id, insc[0].niveau_id]
  );

  // Versements mois par mois : le mois paye a l inscription (le dernier de
  // l annee) est deja regle, octobre reste du
  const { rows: versements } = await db.query(
    `SELECT frais_id, montant, mois_couvert AS mois FROM paiement
     WHERE eleve_id = $1 AND annee_id = $2 AND NOT annule ORDER BY id`,
    [eleveId, an[0].id]
  );

  const mois = moisDeLAnnee(an[0].date_debut, an[0].date_fin);
  return {
    annee: an[0],
    mois,
    frais: frais.map((f) => {
      // « D octobre a juin » : chaque frais s arrete a son dernier mois du
      const listeMois = moisDuFrais(mois, f.mois_fin);
      return {
        ...f,
        paye: Number(f.paye),
        montant: Number(f.montant),
        listeMois,
        mois: etatDesMois(listeMois, f.montant, versements.filter((v) => v.frais_id === f.id)),
      };
    }),
  };
}

/**
 * Enregistre un paiement confirme : une ecriture par mois couvert, chacune
 * avec son numero de recu. Idempotent — Wave peut renvoyer le meme webhook,
 * deux comptables peuvent cliquer en meme temps.
 *
 * `montantRecu` est l argent reellement encaisse (annonce par Wave, ou
 * constate par la caisse) : c est lui qui est impute, meme s il differe du
 * montant attendu — l ecart est alors signale.
 */
export async function confirmerPaiement(id, {
  transactionId = null, montantRecu = null, verifiePar = null, forcer = true,
} = {}) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM paiement_en_ligne WHERE id = $1 FOR UPDATE`, [id]
    );
    const pel = rows[0];
    if (!pel) return null;
    if (pel.statut === 'reussi') return { pel, deja: true };
    // Meme verrou que le guichet : pas d encaissement simultane pour l eleve
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('epsin_paiement'), $1)`, [pel.eleve_id]);

    const versement = montantRecu != null ? Number(montantRecu) : Number(pel.montant);
    const ecart = Math.round(versement) !== Math.round(Number(pel.montant))
      ? `Montant recu (${versement}) different du montant attendu (${Number(pel.montant)})`
      : null;
    const transactionFinale = transactionId || pel.transaction_id;

    const { frais } = await mensualitesDe(pel.eleve_id, pel.annee_id, client);
    const f = frais.find((x) => x.id === pel.frais_id);
    // Le frais a pu etre retire entre-temps : l argent est quand meme recu,
    // on l impute sans mois plutot que de le perdre.
    const lignes = f
      ? ventilerVersement(f.mois, versement)
      : [{ mois: null, montant: versement }];

    // Des mois ont ete regles entre-temps (au guichet, par exemple) : une
    // partie de l argent ne couvre plus aucun mois. La caisse decide —
    // rejeter et rembourser, ou garder l excedent en avance. Le paiement
    // confirme par Wave lui-meme (mode api) est toujours enregistre : l argent
    // est deja sur le compte de l ecole.
    const excedent = f ? lignes.filter((l) => !l.mois).reduce((t, l) => t + l.montant, 0) : 0;
    if (excedent > 0 && !forcer) {
      throw Object.assign(new Error(
        `Les mois de ${f.libelle} ont été réglés entre-temps : ${Math.round(excedent).toLocaleString('fr-FR')} F `
        + 'de ce paiement ne couvriraient aucun mois. Rejetez-le (et remboursez le parent), '
        + "ou validez quand même : l'excédent sera enregistré comme avance."
      ), { status: 409, code: 'TROP_PERCU', excedent });
    }

    const recus = [];
    for (const l of lignes) {
      const numero = await prochainNumeroRecu(client);
      await client.query(
        `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, reference,
                               numero_recu, mois_couvert, encaisse_par, paiement_en_ligne_id, categorie)
         VALUES ($1,$2,$3,$4,'wave',$5,$6,$7,$8,$9,
                 CASE WHEN (SELECT cas_social FROM eleve WHERE id = $1) THEN 'autres_recettes' ELSE 'scolarite' END)`,
        [pel.eleve_id, pel.frais_id, pel.annee_id, l.montant, transactionFinale,
         numero, l.mois, verifiePar, pel.id]
      );
      recus.push(numero);
    }

    const { rows: maj } = await client.query(
      `UPDATE paiement_en_ligne
       SET statut = 'reussi', transaction_id = $2, confirme_le = now(), erreur = $3,
           verifie_par = COALESCE($4, verifie_par),
           verifie_le = CASE WHEN $4::int IS NULL THEN verifie_le ELSE now() END
       WHERE id = $1 RETURNING *`,
      [pel.id, transactionFinale, ecart, verifiePar]
    );

    const moisCouverts = lignes.map((l) => l.mois).filter(Boolean);
    await client.query(
      `INSERT INTO journal_audit (utilisateur_id, action, entite, entite_id, details)
       VALUES ($1,'paiement_wave','paiement_en_ligne',$2,$3)`,
      [verifiePar ?? pel.initie_par, pel.id,
       { montant: versement, transaction: transactionFinale, recus, mois: moisCouverts }]
    );
    if (pel.initie_par) {
      await client.query(
        `INSERT INTO notification (utilisateur_id, type, titre, contenu, lien)
         VALUES ($1,'paiement','Paiement Wave enregistre',$2,'/mon-enfant')`,
        [pel.initie_par,
         `Votre paiement de ${Math.round(versement)} FCFA a ete enregistre`
           + (moisCouverts.length ? ` (${moisCouverts.join(', ')})` : '')
           + `. Recu(s) : ${recus.join(', ')}`]
      );
    }
    return { pel: maj[0], deja: false };
  });
}

/**
 * Clot une tentative sans creer d ecriture. Ne touche jamais une tentative
 * reussie : seuls les statuts listes dans `depuis` sont modifiables.
 */
async function cloreSansPaiement(id, statut, erreur = null, depuis = ['en_attente'], verifiePar = null) {
  const { rows } = await query(
    `UPDATE paiement_en_ligne
     SET statut = $2, erreur = COALESCE($3, erreur),
         verifie_par = COALESCE($5, verifie_par),
         verifie_le = CASE WHEN $5::int IS NULL THEN verifie_le ELSE now() END
     WHERE id = $1 AND statut = ANY($4) RETURNING *`,
    [id, statut, erreur, depuis, verifiePar]
  );
  return rows[0] || null;
}

/**
 * Mode api : si une tentative est encore en attente, demande son etat a
 * Wave. Couvre le cas ou le webhook tarde — ou ne parvient pas, par exemple
 * quand le service gratuit de Render est en veille.
 */
async function synchroniser(pel) {
  if (pel.mode !== 'api' || pel.statut !== 'en_attente' || !pel.session_id || !waveConfigure()) return;
  try {
    const session = await lireSession(pel.session_id);
    if (session?.payment_status === 'succeeded') {
      await confirmerPaiement(pel.id, {
        transactionId: session.transaction_id, montantRecu: session.amount,
      });
    } else if (session?.checkout_status === 'expired') {
      await cloreSansPaiement(pel.id, 'expire');
    }
  } catch (err) {
    // Wave injoignable : on renvoie l etat connu, le webhook prendra le relais
    console.error('[wave] synchronisation impossible', err.message);
  }
}

/** Charge une tentative avec les recus qu elle a produits. */
async function chargerTentative(id) {
  const { rows } = await query(
    `SELECT pel.*, f.libelle AS frais, e.prenom, e.nom, e.matricule,
            c.libelle AS classe,
            v.prenom AS verificateur_prenom, v.nom AS verificateur_nom,
            COALESCE((SELECT json_agg(json_build_object(
                        'id', p.id, 'numero_recu', p.numero_recu, 'mois', p.mois_couvert,
                        'montant', p.montant) ORDER BY p.id)
                      FROM paiement p WHERE p.paiement_en_ligne_id = pel.id), '[]') AS recus
     FROM paiement_en_ligne pel
     JOIN frais f ON f.id = pel.frais_id
     JOIN eleve e ON e.id = pel.eleve_id
     LEFT JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = pel.annee_id
     LEFT JOIN classe c ON c.id = i.classe_id
     LEFT JOIN utilisateur v ON v.id = pel.verifie_par
     WHERE pel.id = $1`,
    [id]
  );
  return rows[0] || null;
}

/** Tentative du tuteur connecte, ou null (404 : ne rien reveler des autres). */
async function tentativeDuTuteur(req) {
  const pel = await chargerTentative(Number(req.params.id));
  if (!pel || pel.eleve_id !== eleveSuivi(req.user)) return null;
  return pel;
}

// ---------- Mensualites a regler (tuteur) ----------
router.get('/mensualites', autoriser('parent'), async (req, res, next) => {
  try {
    const eleveId = eleveSuivi(req.user);
    if (!eleveId) return res.status(403).json({ erreur: 'Aucun enfant rattache a ce compte' });
    const { annee, mois, frais, cas_social: casSocial } = await mensualitesDe(eleveId);

    // Sommes declarees mais pas encore verifiees par la caisse : le tuteur
    // doit les voir, pour ne pas payer deux fois le meme mois.
    const { rows: enCours } = await query(
      `SELECT frais_id, SUM(montant)::numeric AS montant
       FROM paiement_en_ligne
       WHERE eleve_id = $1 AND statut = 'a_verifier' GROUP BY frais_id`,
      [eleveId]
    );
    const mode = modePaiement();
    res.json({
      // `terminee` : le mois en cours est posterieur a la fin de l annee
      // active — la rentree suivante n est pas encore ouverte.
      annee: annee
        ? { id: annee.id, libelle: annee.libelle, terminee: mois.length > 0 && moisCourant() > mois.at(-1) }
        : null,
      frais: frais.map((f) => {
        const enVerification = Number(enCours.find((x) => x.frais_id === f.id)?.montant || 0);
        return { ...f, en_verification: enVerification, mois: deduireEnCours(f.mois, enVerification) };
      }),
      wave: { disponible: mode != null, mode },
      cas_social: Boolean(casSocial),
    });
  } catch (err) { next(err); }
});

// ---------- Ouverture d un paiement Wave (tuteur) ----------
router.post('/wave', autoriser('parent'), async (req, res, next) => {
  try {
    const eleveId = eleveSuivi(req.user);
    if (!eleveId) return res.status(403).json({ erreur: 'Aucun enfant rattache a ce compte' });
    const mode = modePaiement();
    if (!mode) {
      return res.status(503).json({ erreur: 'Le paiement Wave n est pas encore active par l etablissement' });
    }

    const fraisId = Number(req.body.frais_id);
    const { annee, frais } = await mensualitesDe(eleveId);
    const trouve = frais.find((x) => x.id === fraisId);
    if (!trouve) return res.status(404).json({ erreur: 'Mensualite introuvable pour cet eleve' });
    // Une declaration encore en verification couvre deja ses mois : le
    // parent ne doit pas pouvoir les payer une seconde fois
    const { rows: [enCours] } = await query(
      `SELECT COALESCE(SUM(montant), 0)::numeric AS n FROM paiement_en_ligne
       WHERE eleve_id = $1 AND frais_id = $2 AND statut = 'a_verifier'`,
      [eleveId, fraisId]
    );
    const f = { ...trouve, mois: deduireEnCours(trouve.mois, Number(enCours.n)) };
    if (resteAnnee(f.mois) <= 0) {
      return res.status(409).json({
        erreur: Number(enCours.n) > 0
          ? 'Tous les mois restants sont couverts par un paiement en cours de verification par l etablissement'
          : 'Tous les mois de l annee sont deja regles',
      });
    }

    // Deux facons de payer : un nombre de mois complets, ou un montant libre
    // (avance sur un mois, quand le parent ne peut pas tout regler d un coup).
    // Le montant libre est impute comme un versement au guichet : il solde
    // les mois dans l ordre, le dernier pouvant rester partiel.
    let montant;
    let nbMois;
    const montantLibre = req.body.montant != null && req.body.montant !== ''
      ? Number(req.body.montant) : null;
    if (montantLibre != null) {
      const reste = resteAnnee(f.mois);
      if (!Number.isInteger(montantLibre) || montantLibre < 1) {
        return res.status(400).json({ erreur: 'Montant invalide : un nombre entier de FCFA' });
      }
      if (montantLibre > reste) {
        return res.status(400).json({
          erreur: `Le montant depasse le reste a payer de l annee (${reste} FCFA)`,
        });
      }
      montant = montantLibre;
      nbMois = ventilerVersement(f.mois, montant).filter((l) => l.mois).length;
    } else {
      nbMois = Number(req.body.nb_mois);
      if (!Number.isInteger(nbMois) || nbMois < 1 || nbMois > MAX_MOIS) {
        return res.status(400).json({ erreur: `Nombre de mois invalide (1 a ${MAX_MOIS})` });
      }
      montant = montantPourMois(f.mois, nbMois);
      if (montant == null) {
        return res.status(400).json({ erreur: 'Il ne reste pas autant de mois a regler' });
      }
    }

    const base = urlInterface();
    if (mode === 'api' && !base) {
      return res.status(500).json({ erreur: 'APP_URL non configuree sur le serveur' });
    }

    const { rows } = await query(
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant, initie_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [mode, eleveId, f.id, annee.id, nbMois, montant, req.user.id]
    );
    const pel = rows[0];

    if (mode !== 'api') {
      // Lien marchand : le tuteur paie sur Wave puis declare sa transaction.
      // Simulation : rien a ouvrir, la confirmation est simulee.
      const url = mode === 'lien' ? lienAvecMontant(montant) : null;
      if (url) await query(`UPDATE paiement_en_ligne SET url_paiement = $2 WHERE id = $1`, [pel.id, url]);
      await tracer(req, 'ouverture_paiement_wave', 'paiement_en_ligne', pel.id, { montant, mode });
      return res.status(201).json({ id: pel.id, montant, mode, url });
    }

    try {
      const retour = `${base}/mon-enfant?paiement=${pel.id}`;
      const session = await creerSession({
        montant,
        reference: `epsin-${pel.id}`,
        urlSucces: `${retour}&wave=succes`,
        urlErreur: `${retour}&wave=erreur`,
      });
      await query(
        `UPDATE paiement_en_ligne SET session_id = $2, url_paiement = $3, expire_le = $4
         WHERE id = $1`,
        [pel.id, session.id, session.wave_launch_url, session.when_expires || null]
      );
      await tracer(req, 'ouverture_paiement_wave', 'paiement_en_ligne', pel.id, { montant, mode });
      res.status(201).json({ id: pel.id, montant, mode, url: session.wave_launch_url });
    } catch (err) {
      await cloreSansPaiement(pel.id, 'echoue', err.message);
      throw err;
    }
  } catch (err) { next(err); }
});

// ---------- Declaration du paiement par le tuteur (mode lien) ----------
router.post('/:id/declarer', autoriser('parent'), async (req, res, next) => {
  try {
    const pel = await tentativeDuTuteur(req);
    if (!pel) return res.status(404).json({ erreur: 'Paiement introuvable' });
    if (pel.mode !== 'lien') {
      return res.status(400).json({ erreur: 'Ce paiement est confirme automatiquement par Wave' });
    }
    if (pel.statut !== 'en_attente') {
      return res.status(400).json({ erreur: 'Ce paiement a deja ete declare' });
    }

    // La reference Wave est FACULTATIVE : la recopier est l etape qui fait
    // abandonner les parents. La caisse retrouve le paiement dans Wave
    // Business par le montant, l heure et le numero ; si la reference est
    // fournie, elle accelere ce rapprochement et interdit tout doublon.
    const transactionId = String(req.body.transaction_id || '').trim() || null;
    const telephone = String(req.body.telephone || '').trim() || null;
    if (transactionId && !FORMAT_TRANSACTION.test(transactionId)) {
      return res.status(400).json({
        erreur: 'Reference Wave invalide : recopiez-la depuis le recu, ou laissez le champ vide',
      });
    }

    let maj;
    try {
      ({ rows: [maj] } = await query(
        `UPDATE paiement_en_ligne
         SET statut = 'a_verifier', transaction_id = $2, telephone_payeur = $3, declare_le = now()
         WHERE id = $1 AND statut = 'en_attente' RETURNING *`,
        [pel.id, transactionId, telephone]
      ));
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ erreur: 'Cette transaction Wave a deja ete declaree' });
      }
      throw err;
    }
    if (!maj) return res.status(400).json({ erreur: 'Ce paiement a deja ete declare' });

    // Previent la caisse qu un paiement attend sa verification
    await query(
      `INSERT INTO notification (utilisateur_id, type, titre, contenu, lien)
       SELECT id, 'paiement', 'Paiement Wave a verifier', $1, '/finances'
       FROM utilisateur WHERE actif AND role IN ('comptable', 'admin')`,
      [`${pel.prenom} ${pel.nom} (${pel.matricule}) : ${Math.round(Number(pel.montant))} FCFA`
        + (transactionId ? `, transaction ${transactionId}` : '')
        + (telephone ? `, depuis le ${telephone}` : '')]
    );
    await tracer(req, 'declaration_paiement_wave', 'paiement_en_ligne', pel.id, { transaction: transactionId });
    res.json(await chargerTentative(pel.id));
  } catch (err) { next(err); }
});

// ---------- Verification par la caisse (mode lien) ----------
router.post('/:id/valider', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const pel = await chargerTentative(Number(req.params.id));
    if (!pel) return res.status(404).json({ erreur: 'Paiement introuvable' });
    if (pel.statut === 'reussi') return res.status(400).json({ erreur: 'Paiement deja valide' });
    if (!['a_verifier', 'en_attente'].includes(pel.statut)) {
      return res.status(400).json({ erreur: 'Ce paiement a ete clos, il ne peut plus etre valide' });
    }

    // La caisse peut corriger le montant si Wave montre une autre somme
    const montantRecu = req.body.montant_recu != null ? Number(req.body.montant_recu) : null;
    if (montantRecu != null && !(montantRecu > 0)) {
      return res.status(400).json({ erreur: 'Montant recu invalide' });
    }
    // Facultatif : la caisse confirme avoir vu le paiement dans Wave Business
    const transactionId = req.body.transaction_id ? String(req.body.transaction_id).trim() : null;
    if (transactionId && !FORMAT_TRANSACTION.test(transactionId)) {
      return res.status(400).json({ erreur: 'Identifiant de transaction invalide' });
    }

    try {
      await confirmerPaiement(pel.id, {
        transactionId, montantRecu, verifiePar: req.user.id, forcer: req.body.forcer === true,
      });
    } catch (err) {
      if (err.code === 'TROP_PERCU') {
        return res.status(409).json({ erreur: err.message, code: err.code, excedent: err.excedent });
      }
      if (err.code === '23505') {
        return res.status(409).json({ erreur: 'Cette transaction Wave a deja servi a un autre paiement' });
      }
      throw err;
    }
    res.json(await chargerTentative(pel.id));
  } catch (err) { next(err); }
});

router.post('/:id/rejeter', autoriser(...CAISSE), async (req, res, next) => {
  try {
    const motif = String(req.body.motif || '').trim();
    if (!motif) return res.status(400).json({ erreur: 'Motif du rejet requis' });

    const maj = await cloreSansPaiement(
      Number(req.params.id), 'rejete', motif, ['a_verifier', 'en_attente'], req.user.id
    );
    if (!maj) return res.status(400).json({ erreur: 'Paiement introuvable ou deja clos' });

    if (maj.initie_par) {
      await query(
        `INSERT INTO notification (utilisateur_id, type, titre, contenu, lien)
         VALUES ($1,'paiement','Paiement Wave non retrouve',$2,'/mon-enfant')`,
        [maj.initie_par, `Votre declaration de ${Math.round(Number(maj.montant))} FCFA `
          + `n a pas pu etre validee : ${motif}`]
      );
    }
    await tracer(req, 'rejet_paiement_wave', 'paiement_en_ligne', maj.id, { motif });
    res.json(await chargerTentative(maj.id));
  } catch (err) { next(err); }
});

// ---------- Historique ----------
router.get('/', autoriser('parent', ...CAISSE), async (req, res, next) => {
  try {
    const suivi = eleveSuivi(req.user);
    if (estTuteur(req.user) && !suivi) return res.json([]);
    const statut = req.query.statut || null;
    const { rows } = await query(
      `SELECT pel.id, pel.mode, pel.montant, pel.nb_mois, pel.statut, pel.transaction_id,
              pel.telephone_payeur, pel.url_paiement, pel.erreur,
              pel.cree_le, pel.declare_le, pel.confirme_le,
              -- Premiere ecriture du paiement : ouvre son recu imprimable
              (SELECT MIN(p.id) FROM paiement p WHERE p.paiement_en_ligne_id = pel.id) AS paiement_id,
              f.libelle AS frais, e.matricule, e.prenom, e.nom, c.libelle AS classe
       FROM paiement_en_ligne pel
       JOIN frais f ON f.id = pel.frais_id
       JOIN eleve e ON e.id = pel.eleve_id
       LEFT JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = pel.annee_id
       LEFT JOIN classe c ON c.id = i.classe_id
       WHERE ($1::int IS NULL OR pel.eleve_id = $1)
         AND ($2::text IS NULL OR pel.statut = $2)
       ORDER BY COALESCE(pel.declare_le, pel.cree_le) DESC
       LIMIT $3`,
      [suivi, statut, suivi ? 20 : 200]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- Etat d une tentative ----------
router.get('/:id', autoriser('parent', ...CAISSE), async (req, res, next) => {
  try {
    let pel = estTuteur(req.user)
      ? await tentativeDuTuteur(req)
      : await chargerTentative(Number(req.params.id));
    if (!pel) return res.status(404).json({ erreur: 'Paiement introuvable' });
    if (pel.statut === 'en_attente' && pel.mode === 'api') {
      await synchroniser(pel);
      pel = await chargerTentative(pel.id);
    }
    res.json(pel);
  } catch (err) { next(err); }
});

// ---------- Simulation (developpement uniquement) ----------
router.post('/:id/simuler', autoriser('parent'), async (req, res, next) => {
  try {
    if (modePaiement() !== 'simulation') return res.status(404).json({ erreur: 'Route introuvable' });
    const pel = await tentativeDuTuteur(req);
    if (!pel || pel.mode !== 'simulation') return res.status(404).json({ erreur: 'Paiement introuvable' });
    if (req.body.succes === false) {
      await cloreSansPaiement(pel.id, 'echoue', 'Paiement annule (simulation)');
    } else {
      await confirmerPaiement(pel.id, { transactionId: `SIM-${pel.id}` });
    }
    res.json(await chargerTentative(pel.id));
  } catch (err) { next(err); }
});

export default router;

/**
 * Webhook Wave (mode api). Monte HORS du routeur authentifie, et AVANT
 * express.json() : la signature porte sur le corps brut, octet pour octet.
 *
 * Repond 200 des que l evenement est traite (ou ignore) ; une erreur 500
 * pousse Wave a renvoyer l evenement plus tard, ce qui est voulu.
 */
export async function webhookWave(req, res) {
  if (!process.env.WAVE_WEBHOOK_SECRET) {
    return res.status(503).json({ erreur: 'Webhook Wave non configure' });
  }
  if (!Buffer.isBuffer(req.body) || !signatureValide(req.get('Wave-Signature'), req.body)) {
    return res.status(401).json({ erreur: 'Signature invalide' });
  }

  let evenement;
  try {
    evenement = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ erreur: 'Corps illisible' });
  }

  try {
    const session = evenement?.data || {};
    const { rows } = await query(
      `SELECT id FROM paiement_en_ligne
       WHERE mode = 'api' AND (session_id = $1 OR ('epsin-' || id) = $2) LIMIT 1`,
      [session.id || null, session.client_reference || null]
    );
    if (!rows[0]) {
      console.warn('[wave] evenement pour une session inconnue', session.id);
      return res.json({ recu: true });
    }

    if (evenement.type === 'checkout.session.completed' && session.payment_status === 'succeeded') {
      await confirmerPaiement(rows[0].id, {
        transactionId: session.transaction_id, montantRecu: session.amount,
      });
    } else if (evenement.type === 'checkout.session.payment_failed') {
      await cloreSansPaiement(rows[0].id, 'echoue', session.last_payment_error?.message || null);
    }
    res.json({ recu: true });
  } catch (err) {
    console.error('[wave] echec du traitement du webhook', err.message);
    res.status(500).json({ erreur: 'Traitement impossible, a renvoyer' });
  }
}
