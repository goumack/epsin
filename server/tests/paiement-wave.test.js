import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { api, COMPTES, contexte, compteTuteur } from './aides.js';
import { query } from '../src/db/pool.js';
import {
  moisDeLAnnee, etatDesMois, montantPourMois, repartirVersement,
} from '../src/metier/mensualites.js';
import { signatureValide, signer, lienAvecMontant } from '../src/services/wave.js';

/**
 * PAIEMENT DES MENSUALITES PAR WAVE.
 *
 * Trois modes, choisis par la configuration du serveur :
 *   lien        le tuteur paie sur le lien marchand et declare sa
 *               transaction ; la caisse valide ou rejette
 *   api         Wave confirme seul, par un webhook signe
 *   simulation  developpement, sans compte Wave
 *
 * Chaque test fixe le mode qu il exerce, puis restaure l environnement.
 */

const LIEN = 'https://pay.wave.com/m/M_sn_wF5yaWQxUVkW/c/sn/';
const ENV_WAVE = ['WAVE_API_KEY', 'WAVE_LIEN_PAIEMENT', 'WAVE_WEBHOOK_SECRET'];
const envInitial = Object.fromEntries(ENV_WAVE.map((k) => [k, process.env[k]]));

function mode(nom) {
  for (const k of ENV_WAVE) delete process.env[k];
  if (nom === 'lien') process.env.WAVE_LIEN_PAIEMENT = LIEN;
}

let ctx;
let debut;
let tuteur;
let autreTuteur;
const tentatives = [];

beforeAll(async () => {
  debut = new Date();
  ctx = await contexte();
  tuteur = compteTuteur(ctx.eleveCI.matricule);
  autreTuteur = compteTuteur(ctx.eleve6eme.matricule);
});

afterEach(() => {
  for (const k of ENV_WAVE) {
    if (envInitial[k] === undefined) delete process.env[k];
    else process.env[k] = envInitial[k];
  }
});

afterAll(async () => {
  if (tentatives.length) {
    await query(`DELETE FROM paiement WHERE paiement_en_ligne_id = ANY($1)`, [tentatives]);
    await query(`DELETE FROM paiement_en_ligne WHERE id = ANY($1)`, [tentatives]);
  }
  await query(`DELETE FROM notification WHERE type = 'paiement' AND cree_le >= $1`, [debut]);
});

/** Ouvre une tentative pour le tuteur de l eleve de CI et la memorise. */
async function ouvrir(nbMois = 1, compte = tuteur) {
  const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', compte);
  const frais = m.frais[0];
  const r = await api('POST', '/api/paiements-en-ligne/wave', compte, {
    frais_id: frais.id, nb_mois: nbMois,
  });
  if (r.body?.id) tentatives.push(r.body.id);
  return { r, frais };
}

// ------------------------------------------------------------------
describe('Unitaire : regles des mensualites', () => {
  const mois = moisDeLAnnee(new Date(2025, 9, 1), new Date(2026, 6, 15));

  it('liste les dix mois d octobre a juillet', () => {
    expect(mois).toHaveLength(10);
    expect(mois[0]).toBe('2025-10');
    expect(mois[9]).toBe('2026-07');
  });

  it('impute les versements dans l ordre et distingue echu / a venir', () => {
    const etat = etatDesMois(mois, 15000, 37500, new Date(2026, 0, 10));
    expect(etat.slice(0, 5).map((e) => e.statut))
      .toEqual(['paye', 'paye', 'partiel', 'en_retard', 'a_venir']);
    expect(etat[2].reste_du).toBe(7500);
  });

  it('calcule le montant de n mois en soldant d abord le mois partiel', () => {
    const etat = etatDesMois(mois, 15000, 37500);
    expect(montantPourMois(etat, 2)).toBe(22500);       // 7 500 + 15 000
    expect(montantPourMois(etat, 8)).toBe(112500);      // tout le reste de l annee
    expect(montantPourMois(etat, 9)).toBeNull();        // il ne reste que 8 mois
    expect(montantPourMois(etat, 0)).toBeNull();
  });

  it('repartit un versement mois par mois, l excedent en avance', () => {
    expect(repartirVersement(mois, 15000, 37500, 22500)).toEqual([
      { mois: '2025-12', montant: 7500 },
      { mois: '2026-01', montant: 15000 },
    ]);
    expect(repartirVersement(mois, 15000, 150000, 20000)).toEqual([
      { mois: null, montant: 20000 },
    ]);
  });

  it('pre-remplit le montant sur le lien marchand', () => {
    process.env.WAVE_LIEN_PAIEMENT = LIEN;
    expect(lienAvecMontant(22500)).toBe(`${LIEN}?amount=22500`);
  });
});

describe('Unitaire : signature des webhooks Wave', () => {
  const corps = '{"type":"checkout.session.completed"}';

  it('accepte une signature correcte', () => {
    expect(signatureValide(signer(corps, 'secret'), Buffer.from(corps), 'secret')).toBe(true);
  });

  it('refuse un corps modifie, un autre secret, un message ancien', () => {
    const entete = signer(corps, 'secret');
    expect(signatureValide(entete, Buffer.from(`${corps} `), 'secret')).toBe(false);
    expect(signatureValide(entete, Buffer.from(corps), 'autre')).toBe(false);
    expect(signatureValide(signer(corps, 'secret', 1000), Buffer.from(corps), 'secret')).toBe(false);
    expect(signatureValide(null, Buffer.from(corps), 'secret')).toBe(false);
  });
});

// ------------------------------------------------------------------
describe('Mode lien marchand : declaration puis verification par la caisse', () => {
  it('le tuteur voit les mensualites de son enfant, mois par mois', async () => {
    mode('lien');
    const r = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    expect(r.status).toBe(200);
    expect(r.body.wave).toEqual({ disponible: true, mode: 'lien' });
    expect(r.body.frais.length).toBeGreaterThan(0);
    expect(r.body.frais[0].mois.length).toBeGreaterThan(0);
  });

  it('le montant est calcule par le serveur et le lien porte ce montant', async () => {
    mode('lien');
    const { r, frais } = await ouvrir(2);
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('lien');
    expect(r.body.montant).toBe(montantPourMois(frais.mois, 2));
    expect(r.body.url).toBe(`${LIEN}?amount=${Math.round(r.body.montant)}`);
  });

  it('refuse plus de mois qu il n en reste, et un frais etranger', async () => {
    mode('lien');
    const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    const r = await api('POST', '/api/paiements-en-ligne/wave', tuteur, {
      frais_id: m.frais[0].id, nb_mois: 13,
    });
    expect(r.status).toBe(400);
    const r2 = await api('POST', '/api/paiements-en-ligne/wave', tuteur, {
      frais_id: 999999, nb_mois: 1,
    });
    expect(r2.status).toBe(404);
  });

  it('seul un tuteur ouvre un paiement en ligne', async () => {
    mode('lien');
    const r = await api('POST', '/api/paiements-en-ligne/wave', COMPTES.comptable, {
      frais_id: 1, nb_mois: 1,
    });
    expect(r.status).toBe(403);
  });

  it('declare, puis la caisse valide : recus crees, mois couverts', async () => {
    mode('lien');
    const { r } = await ouvrir(1);
    const id = r.body.id;

    // Un autre tuteur ne peut ni voir ni declarer ce paiement
    expect((await api('GET', `/api/paiements-en-ligne/${id}`, autreTuteur)).status).toBe(404);
    expect((await api('POST', `/api/paiements-en-ligne/${id}/declarer`, autreTuteur, {
      transaction_id: 'T_AUTRE1234',
    })).status).toBe(404);

    // Identifiant fantaisiste refuse
    expect((await api('POST', `/api/paiements-en-ligne/${id}/declarer`, tuteur, {
      transaction_id: 'x',
    })).status).toBe(400);

    const transaction = `T_TEST${Date.now()}`;
    const d = await api('POST', `/api/paiements-en-ligne/${id}/declarer`, tuteur, {
      transaction_id: transaction, telephone: '771234567',
    });
    expect(d.status).toBe(200);
    expect(d.body.statut).toBe('a_verifier');

    // Une seule declaration par tentative
    expect((await api('POST', `/api/paiements-en-ligne/${id}/declarer`, tuteur, {
      transaction_id: `${transaction}B`,
    })).status).toBe(400);

    // La caisse le voit dans sa file
    const file = await api('GET', '/api/paiements-en-ligne?statut=a_verifier', COMPTES.comptable);
    expect(file.body.some((p) => p.id === id)).toBe(true);

    // Le tuteur ne valide pas lui-meme
    expect((await api('POST', `/api/paiements-en-ligne/${id}/valider`, tuteur, {})).status).toBe(403);

    const v = await api('POST', `/api/paiements-en-ligne/${id}/valider`, COMPTES.comptable, {});
    expect(v.status).toBe(200);
    expect(v.body.statut).toBe('reussi');
    expect(v.body.recus.length).toBeGreaterThan(0);
    for (const recu of v.body.recus) expect(recu.numero_recu).toMatch(/^REC-\d{4}-\d{5}$/);

    const { rows } = await query(
      `SELECT mode, reference, encaisse_par FROM paiement WHERE paiement_en_ligne_id = $1`, [id]
    );
    expect(rows.every((p) => p.mode === 'wave' && p.reference === transaction)).toBe(true);

    // Une seconde validation ne cree rien de plus
    const v2 = await api('POST', `/api/paiements-en-ligne/${id}/valider`, COMPTES.comptable, {});
    expect(v2.status).toBe(400);
    const { rows: apres } = await query(
      `SELECT COUNT(*)::int AS n FROM paiement WHERE paiement_en_ligne_id = $1`, [id]
    );
    expect(apres[0].n).toBe(rows.length);
  });

  it('parcours simplifie : « j ai paye » sans reference, confirmation en un clic', async () => {
    mode('lien');
    const { r } = await ouvrir(1);
    const d = await api('POST', `/api/paiements-en-ligne/${r.body.id}/declarer`, tuteur, {});
    expect(d.status).toBe(200);
    expect(d.body.statut).toBe('a_verifier');
    expect(d.body.transaction_id).toBeNull();

    const v = await api('POST', `/api/paiements-en-ligne/${r.body.id}/valider`, COMPTES.comptable, {});
    expect(v.status).toBe(200);
    expect(v.body.statut).toBe('reussi');
    expect(v.body.recus.length).toBeGreaterThan(0);
  });

  it('une meme transaction Wave ne solde pas deux paiements', async () => {
    mode('lien');
    const transaction = `T_DOUBLE${Date.now()}`;
    const { r: r1 } = await ouvrir(1);
    const { r: r2 } = await ouvrir(1);
    await api('POST', `/api/paiements-en-ligne/${r1.body.id}/declarer`, tuteur, { transaction_id: transaction });
    const d2 = await api('POST', `/api/paiements-en-ligne/${r2.body.id}/declarer`, tuteur, {
      transaction_id: transaction.toLowerCase(),
    });
    expect(d2.status).toBe(409);
  });

  it('la caisse rejette avec un motif, sans creer d ecriture', async () => {
    mode('lien');
    const { r } = await ouvrir(1);
    await api('POST', `/api/paiements-en-ligne/${r.body.id}/declarer`, tuteur, {
      transaction_id: `T_REJET${Date.now()}`,
    });
    expect((await api('POST', `/api/paiements-en-ligne/${r.body.id}/rejeter`, COMPTES.comptable, {}))
      .status).toBe(400);
    const rj = await api('POST', `/api/paiements-en-ligne/${r.body.id}/rejeter`, COMPTES.comptable, {
      motif: 'Transaction introuvable',
    });
    expect(rj.status).toBe(200);
    expect(rj.body.statut).toBe('rejete');
    expect(rj.body.recus).toEqual([]);
  });
});

// ------------------------------------------------------------------
describe('Mode API : webhook signe', () => {
  const SECRET = 'secret-de-test';

  /** Cree une tentative « api » sans appeler Wave. */
  async function tentativeApi() {
    const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    const f = m.frais[0];
    const montant = montantPourMois(f.mois, 1);
    const { rows } = await query(
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant,
                                      session_id, initie_par)
       VALUES ('api',$1,$2,$3,1,$4,$5,
               (SELECT id FROM utilisateur WHERE email = $6)) RETURNING id, session_id, montant`,
      [ctx.eleveCI.id, f.id, ctx.anneeId, montant, `cos-test-${Date.now()}`, tuteur]
    );
    tentatives.push(rows[0].id);
    return rows[0];
  }

  const evenement = (session, montant, transaction) => JSON.stringify({
    id: 'EV_test',
    type: 'checkout.session.completed',
    data: {
      id: session, amount: String(Math.round(montant)), currency: 'XOF',
      payment_status: 'succeeded', checkout_status: 'complete',
      transaction_id: transaction,
    },
  });

  const envoyer = (corps, entete) => request(app)
    .post('/api/paiements-en-ligne/wave/webhook')
    .set('Content-Type', 'application/json')
    .set('Wave-Signature', entete)
    .send(corps);

  it('refuse un webhook mal signe', async () => {
    process.env.WAVE_WEBHOOK_SECRET = SECRET;
    const t = await tentativeApi();
    const corps = evenement(t.session_id, t.montant, 'TX_FAUX');
    const r = await envoyer(corps, signer(corps, 'pas-le-bon'));
    expect(r.status).toBe(401);
    const { rows } = await query(`SELECT statut FROM paiement_en_ligne WHERE id = $1`, [t.id]);
    expect(rows[0].statut).toBe('en_attente');
  });

  it('confirme sur un webhook signe, une seule fois meme s il est rejoue', async () => {
    process.env.WAVE_WEBHOOK_SECRET = SECRET;
    const t = await tentativeApi();
    const corps = evenement(t.session_id, t.montant, `TX_${Date.now()}`);

    const r = await envoyer(corps, signer(corps, SECRET));
    expect(r.status).toBe(200);
    const r2 = await envoyer(corps, signer(corps, SECRET));
    expect(r2.status).toBe(200);

    const { rows } = await query(`SELECT statut FROM paiement_en_ligne WHERE id = $1`, [t.id]);
    expect(rows[0].statut).toBe('reussi');
    const { rows: ecritures } = await query(
      `SELECT SUM(montant)::numeric AS total FROM paiement WHERE paiement_en_ligne_id = $1`, [t.id]
    );
    expect(Number(ecritures[0].total)).toBe(Number(t.montant));
  });
});

// ------------------------------------------------------------------
describe('Mode simulation : developpement sans compte Wave', () => {
  it('simule un paiement reussi', async () => {
    mode('simulation');
    const { r } = await ouvrir(1);
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('simulation');
    const s = await api('POST', `/api/paiements-en-ligne/${r.body.id}/simuler`, tuteur, { succes: true });
    expect(s.body.statut).toBe('reussi');
  });

  it('accepte une avance : un montant libre laisse le mois partiel', async () => {
    mode('simulation');
    const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    const f = m.frais[0];
    const premier = f.mois.find((x) => x.statut !== 'paye');
    const resteAnnee = f.mois.reduce((s, x) => s + x.reste_du, 0);
    const avance = Math.floor(premier.reste_du / 2);
    if (avance < 1) return;   // mensualite trop faible pour une avance

    // Montants refuses : nul, fractionnaire, superieur au reste de l annee
    for (const montant of [0, 1.5, resteAnnee + 1]) {
      const r = await api('POST', '/api/paiements-en-ligne/wave', tuteur, { frais_id: f.id, montant });
      expect(r.status).toBe(400);
    }

    const r = await api('POST', '/api/paiements-en-ligne/wave', tuteur, { frais_id: f.id, montant: avance });
    expect(r.status).toBe(201);
    expect(r.body.montant).toBe(avance);
    tentatives.push(r.body.id);
    await api('POST', `/api/paiements-en-ligne/${r.body.id}/simuler`, tuteur, { succes: true });

    const { body: apres } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    const mois = apres.frais[0].mois.find((x) => x.mois === premier.mois);
    expect(mois.statut).toBe('partiel');
    expect(mois.reste_du).toBe(premier.reste_du - avance);
  });

  it('la simulation est fermee des qu un vrai mode est configure', async () => {
    mode('simulation');
    const { r } = await ouvrir(1);
    mode('lien');
    const s = await api('POST', `/api/paiements-en-ligne/${r.body.id}/simuler`, tuteur, { succes: true });
    expect(s.status).toBe(404);
  });
});

// ------------------------------------------------------------------
describe('Non-regression : un paiement d une annee passee ne regle pas l annee en cours', () => {
  it('la situation et les mensualites ignorent les versements des autres annees', async () => {
    const { rows: passee } = await query(
      `SELECT id FROM annee_scolaire WHERE NOT active ORDER BY date_debut DESC LIMIT 1`
    );
    if (!passee[0]) return;   // base sans historique : rien a verifier

    const avant = await api('GET', `/api/finances/situation/${ctx.eleveCI.id}`, COMPTES.comptable);
    const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
    const mensualite = m.frais[0];

    // Bug rencontre : l historique avait rattache les paiements de 2023-2024
    // au frais « Mensualite » de 2025-2026, qui s affichait alors regle.
    const { rows } = await query(
      `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, numero_recu)
       VALUES ($1,$2,$3,150000,$4) RETURNING id`,
      [ctx.eleveCI.id, mensualite.id, passee[0].id, `T-NR-${Date.now()}`]
    );
    try {
      const apres = await api('GET', `/api/finances/situation/${ctx.eleveCI.id}`, COMPTES.comptable);
      expect(apres.body.total_paye).toBe(avant.body.total_paye);
      const { body: m2 } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
      expect(m2.frais[0].paye).toBe(mensualite.paye);
    } finally {
      await query(`DELETE FROM paiement WHERE id = $1`, [rows[0].id]);
    }
  });
});
