import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * BAREME PAR CLASSE : une grille niveaux x frais (inscription, mensualite
 * d octobre a juin...), et l encaissement groupe de plusieurs frais en un
 * seul recu, comme a l inscription.
 */

let ctx;
const INSCRIPTION = 'Inscription Test';
const MENSUALITE = 'Mensualite Test';
const MONTANT_MENSUEL = 1000;

beforeAll(async () => { ctx = await contexte(); });

afterAll(async () => {
  const { rows } = await query(
    `SELECT id FROM frais WHERE annee_id = $1 AND libelle = ANY($2)`,
    [ctx.anneeId, [INSCRIPTION, MENSUALITE]]
  );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await query(`DELETE FROM paiement WHERE frais_id = ANY($1)`, [ids]);
    await query(`DELETE FROM frais WHERE id = ANY($1)`, [ids]);
  }
});

const grille = (montantsCI, autres = {}) => ({
  colonnes: [
    { libelle: INSCRIPTION, recurrent: false, obligatoire: true,
      montants: { [ctx.classes.ci.niveau_id]: montantsCI.inscription, ...autres.inscription } },
    { libelle: MENSUALITE, recurrent: true, obligatoire: true, mois_fin: 6,
      montants: { [ctx.classes.ci.niveau_id]: montantsCI.mensualite, ...autres.mensualite } },
  ],
});

describe('Grille du bareme', () => {
  it('enregistre un montant par niveau et le relit', async () => {
    const r = await api('PUT', '/api/finances/bareme', COMPTES.comptable, grille(
      { inscription: 21000, mensualite: MONTANT_MENSUEL },
      { inscription: { [ctx.classes.sixieme.niveau_id]: 29000 } },
    ));
    expect(r.status).toBe(200);
    const insc = r.body.colonnes.find((c) => c.libelle === INSCRIPTION);
    expect(insc.montants[ctx.classes.ci.niveau_id].montant).toBe(21000);
    expect(insc.montants[ctx.classes.sixieme.niveau_id].montant).toBe(29000);
    const mens = r.body.colonnes.find((c) => c.libelle === MENSUALITE);
    expect(mens).toMatchObject({ recurrent: true, mois_fin: 6 });
  });

  it('chaque eleve ne doit que les frais de son niveau', async () => {
    const ci = await api('GET', `/api/finances/situation/${ctx.eleveCI.id}`, COMPTES.comptable);
    expect(ci.body.lignes.find((l) => l.libelle === INSCRIPTION).du).toBe(21000);
    const six = await api('GET', `/api/finances/situation/${ctx.eleve6eme.id}`, COMPTES.comptable);
    expect(six.body.lignes.find((l) => l.libelle === INSCRIPTION).du).toBe(29000);
    // Pas de mensualite de test en 6eme : la case est vide
    expect(six.body.lignes.find((l) => l.libelle === MENSUALITE)).toBeUndefined();
  });

  it('la mensualite s arrete a juin : 9 mois, pas un de plus', async () => {
    const ech = await api('GET', `/api/finances/echeancier/${ctx.eleveCI.id}`, COMPTES.comptable);
    const mens = ech.body.find((f) => f.libelle === MENSUALITE);
    expect(mens.mois.at(-1).mois.slice(5)).toBe('06');
    const { rows } = await query(
      `SELECT date_debut, date_fin FROM annee_scolaire WHERE id = $1`, [ctx.anneeId]
    );
    // L annee de demonstration court d octobre a juillet : juillet est exclu
    expect(new Date(rows[0].date_fin).getMonth()).toBe(6);
    expect(mens.mois.some((m) => m.mois.endsWith('-07'))).toBe(false);
  });

  it('refuse un libelle deja utilise pour tous les niveaux (double paiement)', async () => {
    const { rows } = await query(
      `SELECT libelle FROM frais WHERE annee_id = $1 AND niveau_id IS NULL LIMIT 1`, [ctx.anneeId]
    );
    if (!rows[0]) return;
    const r = await api('PUT', '/api/finances/bareme', COMPTES.comptable, {
      colonnes: [{ libelle: rows[0].libelle, montants: { [ctx.classes.ci.niveau_id]: 1000 } }],
    });
    expect(r.status).toBe(409);
    // Meme refus avec des accents ou une casse differente
    const variante = `${rows[0].libelle.toUpperCase().replace(/E/, 'É')}`;
    const r2 = await api('PUT', '/api/finances/bareme', COMPTES.comptable, {
      colonnes: [{ libelle: variante, montants: { [ctx.classes.ci.niveau_id]: 1000 } }],
    });
    expect(r2.status).toBe(409);
  });

  it('reservee a la caisse', async () => {
    expect((await api('PUT', '/api/finances/bareme', COMPTES.professeur, { colonnes: [] })).status).toBe(403);
  });
});

describe('Encaissement groupe a l inscription', () => {
  it('inscription + 2 mois en un encaissement : un lot, un recu', async () => {
    const { rows } = await query(
      `SELECT id, libelle FROM frais WHERE annee_id = $1 AND niveau_id = $2 AND libelle = ANY($3)`,
      [ctx.anneeId, ctx.classes.ci.niveau_id, [INSCRIPTION, MENSUALITE]]
    );
    const insc = rows.find((f) => f.libelle === INSCRIPTION);
    const mens = rows.find((f) => f.libelle === MENSUALITE);

    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, mode: 'especes',
      elements: [{ frais_id: insc.id, montant: 21000 }, { frais_id: mens.id, nb_mois: 2 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.montant).toBe(21000 + 2 * MONTANT_MENSUEL);
    expect(r.body.lignes.map((l) => l.frais)).toEqual([INSCRIPTION, MENSUALITE, MENSUALITE]);

    const recu = await api('GET', `/api/finances/recus/${r.body.id}`, COMPTES.comptable);
    expect(recu.body.lignes).toHaveLength(3);
    expect(recu.body.total).toBe(21000 + 2 * MONTANT_MENSUEL);
  });

  it('refuse deux fois le meme frais dans un encaissement', async () => {
    const { rows } = await query(
      `SELECT id FROM frais WHERE annee_id = $1 AND niveau_id = $2 AND libelle = $3`,
      [ctx.anneeId, ctx.classes.ci.niveau_id, INSCRIPTION]
    );
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id,
      elements: [{ frais_id: rows[0].id, montant: 1 }, { frais_id: rows[0].id, montant: 1 }],
    });
    expect(r.status).toBe(400);
  });

  it('vider une case deja payee conserve le frais et le signale', async () => {
    const r = await api('PUT', '/api/finances/bareme', COMPTES.comptable,
      grille({ inscription: null, mensualite: MONTANT_MENSUEL }));
    expect(r.status).toBe(200);
    expect(r.body.avertissements.length).toBeGreaterThan(0);
    const insc = r.body.colonnes.find((c) => c.libelle === INSCRIPTION);
    expect(insc.montants[ctx.classes.ci.niveau_id]).toBeTruthy();
  });
});
