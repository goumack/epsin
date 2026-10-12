import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';
import {
  moisDeLAnnee, moisDuFrais, etatDesMois, resteExigible, montantPourMois, ventilerVersement,
} from '../src/metier/mensualites.js';

/**
 * LE MOIS PAYE A L INSCRIPTION EST LE DERNIER DE L ANNEE : juin, ou juillet
 * pour la 3eme (classe d examen du BFEM). Il ne dispense pas des mois en
 * cours : octobre reste du.
 */

const annee = moisDeLAnnee(new Date(2026, 9, 1), new Date(2027, 6, 15));
const juin = moisDuFrais(annee, 6);
const juillet = moisDuFrais(annee, 7);
const LE_12_OCTOBRE = new Date(2026, 9, 12);

describe('Unitaire : imputation mois par mois', () => {
  it('juin pour toutes les classes, juillet pour la 3eme', () => {
    expect(juin).toHaveLength(9);
    expect(juin.at(-1)).toBe('2027-06');
    expect(juillet).toHaveLength(10);
    expect(juillet.at(-1)).toBe('2027-07');
  });

  it('a l inscription, le mois paye est le dernier', () => {
    const etat = etatDesMois(juin, 10000, []);
    expect(montantPourMois(etat, 1, { dernierDabord: true })).toBe(10000);
    expect(ventilerVersement(etat, 10000, { dernierDabord: true })).toEqual([{ mois: '2027-06', montant: 10000 }]);
    expect(ventilerVersement(etatDesMois(juillet, 13500, []), 13500, { dernierDabord: true }))
      .toEqual([{ mois: '2027-07', montant: 13500 }]);
  });

  it('un versement qui designe un mois regle ce mois, et octobre reste du', () => {
    const etat = etatDesMois(juin, 10000, [{ montant: 10000, mois: '2027-06' }], LE_12_OCTOBRE);
    expect(etat.at(-1).statut).toBe('paye');
    expect(etat[0].statut).toBe('en_retard');
    expect(resteExigible(etat, LE_12_OCTOBRE)).toBe(10000);
  });

  it('un versement sans mois regle les mois dans l ordre, apres les mois designes', () => {
    const etat = etatDesMois(juin, 10000, [
      { montant: 10000, mois: '2027-06' }, { montant: 15000, mois: null },
    ], LE_12_OCTOBRE);
    expect(etat.slice(0, 2).map((m) => m.statut)).toEqual(['paye', 'partiel']);
    expect(etat.at(-1).statut).toBe('paye');
    expect(resteExigible(etat, LE_12_OCTOBRE)).toBe(0);
  });

  it('un mois paye deux fois : l excedent va au mois suivant, rien n est perdu', () => {
    const etat = etatDesMois(juin, 10000, [
      { montant: 10000, mois: '2027-06' }, { montant: 10000, mois: '2027-06' },
    ]);
    expect(etat[0].statut).toBe('paye');
    expect(etat.at(-1).statut).toBe('paye');
  });

  it('reste compatible avec un total verse sans detail', () => {
    expect(etatDesMois(juin, 10000, 25000).slice(0, 3).map((m) => m.statut)).toEqual(['paye', 'paye', 'partiel']);
  });
});

// ------------------------------------------------------------------
let ctx;
const MENSUALITE = 'Mensualite Dernier Mois';
const MONTANT = 1000;

beforeAll(async () => { ctx = await contexte(); });

afterAll(async () => {
  const { rows } = await query(
    `SELECT id FROM frais WHERE annee_id = $1 AND libelle = $2`, [ctx.anneeId, MENSUALITE]
  );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await query(`DELETE FROM paiement WHERE frais_id = ANY($1)`, [ids]);
    await query(`DELETE FROM frais WHERE id = ANY($1)`, [ids]);
  }
});

describe('Bareme : dernier mois propre a chaque classe', () => {
  it('juin pour la CI, juillet pour la 6eme de test (comme la 3eme)', async () => {
    const r = await api('PUT', '/api/finances/bareme', COMPTES.comptable, {
      colonnes: [{
        libelle: MENSUALITE, recurrent: true, obligatoire: true, mois_fin: 6,
        montants: {
          [ctx.classes.ci.niveau_id]: MONTANT,
          [ctx.classes.sixieme.niveau_id]: { montant: MONTANT, mois_fin: 7 },
        },
      }],
    });
    expect(r.status).toBe(200);
    const col = r.body.colonnes.find((c) => c.libelle === MENSUALITE);
    expect(col.montants[ctx.classes.ci.niveau_id].mois_fin).toBe(6);
    expect(col.montants[ctx.classes.sixieme.niveau_id].mois_fin).toBe(7);

    const ech = await api('GET', `/api/finances/echeancier/${ctx.eleve6eme.id}`, COMPTES.comptable);
    const mens = ech.body.find((f) => f.libelle === MENSUALITE);
    expect(mens.mois.at(-1).mois.slice(5)).toBe('07');
  });
});

describe('Encaissement a l inscription : le dernier mois', () => {
  it('paie juin (pas octobre) ; les mois en cours restent dus', async () => {
    const { rows } = await query(
      `SELECT id FROM frais WHERE annee_id = $1 AND niveau_id = $2 AND libelle = $3`,
      [ctx.anneeId, ctx.classes.ci.niveau_id, MENSUALITE]
    );
    const avant = await api('GET', `/api/finances/echeancier/${ctx.eleveCI.id}`, COMPTES.comptable);
    const mens = avant.body.find((f) => f.libelle === MENSUALITE);
    const dernier = mens.mois.filter((m) => m.statut !== 'paye').at(-1).mois;

    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, mode: 'especes',
      elements: [{ frais_id: rows[0].id, nb_mois: 1, dernier_mois: true }],
    });
    expect(r.status).toBe(201);
    expect(r.body.lignes).toEqual([expect.objectContaining({ mois: dernier, montant: MONTANT })]);
    expect(dernier.slice(5)).toBe('06');

    const apres = await api('GET', `/api/finances/echeancier/${ctx.eleveCI.id}`, COMPTES.comptable);
    const etat = apres.body.find((f) => f.libelle === MENSUALITE).mois;
    expect(etat.find((m) => m.mois === dernier).statut).toBe('paye');
    // Le premier mois de l annee n est pas regle par l inscription
    expect(etat[0].statut).not.toBe('paye');
  });
});
