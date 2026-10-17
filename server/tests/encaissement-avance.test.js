import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * ENCAISSEMENT AU GUICHET D UNE MENSUALITE : plusieurs mois d avance d un
 * coup, ou un montant libre reparti mois par mois. Un encaissement = un lot
 * d ecritures (une par mois), un seul recu, une seule annulation.
 */

let ctx;
let mensualite;
const lots = [];

beforeAll(async () => {
  ctx = await contexte();
  const { rows } = await query(
    `SELECT id, montant FROM frais WHERE annee_id = $1 AND recurrent AND libelle = 'Mensualite'`,
    [ctx.anneeId]
  );
  mensualite = { id: rows[0].id, montant: Number(rows[0].montant) };
});

afterAll(async () => {
  for (const id of lots) await query(`DELETE FROM paiement WHERE id = $1 OR lot = $1`, [id]);
});

const echeancierDe = async (eleveId) => {
  const r = await api('GET', `/api/finances/echeancier/${eleveId}`, COMPTES.comptable);
  return r.body.find((f) => f.id === mensualite.id);
};

describe('Avance de plusieurs mois au guichet', () => {
  it('l echeancier liste les mois de la mensualite et leur etat', async () => {
    const e = await echeancierDe(ctx.eleveCI.id);
    expect(e.mois.length).toBeGreaterThan(0);
    expect(e.mois[0]).toHaveProperty('statut');
  });

  it('encaisse 2 mois complets : un lot de 2 ecritures, un seul recu', async () => {
    const avant = await echeancierDe(ctx.eleveCI.id);
    const aRegler = avant.mois.filter((m) => m.statut !== 'paye');
    if (aRegler.length < 2) return;
    const attendu = aRegler[0].reste_du + aRegler[1].reste_du;

    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, frais_id: mensualite.id, nb_mois: 2, mode: 'especes',
      montant: 1,   // ignore : le serveur calcule le montant des mois complets
    });
    expect(r.status).toBe(201);
    lots.push(r.body.id);
    expect(r.body.montant).toBe(attendu);
    expect(r.body.lignes.map((l) => l.mois)).toEqual([aRegler[0].mois, aRegler[1].mois]);

    const recu = await api('GET', `/api/finances/recus/${r.body.id}`, COMPTES.comptable);
    expect(recu.body.lignes).toHaveLength(2);
    expect(recu.body.total).toBe(attendu);

    const apres = await echeancierDe(ctx.eleveCI.id);
    expect(apres.mois.find((m) => m.mois === aRegler[1].mois).statut).toBe('paye');
  });

  it('un montant libre laisse le dernier mois partiel', async () => {
    const avant = await echeancierDe(ctx.eleveCI.id);
    const premier = avant.mois.find((m) => m.statut !== 'paye');
    if (!premier || premier.reste_du < 2) return;
    const montant = premier.reste_du + Math.floor(mensualite.montant / 2);

    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, frais_id: mensualite.id, montant, mode: 'wave',
    });
    expect(r.status).toBe(201);
    lots.push(r.body.id);
    expect(r.body.lignes[0]).toMatchObject({ mois: premier.mois, montant: premier.reste_du });

    const apres = await echeancierDe(ctx.eleveCI.id);
    const suivant = apres.mois.find((m) => m.mois === r.body.lignes[1]?.mois);
    if (suivant) expect(suivant.statut).toBe('partiel');
  });

  it('refuse plus de mois qu il n en reste', async () => {
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, frais_id: mensualite.id, nb_mois: 99,
    });
    expect(r.status).toBe(400);
  });

  it('annuler une ecriture annule tout le lot', async () => {
    const id = lots[0];
    if (!id) return;
    const { rows: avant } = await query(`SELECT COUNT(*)::int AS n FROM paiement WHERE lot = $1`, [id]);
    const r = await api('PATCH', `/api/finances/paiements/${id}/annuler`, COMPTES.comptable, { motif: 'Essai' });
    expect(r.status).toBe(200);
    expect(r.body.ecritures).toBe(avant[0].n);
    const { rows } = await query(`SELECT bool_and(annule) AS tout FROM paiement WHERE lot = $1`, [id]);
    expect(rows[0].tout).toBe(true);
  });

  it('un frais ponctuel reste une seule ecriture', async () => {
    // Un frais encore du : un frais deja solde ne s encaisse plus
    const { rows } = await query(
      `SELECT f.id, f.montant - COALESCE((SELECT SUM(p.montant) FROM paiement p
                WHERE p.eleve_id = $2 AND p.frais_id = f.id AND NOT p.annule), 0) AS reste
       FROM frais f WHERE f.annee_id = $1 AND NOT f.recurrent AND f.montant > 0
       ORDER BY reste DESC LIMIT 1`,
      [ctx.anneeId, ctx.eleveCI.id]
    );
    if (!rows[0] || Number(rows[0].reste) <= 0) return;
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, frais_id: rows[0].id, montant: Math.min(1000, Number(rows[0].reste)), mode: 'especes',
    });
    expect(r.status).toBe(201);
    lots.push(r.body.id);
    expect(r.body.lignes).toHaveLength(1);
    expect(r.body.lot).toBeNull();
  });
});
