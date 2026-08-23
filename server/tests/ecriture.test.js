import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * TESTS D ECRITURE — les operations qui creent ou modifient des donnees.
 *
 * Chaque test nettoie ce qu il a cree : la base doit se retrouver dans son
 * etat initial a la fin. Ce sont les chemins les plus risques de
 * l application, ceux ou un bug corrompt durablement les donnees.
 */

let ctx;
const aNettoyer = { evaluations: [], creneaux: [], annonces: [], matieres: [], eleves: [] };

beforeAll(async () => { ctx = await contexte(); });

afterAll(async () => {
  // Nettoyage en ordre inverse des dependances
  for (const id of aNettoyer.evaluations) {
    await query(`DELETE FROM note WHERE evaluation_id = $1`, [id]);
    await query(`DELETE FROM evaluation WHERE id = $1`, [id]);
  }
  for (const id of aNettoyer.creneaux) await query(`DELETE FROM creneau WHERE id = $1`, [id]);
  for (const id of aNettoyer.annonces) await query(`DELETE FROM annonce WHERE id = $1`, [id]);
  for (const id of aNettoyer.matieres) {
    await query(`DELETE FROM matiere_niveau WHERE matiere_id = $1`, [id]);
    await query(`DELETE FROM matiere WHERE id = $1`, [id]);
  }
  for (const id of aNettoyer.eleves) {
    await query(`DELETE FROM inscription WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve_tuteur WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve WHERE id = $1`, [id]);
  }
});

describe('Ecriture : evaluations et notes', () => {
  let evaluationId;

  it('cree une evaluation', async () => {
    const { rows: m } = await query(
      `SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1 LIMIT 1`,
      [ctx.classes.ci.niveau_id]
    );
    const r = await api('POST', '/api/notes/evaluations', COMPTES.directeur, {
      classe_id: ctx.classes.ci.id,
      matiere_id: m[0].matiere_id,
      periode_id: ctx.periodeId,
      type: 'devoir',
      libelle: 'Test automatise',
      bareme: 20,
      coefficient: 1,
    });
    expect(r.status).toBe(201);
    evaluationId = r.body.id;
    aNettoyer.evaluations.push(evaluationId);
  });

  it('sert la feuille de saisie avec tous les eleves', async () => {
    const r = await api('GET', `/api/notes/evaluations/${evaluationId}/feuille`, COMPTES.directeur);
    expect(r.status).toBe(200);
    expect(r.body.eleves.length).toBeGreaterThan(0);
  });

  it('enregistre les notes en lot', async () => {
    const feuille = await api('GET', `/api/notes/evaluations/${evaluationId}/feuille`, COMPTES.directeur);
    const notes = feuille.body.eleves.slice(0, 3).map((e, i) => ({
      eleve_id: e.eleve_id, valeur: 10 + i,
    }));
    const r = await api('POST', `/api/notes/evaluations/${evaluationId}/notes`,
      COMPTES.directeur, { notes });
    expect(r.status).toBe(200);

    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM note WHERE evaluation_id = $1`, [evaluationId]
    );
    expect(rows[0].n).toBe(3);
  });

  it('refuse une note hors bareme', async () => {
    const feuille = await api('GET', `/api/notes/evaluations/${evaluationId}/feuille`, COMPTES.directeur);
    const r = await api('POST', `/api/notes/evaluations/${evaluationId}/notes`,
      COMPTES.directeur, {
        notes: [{ eleve_id: feuille.body.eleves[0].eleve_id, valeur: 25 }],
      });
    expect(r.status).toBe(400);
  });

  it('accepte une note nulle (absent a l epreuve)', async () => {
    const feuille = await api('GET', `/api/notes/evaluations/${evaluationId}/feuille`, COMPTES.directeur);
    const r = await api('POST', `/api/notes/evaluations/${evaluationId}/notes`,
      COMPTES.directeur, {
        notes: [{ eleve_id: feuille.body.eleves[0].eleve_id, valeur: null }],
      });
    expect(r.status).toBe(200);
  });
});

describe('Ecriture : emploi du temps', () => {
  let creneauId;

  it('un maitre pose une heure dans sa classe', async () => {
    const { rows: m } = await query(
      `SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1 LIMIT 1`,
      [ctx.classes.ci.niveau_id]
    );
    const r = await api('POST', '/api/scolarite/creneaux', COMPTES.maitre, {
      classe_id: ctx.classes.ci.id,
      matiere_id: m[0].matiere_id,
      jour: 6, heure_debut: '15:00', heure_fin: '16:00', salle: 'Test',
    });
    expect(r.status).toBe(201);
    creneauId = r.body.id;
    aNettoyer.creneaux.push(creneauId);
  });

  it('detecte un conflit d horaire', async () => {
    const { rows: m } = await query(
      `SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1 LIMIT 1`,
      [ctx.classes.ci.niveau_id]
    );
    const r = await api('POST', '/api/scolarite/creneaux', COMPTES.maitre, {
      classe_id: ctx.classes.ci.id,
      matiere_id: m[0].matiere_id,
      jour: 6, heure_debut: '15:30', heure_fin: '16:30',
    });
    expect(r.status).toBe(409);
  });

  it('deplace le creneau', async () => {
    const r = await api('PATCH', `/api/scolarite/creneaux/${creneauId}`, COMPTES.maitre, {
      heure_debut: '17:00', heure_fin: '18:00', salle: 'Test 2',
    });
    expect(r.status).toBe(200);
    expect(r.body.salle).toBe('Test 2');
  });

  it('refuse a un autre enseignant de toucher ce creneau', async () => {
    const r = await api('PATCH', `/api/scolarite/creneaux/${creneauId}`,
      COMPTES.professeur, { salle: 'Pirate' });
    expect(r.status).toBe(403);
  });

  it('supprime son propre creneau', async () => {
    const r = await api('DELETE', `/api/scolarite/creneaux/${creneauId}`, COMPTES.maitre);
    expect(r.status).toBe(200);
    aNettoyer.creneaux = aNettoyer.creneaux.filter((i) => i !== creneauId);
  });
});

describe('Ecriture : matieres', () => {
  let matiereId;

  it('la direction cree une matiere', async () => {
    const r = await api('POST', '/api/scolarite/matieres', COMPTES.directeur, {
      libelle: 'Matiere de test', code: 'TEST', couleur: '#123456',
      coefficients: [{ niveau_id: ctx.classes.ci.niveau_id, coefficient: 2 }],
    });
    expect(r.status).toBe(201);
    matiereId = r.body.id;
    aNettoyer.matieres.push(matiereId);
  });

  it('modifie son coefficient', async () => {
    const r = await api('PATCH', `/api/scolarite/matieres/${matiereId}`, COMPTES.directeur, {
      coefficients: [{ niveau_id: ctx.classes.ci.niveau_id, coefficient: 5 }],
    });
    expect(r.status).toBe(200);

    const { rows } = await query(
      `SELECT coefficient FROM matiere_niveau WHERE matiere_id = $1 AND niveau_id = $2`,
      [matiereId, ctx.classes.ci.niveau_id]
    );
    expect(Number(rows[0].coefficient)).toBe(5);
  });

  it('refuse la modification a un enseignant', async () => {
    const r = await api('PATCH', `/api/scolarite/matieres/${matiereId}`,
      COMPTES.maitre, { libelle: 'Pirate' });
    expect(r.status).toBe(403);
  });

  it('supprime une matiere sans note', async () => {
    const r = await api('DELETE', `/api/scolarite/matieres/${matiereId}`, COMPTES.directeur);
    expect(r.status).toBe(200);
    aNettoyer.matieres = aNettoyer.matieres.filter((i) => i !== matiereId);
  });
});

describe('Ecriture : inscription d un eleve', () => {
  it('cree un eleve avec son tuteur puis l affecte', async () => {
    const r = await api('POST', '/api/eleves', COMPTES.directeur, {
      prenom: 'Test', nom: 'Automatise', sexe: 'M',
      date_naissance: '2019-05-10', classe_id: ctx.classes.ci.id,
      tuteurs: [{ prenom: 'Tuteur', nom: 'Test', telephone: '+221770000000', lien: 'pere', principal: true }],
    });
    expect(r.status).toBe(201);
    expect(r.body.matricule).toMatch(/^EP-/);
    aNettoyer.eleves.push(r.body.id);

    // Il doit apparaitre dans sa classe
    const liste = await api('GET',
      `/api/scolarite/classes/${ctx.classes.ci.id}/eleves`, COMPTES.directeur);
    expect(liste.body.some((e) => e.id === r.body.id)).toBe(true);
  });

  it('refuse la creation a un enseignant', async () => {
    const r = await api('POST', '/api/eleves', COMPTES.maitre, {
      prenom: 'X', nom: 'Y', sexe: 'M',
    });
    expect(r.status).toBe(403);
  });
});

describe('Ecriture : communication', () => {
  it('publie une annonce puis la retire', async () => {
    const r = await api('POST', '/api/communication/annonces', COMPTES.admin, {
      titre: 'Annonce de test', contenu: 'Contenu de test automatise', cible: 'tous',
    });
    expect(r.status).toBe(201);
    aNettoyer.annonces.push(r.body.id);

    const suppr = await api('DELETE', `/api/communication/annonces/${r.body.id}`, COMPTES.admin);
    expect(suppr.status).toBe(200);
    aNettoyer.annonces = aNettoyer.annonces.filter((i) => i !== r.body.id);
  });
});

describe('Ecriture : conseil de classe', () => {
  let eleveId;

  afterAll(async () => {
    if (eleveId) await query(`DELETE FROM conseil_classe WHERE eleve_id = $1`, [eleveId]);
  });

  it('arrete les decisions du conseil', async () => {
    eleveId = ctx.eleveCI.id;
    const r = await api('PUT', `/api/notes/conseil/${eleveId}/${ctx.periodeId}`,
      COMPTES.directeur, {
        appreciation: 'satisfaisant',
        distinction: 'encouragement',
        observations: 'Test automatise',
      });
    expect(r.status).toBe(200);

    // La decision doit remonter dans le bulletin
    const b = await api('GET', `/api/notes/bulletin/${eleveId}/${ctx.periodeId}`, COMPTES.directeur);
    expect(b.body.conseil.arrete).toBe(true);
    expect(b.body.conseil.observations).toBe('Test automatise');
  });

  it('refuse a un enseignant d arreter le conseil', async () => {
    const r = await api('PUT', `/api/notes/conseil/${eleveId}/${ctx.periodeId}`,
      COMPTES.maitre, { appreciation: 'insuffisant' });
    expect(r.status).toBe(403);
  });
});
