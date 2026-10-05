import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte, compteTuteur } from './aides.js';
import { query } from '../src/db/pool.js';
import { nombreEnLettres, montantEnLettres } from '../src/metier/montant-lettres.js';

/**
 * RECUS DE PAIEMENT : chaque paiement valide a un recu imprimable,
 * consultable par la caisse et par le tuteur de l eleve concerne, et par
 * personne d autre.
 */

let ctx;
let tuteur;
let autreTuteur;
const paiements = [];
const tentatives = [];

beforeAll(async () => {
  ctx = await contexte();
  tuteur = compteTuteur(ctx.eleveCI.matricule);
  autreTuteur = compteTuteur(ctx.eleve6eme.matricule);
});

afterAll(async () => {
  if (tentatives.length) {
    await query(`DELETE FROM paiement WHERE paiement_en_ligne_id = ANY($1)`, [tentatives]);
    await query(`DELETE FROM paiement_en_ligne WHERE id = ANY($1)`, [tentatives]);
  }
  if (paiements.length) await query(`DELETE FROM paiement WHERE id = ANY($1)`, [paiements]);
});

describe('Unitaire : montant en toutes lettres', () => {
  it.each([
    [1, 'un'], [21, 'vingt et un'], [71, 'soixante et onze'], [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'], [99, 'quatre-vingt-dix-neuf'], [200, 'deux cents'],
    [201, 'deux cent un'], [1000, 'mille'], [15000, 'quinze mille'],
    [80000, 'quatre-vingt mille'], [200000, 'deux cent mille'],
    [2000000, 'deux millions'], [180000000, 'cent quatre-vingts millions'],
  ])('%i -> %s', (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  it('accorde « franc » et ajoute « de » apres million', () => {
    expect(montantEnLettres(1)).toBe('un franc CFA');
    expect(montantEnLettres(15000)).toBe('quinze mille francs CFA');
    expect(montantEnLettres(2000000)).toBe('deux millions de francs CFA');
  });
});

describe('Recu d un paiement au guichet', () => {
  let paiement;

  beforeAll(async () => {
    const { rows } = await query(
      `SELECT id FROM frais WHERE annee_id = $1 AND libelle = 'Mensualite'`, [ctx.anneeId]
    );
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: ctx.eleveCI.id, frais_id: rows[0].id, montant: 15000, mode: 'especes',
    });
    paiement = r.body;
    paiements.push(paiement.id);
  });

  it('la caisse obtient un recu complet, montant en lettres compris', async () => {
    const r = await api('GET', `/api/finances/recus/${paiement.id}`, COMPTES.comptable);
    expect(r.status).toBe(200);
    expect(r.body.numeros).toEqual([paiement.numero_recu]);
    expect(r.body.total).toBe(15000);
    expect(r.body.total_lettres).toBe('quinze mille francs CFA');
    expect(r.body.eleve.matricule).toBe(ctx.eleveCI.matricule);
    expect(r.body.valide_par).toBeTruthy();
    expect(r.body.etablissement.nom).toBeTruthy();
  });

  it('le tuteur de l eleve l obtient, et le voit dans sa liste', async () => {
    expect((await api('GET', `/api/finances/recus/${paiement.id}`, tuteur)).status).toBe(200);
    const liste = await api('GET', '/api/finances/recus', tuteur);
    expect(liste.body.some((x) => x.numero_recu === paiement.numero_recu)).toBe(true);
  });

  it('un autre tuteur ou un enseignant ne l obtient pas', async () => {
    expect((await api('GET', `/api/finances/recus/${paiement.id}`, autreTuteur)).status).toBe(404);
    expect((await api('GET', `/api/finances/recus/${paiement.id}`, COMPTES.professeur)).status).toBe(404);
    // Un tuteur ne peut pas viser la liste d un autre eleve
    const liste = await api('GET', `/api/finances/recus?eleve_id=${ctx.eleveCI.id}`, autreTuteur);
    expect(liste.body.some((x) => x.numero_recu === paiement.numero_recu)).toBe(false);
  });

  it('un paiement annule disparait de la liste du tuteur, son recu porte « annule »', async () => {
    await api('PATCH', `/api/finances/paiements/${paiement.id}/annuler`, COMPTES.comptable, {});
    const recu = await api('GET', `/api/finances/recus/${paiement.id}`, COMPTES.comptable);
    expect(recu.body.annule).toBe(true);
    const liste = await api('GET', '/api/finances/recus', tuteur);
    expect(liste.body.some((x) => x.numero_recu === paiement.numero_recu)).toBe(false);
  });
});

describe('Recu d un paiement Wave', () => {
  it('n existe qu apres validation, et regroupe tous les mois payes', async () => {
    const env = process.env.WAVE_LIEN_PAIEMENT;
    process.env.WAVE_LIEN_PAIEMENT = 'https://pay.wave.com/m/M_sn_test/c/sn/';
    try {
      const { body: m } = await api('GET', '/api/paiements-en-ligne/mensualites', tuteur);
      const f = m.frais[0];
      if (f.mois.filter((x) => x.statut !== 'paye').length < 2) return;

      const r = await api('POST', '/api/paiements-en-ligne/wave', tuteur, { frais_id: f.id, nb_mois: 2 });
      tentatives.push(r.body.id);
      await api('POST', `/api/paiements-en-ligne/${r.body.id}/declarer`, tuteur, {});

      // Declare mais pas confirme : aucun recu
      const avant = await api('GET', `/api/paiements-en-ligne/${r.body.id}`, tuteur);
      expect(avant.body.recus).toEqual([]);

      const v = await api('POST', `/api/paiements-en-ligne/${r.body.id}/valider`, COMPTES.comptable, {});
      const recu = await api('GET', `/api/finances/recus/${v.body.recus[0].id}`, tuteur);
      expect(recu.status).toBe(200);
      expect(recu.body.mode).toBe('wave');
      expect(recu.body.lignes).toHaveLength(2);
      expect(recu.body.total).toBe(Number(r.body.montant));
      expect(recu.body.valide_par).toBeTruthy();

      // Une seule entree dans la liste du tuteur pour ce paiement
      const liste = await api('GET', '/api/finances/recus', tuteur);
      const entree = liste.body.filter((x) => x.id === v.body.recus[0].id);
      expect(entree).toHaveLength(1);
      expect(entree[0].lignes).toBe(2);
    } finally {
      if (env === undefined) delete process.env.WAVE_LIEN_PAIEMENT;
      else process.env.WAVE_LIEN_PAIEMENT = env;
    }
  });
});
