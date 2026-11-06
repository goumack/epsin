import { describe, it, expect, afterAll } from 'vitest';
import { api, COMPTES } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * MODIFIER UN ENSEIGNANT depuis sa fiche : corriger son nom et sa
 * specialite, et voir ses affectations avec leurs identifiants (pour les
 * retirer ou en ajouter sans passer par chaque classe).
 */

let cree;
let matiereEssai;

afterAll(async () => {
  if (matiereEssai) {
    await query(`DELETE FROM affectation WHERE matiere_id = $1`, [matiereEssai]);
    await query(`DELETE FROM matiere_niveau WHERE matiere_id = $1`, [matiereEssai]);
    await query(`DELETE FROM matiere WHERE id = $1`, [matiereEssai]);
  }
  if (cree?.utilisateur_id) {
    await query(`DELETE FROM affectation WHERE enseignant_id = $1`, [cree.id]);
    await query(`DELETE FROM enseignant WHERE id = $1`, [cree.id]);
    await query(`DELETE FROM utilisateur WHERE id = $1`, [cree.utilisateur_id]);
  }
});

describe('Modifier un enseignant', () => {
  it('corrige la fiche, puis affecte et retire une classe', async () => {
    const r = await api('POST', '/api/scolarite/enseignants', COMPTES.admin, {
      prenom: 'M.', nom: 'Essai', email: `essai.${Date.now()}@epsin.sn`, entite: 'secondaire',
    });
    expect(r.status).toBe(201);
    cree = r.body;

    const m = await api('PATCH', `/api/scolarite/enseignants/${cree.id}`, COMPTES.admin,
      { prenom: 'Moussa', nom: 'Essai', specialite: 'Anglais' });
    expect(m.status).toBe(200);

    // Une classe du secondaire et une matiere d essai mise a son programme
    const { rows: [c] } = await query(
      `SELECT c.id, c.niveau_id FROM classe c JOIN niveau n ON n.id = c.niveau_id AND n.entite = 'secondaire'
       WHERE c.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1) LIMIT 1`
    );
    const { rows: [mat] } = await query(`INSERT INTO matiere (libelle) VALUES ('Matiere essai') RETURNING id`);
    matiereEssai = mat.id;
    await query(`INSERT INTO matiere_niveau (matiere_id, niveau_id, coefficient) VALUES ($1,$2,1)`, [mat.id, c.niveau_id]);
    const cm = { classe_id: c.id, matiere_id: mat.id };
    const a = await api('POST', '/api/scolarite/affectations', COMPTES.admin, { enseignant_id: cree.id, ...cm });
    expect(a.status).toBe(201);

    const fiche = (await api('GET', '/api/scolarite/enseignants', COMPTES.admin)).body.find((e) => e.id === cree.id);
    expect(fiche.prenom).toBe('Moussa');
    expect(fiche.specialite).toBe('Anglais');
    expect(fiche.affectations).toHaveLength(1);
    expect(fiche.affectations[0]).toMatchObject({ id: a.body.id, classe_id: cm.classe_id, matiere_id: cm.matiere_id });
    expect(fiche.classes_maitre).toEqual([]);

    expect((await api('DELETE', `/api/scolarite/affectations/${a.body.id}`, COMPTES.admin)).status).toBe(200);
  });

  it('un directeur ne modifie pas un professeur du secondaire', async () => {
    const r = await api('PATCH', `/api/scolarite/enseignants/${cree.id}`, COMPTES.directeur, { nom: 'Pirate' });
    expect(r.status).toBe(403);
  });
});
