import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import app from '../src/index.js';
import { api, contexte, compteTuteur } from './aides.js';
import { query } from '../src/db/pool.js';
import { construireEvenement, signerWavepay } from '../src/services/wavepay.js';

/**
 * PAIEMENT WAVE CONFIRME PAR WAVEPAY — tests d acceptation du guide
 * WavePay (section 8), sans argent ni appel reel : un faux serveur WavePay
 * local repond comme l API, et les webhooks sont signes avec un secret de
 * test. Donnees fictives uniquement.
 */

const SECRET = 'whsec_test_epsin';
const ENV = ['WAVEPAY_API_URL', 'WAVEPAY_SECRET_KEY', 'WAVEPAY_WEBHOOK_SECRET', 'WAVE_API_KEY', 'WAVE_LIEN_PAIEMENT'];
const envInitial = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let ctx;
let tuteur;
let faux;
const recues = [];   // requetes recues par le faux WavePay
const demandes = [];

beforeAll(async () => {
  ctx = await contexte();
  tuteur = compteTuteur(ctx.eleveCI.matricule);
  // Faux WavePay : POST /v1/payments renvoie un paiement, amount_due = montant + 3
  faux = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => { corps += c; });
    req.on('end', () => {
      const json = corps ? JSON.parse(corps) : null;
      recues.push({ chemin: req.url, entetes: req.headers, corps: json });
      if (req.method === 'POST' && req.url === '/v1/payments') {
        if (json.customer_phone === '770000000') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: 'invalid_phone', message: 'Numéro invalide', param: 'customer_phone' } }));
        }
        const id = `pay_TEST${json.reference}`;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          id, object: 'payment', status: 'pending', amount: json.amount, amount_due: json.amount + 3,
          reference: json.reference, metadata: json.metadata,
          pay_url: `https://pay.wave.com/m/M_sn_test/c/sn/?amount=${json.amount + 3}`,
          android_intent_url: 'intent://pay.wave.com/...',
          qr_code_url: `http://faux/v1/payments/${id}/qr.svg`, checkout_url: `http://faux/c/${id}`,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((ok) => faux.listen(0, ok));
  for (const k of ENV) delete process.env[k];
  process.env.WAVEPAY_API_URL = `http://127.0.0.1:${faux.address().port}`;
  process.env.WAVEPAY_SECRET_KEY = 'sk_test_epsin';
  process.env.WAVEPAY_WEBHOOK_SECRET = SECRET;
});

afterAll(async () => {
  for (const k of ENV) { if (envInitial[k] === undefined) delete process.env[k]; else process.env[k] = envInitial[k]; }
  await new Promise((ok) => faux.close(ok));
  if (demandes.length) {
    await query(`DELETE FROM paiement WHERE paiement_en_ligne_id = ANY($1)`, [demandes]);
    await query(`DELETE FROM paiement_en_ligne WHERE id = ANY($1)`, [demandes]);
  }
  await query(`DELETE FROM wavepay_evenement WHERE id LIKE 'evt_test_%'`);
});

async function ouvrir(corps = {}) {
  const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
  const frais = m.frais.find((f) => f.mois.some((x) => x.reste_du > 0));
  const r = await api('POST', '/api/paiements-en-ligne/wave', tuteur, { frais_id: frais.id, nb_mois: 1, ...corps });
  if (r.body?.id) demandes.push(r.body.id);
  return r;
}

/** Envoie un evenement signe au webhook d EPSIN. */
function webhook(evenement, { secret = SECRET, signature } = {}) {
  const corps = JSON.stringify(evenement);
  return request(app).post('/api/paiements-en-ligne/wavepay/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Signature', signature || signerWavepay(corps, secret))
    .send(corps);
}
const evenement = (id, type, demande, extra = {}) => ({
  id, object: 'event', type, livemode: false,
  data: { payment: { id: `pay_TESTEPSIN-${demande.id}`, status: type.split('.')[1], metadata: { paiement_en_ligne_id: String(demande.id) } }, ...extra },
});
const etat = async (id) => (await query(`SELECT statut, montant, montant_du FROM paiement_en_ligne WHERE id = $1`, [id])).rows[0];

describe('Signature (vecteur du guide)', () => {
  it('le vecteur de test donne vrai', () => {
    const e = construireEvenement(Buffer.from('{"id":"evt_1","type":"payment.succeeded"}'),
      't=1793700000,v1=bdc8d4e8c0c722922068a38fa98bb6b8519660cb29f0e48c89e49f9647037d31', 'whsec_test123', null);
    expect(e.id).toBe('evt_1');
  });
  it('horodatage de plus de 5 minutes refuse', () => {
    expect(() => construireEvenement(Buffer.from('{}'), signerWavepay('{}', SECRET, 1000), SECRET)).toThrow();
  });
});

describe('Creation du paiement', () => {
  it('cree le paiement chez WavePay, affiche amount_due et les liens', async () => {
    const r = await ouvrir({ telephone: '77 123 45 67' });
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('wavepay');
    expect(r.body.montant_du).toBe(r.body.montant + 3);
    expect(r.body.liens.qr_code_url).toContain('qr.svg');
    const appel = recues.at(-1);
    expect(appel.entetes['idempotency-key']).toBe(`epsin-paiement-${r.body.id}`);
    expect(appel.entetes.authorization).toBe('Bearer sk_test_epsin');
    expect(appel.corps).toMatchObject({ customer_phone: '771234567', reference: `EPSIN-${r.body.id}` });
    expect(await etat(r.body.id)).toMatchObject({ statut: 'en_attente' });
  });
  it('numero invalide refuse avant tout appel', async () => {
    const avant = recues.length;
    const r = await ouvrir({ telephone: '33 123 45 67' });
    expect(r.status).toBe(400);
    expect(recues.length).toBe(avant);
  });
  it('sans numero : paiement par QR code', async () => {
    const r = await ouvrir();
    expect(r.status).toBe(201);
    expect(recues.at(-1).corps.customer_phone).toBeUndefined();
  });
});

describe('Webhook', () => {
  it('faux webhook (mauvaise signature) : 400, rien ne change', async () => {
    const d = demandes[0];
    const r = await webhook(evenement('evt_test_faux', 'payment.succeeded', { id: d }),
      { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` });
    expect(r.status).toBe(400);
    expect((await etat(d)).statut).toBe('en_attente');
  });

  it('payment.succeeded : paye, recus crees, une seule fois meme rejoue', async () => {
    const d = demandes[0];
    const ev = evenement('evt_test_ok', 'payment.succeeded', { id: d }, { transaction: { id: 'txn_test_1', amount: 0 } });
    expect((await webhook(ev)).status).toBe(200);
    expect((await etat(d)).statut).toBe('reussi');
    const n1 = (await query(`SELECT COUNT(*)::int AS n FROM paiement WHERE paiement_en_ligne_id = $1`, [d])).rows[0].n;
    expect(n1).toBeGreaterThan(0);
    // Montant impute : celui des mois demandes, pas les francs d identification
    const { rows: [t] } = await query(`SELECT SUM(montant)::numeric AS s FROM paiement WHERE paiement_en_ligne_id = $1`, [d]);
    expect(Number(t.s)).toBe(Number((await etat(d)).montant));
    // Le comptable et l admin sont prevenus
    const notifs = async () => (await query(
      `SELECT u.role FROM notification n JOIN utilisateur u ON u.id = n.utilisateur_id
       WHERE n.titre = 'Paiement Wave recu'`
    )).rows;
    const roles = (await notifs()).map((r) => r.role);
    expect(roles).toContain('comptable');
    expect(roles).toContain('admin');
    const avant = roles.length;
    // Rejoue : rien de plus
    const r2 = await webhook(ev);
    expect(r2.status).toBe(200);
    const n2 = (await query(`SELECT COUNT(*)::int AS n FROM paiement WHERE paiement_en_ligne_id = $1`, [d])).rows[0].n;
    expect(n2).toBe(n1);
    expect((await notifs()).length).toBe(avant);
  });

  it('payment.expired puis payment.succeeded : le paiement l emporte', async () => {
    const r = await ouvrir({ telephone: '761234567' });
    const d = r.body.id;
    await webhook(evenement('evt_test_exp', 'payment.expired', { id: d }));
    expect((await etat(d)).statut).toBe('expire');
    await webhook(evenement('evt_test_tard', 'payment.succeeded', { id: d }, { transaction: { id: 'txn_test_2' } }));
    expect((await etat(d)).statut).toBe('reussi');
  });

  it('payment.canceled (doublon) : la demande est close', async () => {
    const r = await ouvrir({ telephone: '781234567' });
    await webhook({ ...evenement('evt_test_annule', 'payment.canceled', { id: r.body.id }), data: {
      ...evenement('x', 'payment.canceled', { id: r.body.id }).data, reason: 'duplicate' } });
    expect((await etat(r.body.id)).statut).toBe('echoue');
  });

  it('evenement d un paiement inconnu (autre application) : 200, ignore', async () => {
    const r = await webhook({ id: 'evt_test_autre', type: 'payment.succeeded', data: { payment: { id: 'pay_AUTRE', metadata: {} } } });
    expect(r.status).toBe(200);
  });
});
