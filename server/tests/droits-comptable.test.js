import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * DROITS DU COMPTABLE : il ouvre des classes et inscrit des eleves (souvent
 * a la caisse, au paiement des frais d inscription), mais ne gere ni
 * l equipe pedagogique, ni le professeur principal, ni les comptes parents.
 */

let ctx;
const classes = [];
const eleves = [];

beforeAll(async () => { ctx = await contexte(); });

afterAll(async () => {
  for (const id of eleves) {
    await query(`DELETE FROM inscription WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve_tuteur WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve WHERE id = $1`, [id]);
  }
  for (const id of classes) await query(`DELETE FROM classe WHERE id = $1`, [id]);
});

describe('Le comptable cree classes et eleves', () => {
  it('ouvre une classe', async () => {
    const r = await api('POST', '/api/scolarite/classes', COMPTES.comptable, {
      niveau_id: ctx.classes.ci.niveau_id, libelle: `CI Test ${Date.now()}`,
    });
    expect(r.status).toBe(201);
    classes.push(r.body.id);
  });

  it('inscrit un eleve dans cette classe et recoit la fiche d acces parent', async () => {
    const r = await api('POST', '/api/eleves', COMPTES.comptable, {
      prenom: 'Inscrit', nom: 'Par La Caisse', sexe: 'M', classe_id: classes[0],
      tuteurs: [{ prenom: 'Pere', nom: 'Caisse', telephone: `76${Date.now() % 10000000}`, principal: true }],
    });
    expect(r.status).toBe(201);
    eleves.push(r.body.id);
    expect(r.body.compte_parent.mot_de_passe).toBeTruthy();
  });

  it('place un eleve dans une classe (eleve non affecte, nouvelle annee)', async () => {
    const r = await api('POST', `/api/eleves/${eleves[0]}/affecter`, COMPTES.comptable, {
      classe_id: classes[0],
    });
    expect(r.status).toBe(200);
    const dossier = await api('GET', `/api/eleves/${eleves[0]}`, COMPTES.comptable);
    expect(dossier.body.classe_id).toBe(classes[0]);
  });

  it('ne gere pas pour autant l equipe ni le professeur principal', async () => {
    expect((await api('PATCH', `/api/scolarite/classes/${classes[0]}/professeur-principal`,
      COMPTES.comptable, { utilisateur_id: null })).status).toBe(403);
    expect((await api('PUT', `/api/scolarite/classes/${classes[0]}/maitre`,
      COMPTES.comptable, { enseignant_id: null })).status).toBe(403);
    expect((await api('POST', '/api/scolarite/enseignants', COMPTES.comptable, {
      prenom: 'A', nom: 'B', email: `c${Date.now()}@epsin.sn`,
    })).status).toBe(403);
  });
});
