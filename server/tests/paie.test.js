import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * PAIE DES MAITRES ET PROFESSEURS : personnel paye, paie du mois,
 * paiement qui devient une depense « Salaires », annulation. Donnees fictives.
 */

const MOIS = '2099-11';   // mois fictif : aucune paie reelle n y existe
let maitre;
let prof;
let ancien;

beforeAll(async () => {
  const creer = async (corps) => (await api('POST', '/api/salaires/salaries', COMPTES.comptable, corps)).body;
  maitre = await creer({ prenom: 'Awa', nom: 'Essai', fonction: 'Maître', salaire_mensuel: 75000, telephone: '770001111' });
  prof = await creer({ prenom: 'Moussa', nom: 'Essai', fonction: 'Professeur', salaire_mensuel: 90000 });
  ancien = await creer({ prenom: 'Parti', nom: 'Essai', fonction: 'Maître', salaire_mensuel: 60000, actif: false });
});

afterAll(async () => {
  const ids = [maitre?.id, prof?.id, ancien?.id].filter(Boolean);
  const { rows } = await query(`SELECT depense_id FROM paie WHERE salarie_id = ANY($1) AND depense_id IS NOT NULL`, [ids]);
  await query(`DELETE FROM paie WHERE salarie_id = ANY($1)`, [ids]);
  if (rows.length) await query(`DELETE FROM depense WHERE id = ANY($1)`, [rows.map((r) => r.depense_id)]);
  await query(`DELETE FROM salarie WHERE id = ANY($1)`, [ids]);
});

const paie = async () => (await api('GET', `/api/salaires/paie?mois=${MOIS}`, COMPTES.comptable)).body;
const ligne = async (s) => (await paie()).lignes.find((l) => l.salarie_id === s.id);

describe('Personnel paye', () => {
  it('reserve a la caisse', async () => {
    expect((await api('GET', '/api/salaires/salaries', COMPTES.professeur)).status).toBe(403);
    expect((await api('GET', '/api/salaires/salaries', COMPTES.directeur)).status).toBe(403);
  });
  it('prenom, nom et salaire valides obligatoires', async () => {
    expect((await api('POST', '/api/salaires/salaries', COMPTES.comptable, { prenom: 'X' })).status).toBe(400);
    expect((await api('POST', '/api/salaires/salaries', COMPTES.comptable, { prenom: 'X', nom: 'Y', salaire_mensuel: -5 })).status).toBe(400);
  });
});

describe('Paie du mois', () => {
  it('preparer : une ligne par salarie actif, au salaire habituel, sans doublon', async () => {
    const avant = await paie();
    expect(avant.a_preparer.some((s) => s.id === maitre.id)).toBe(true);
    expect(avant.a_preparer.some((s) => s.id === ancien.id)).toBe(false);
    await api('POST', '/api/salaires/paie/preparer', COMPTES.comptable, { mois: MOIS });
    const deux = await api('POST', '/api/salaires/paie/preparer', COMPTES.comptable, { mois: MOIS });
    expect(deux.body.ajoutees).toBe(0);
    expect(await ligne(maitre)).toMatchObject({ statut: 'a_payer' });
    expect(Number((await ligne(maitre)).montant)).toBe(75000);
    expect(await ligne(ancien)).toBeUndefined();
  });

  it('ajuster le montant du mois avec une note', async () => {
    const l = await ligne(prof);
    const r = await api('PUT', `/api/salaires/paie/${l.id}`, COMPTES.comptable, { montant: 85000, note: '1 jour d absence' });
    expect(r.status).toBe(200);
    expect(await ligne(prof)).toMatchObject({ note: '1 jour d absence' });
    expect(Number((await ligne(prof)).montant)).toBe(85000);
  });

  it('payer : la ligne passe payee et une depense « Salaires » est creee', async () => {
    const l = await ligne(maitre);
    const r = await api('POST', `/api/salaires/paie/${l.id}/payer`, COMPTES.comptable, { mode: 'wave', date: '2099-11-30' });
    expect(r.status).toBe(200);
    const p = await ligne(maitre);
    expect(p).toMatchObject({ statut: 'paye', mode: 'wave' });
    const { rows: [d] } = await query(`SELECT categorie, libelle, montant, date_depense FROM depense WHERE id = $1`, [p.depense_id]);
    expect(d.categorie).toBe('Salaires');
    expect(d.libelle).toMatch(/Salaire novembre 2099 — Awa Essai \(Maître\)/);
    expect(Number(d.montant)).toBe(75000);
  });

  it('un salaire paye ne se paie pas deux fois et ne se modifie plus', async () => {
    const l = await ligne(maitre);
    expect((await api('POST', `/api/salaires/paie/${l.id}/payer`, COMPTES.comptable, {})).status).toBe(409);
    expect((await api('PUT', `/api/salaires/paie/${l.id}`, COMPTES.comptable, { montant: 1 })).status).toBe(409);
  });

  it('totaux du mois', async () => {
    const p = await paie();
    expect(p.total).toBe(75000 + 85000);
    expect(p.paye).toBe(75000);
    expect(p.reste).toBe(85000);
  });

  it('annuler un paiement : motif obligatoire, la depense est retiree', async () => {
    const l = await ligne(maitre);
    expect((await api('POST', `/api/salaires/paie/${l.id}/annuler`, COMPTES.comptable, {})).status).toBe(400);
    const r = await api('POST', `/api/salaires/paie/${l.id}/annuler`, COMPTES.comptable, { motif: 'Erreur de montant' });
    expect(r.status).toBe(200);
    expect((await ligne(maitre)).statut).toBe('a_payer');
    const { rows } = await query(`SELECT 1 FROM depense WHERE id = $1`, [l.depense_id]);
    expect(rows).toHaveLength(0);
  });

  it('mois invalide refuse', async () => {
    expect((await api('GET', '/api/salaires/paie?mois=2026-13', COMPTES.comptable)).status).toBe(400);
  });
});
