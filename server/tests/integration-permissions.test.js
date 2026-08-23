import { describe, it, expect, beforeAll } from 'vitest';
import { api, COMPTES, contexte, compteTuteur } from './aides.js';

/**
 * TESTS D INTEGRATION — le cloisonnement, de bout en bout.
 *
 * Routes reelles, base reelle, middlewares reels : on verifie que le serveur
 * REFUSE, pas seulement que l interface masque. C est ici que les
 * regressions coutent le plus cher.
 */

let ctx;
beforeAll(async () => { ctx = await contexte(); });

describe('Cloisonnement entre entites', () => {
  it('le directeur ne voit que l elementaire', async () => {
    const r = await api('GET', '/api/scolarite/classes', COMPTES.directeur);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((c) => c.entite === 'scolaire')).toBe(true);
  });

  it('le proviseur ne voit que le moyen et secondaire', async () => {
    const r = await api('GET', '/api/scolarite/classes', COMPTES.proviseur);
    expect(r.status).toBe(200);
    expect(r.body.every((c) => c.entite === 'secondaire')).toBe(true);
  });

  it('le censeur est cloisonne comme le proviseur, pas transverse', async () => {
    // Erreur corrigee en cours de projet : le censeur avait acces a tout.
    const r = await api('GET', '/api/scolarite/classes', COMPTES.censeur);
    expect(r.status).toBe(200);
    expect(r.body.every((c) => c.entite === 'secondaire')).toBe(true);
  });

  it('refuse au directeur une classe du secondaire', async () => {
    const r = await api('GET', `/api/scolarite/classes/${ctx.classes.sixieme.id}`, COMPTES.directeur);
    expect(r.status).toBe(403);
  });

  it('refuse au proviseur une classe de l elementaire', async () => {
    const r = await api('GET', `/api/scolarite/classes/${ctx.classes.ci.id}`, COMPTES.proviseur);
    expect(r.status).toBe(403);
  });

  it('laisse l admin voir les deux entites', async () => {
    const r = await api('GET', '/api/scolarite/classes', COMPTES.admin);
    const entites = new Set(r.body.map((c) => c.entite));
    expect(entites.has('scolaire')).toBe(true);
    expect(entites.has('secondaire')).toBe(true);
  });
});

describe('Portee d un enseignant', () => {
  it('le maitre ne voit QUE sa classe, pas toute son entite', async () => {
    const r = await api('GET', '/api/scolarite/classes', COMPTES.maitre);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].libelle).toBe('CI A');
  });

  it('refuse au maitre un eleve d une autre classe', async () => {
    const r = await api('GET', `/api/eleves/${ctx.eleveCP.id}`, COMPTES.maitre);
    expect(r.status).toBe(403);
  });

  it('autorise le maitre sur son propre eleve', async () => {
    const r = await api('GET', `/api/eleves/${ctx.eleveCI.id}`, COMPTES.maitre);
    expect(r.status).toBe(200);
    expect(r.body.classe).toBe('CI A');
  });

  it('limite le professeur a ses propres matieres dans un bulletin', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleve6eme.id}/${ctx.periodeId}`, COMPTES.professeur
    );
    expect(r.status).toBe(200);
    expect(r.body.detail_partiel).toBe(true);
    // prof1 enseigne les mathematiques : il ne doit voir que cette ligne
    expect(r.body.matieres.every((m) => /Math/i.test(m.matiere))).toBe(true);
  });

  it('le maitre voit TOUS les domaines de sa classe (il les enseigne tous)', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.maitre
    );
    expect(r.status).toBe(200);
    expect(r.body.detail_partiel).toBe(false);
    expect(r.body.matieres.length).toBeGreaterThan(1);
  });

  it('ne montre a l enseignant que sa propre fiche', async () => {
    // Fuite corrigee : un maitre voyait le trombinoscope de ses collegues.
    const r = await api('GET', '/api/scolarite/enseignants', COMPTES.maitre);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('ne montre a l enseignant que ses propres matieres', async () => {
    const r = await api('GET', '/api/scolarite/matieres', COMPTES.professeur);
    expect(r.status).toBe(200);
    expect(r.body.every((m) => /Math/i.test(m.libelle))).toBe(true);
  });
});

describe('Portee d un tuteur', () => {
  let tuteur;
  beforeAll(() => { tuteur = compteTuteur(ctx.eleveCI.matricule); });

  it('se connecte avec le matricule de son enfant', async () => {
    const r = await api('GET', '/api/eleves?taille=50', tuteur);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.donnees[0].id).toBe(ctx.eleveCI.id);
  });

  it('refuse le dossier d un autre eleve', async () => {
    const r = await api('GET', `/api/eleves/${ctx.eleveCP.id}`, tuteur);
    expect(r.status).toBe(403);
  });

  it('refuse le bulletin d un autre eleve', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCP.id}/${ctx.periodeId}`, tuteur
    );
    expect(r.status).toBe(403);
  });

  it('refuse le classement nominatif de la classe', async () => {
    // Le rang de son enfant figure au bulletin, sans exposer les camarades.
    const r = await api(
      'GET', `/api/notes/classement/${ctx.classes.ci.id}/${ctx.periodeId}`, tuteur
    );
    expect(r.status).toBe(403);
  });

  it('refuse la situation financiere d un autre eleve', async () => {
    const r = await api('GET', `/api/finances/situation/${ctx.eleveCP.id}`, tuteur);
    expect(r.status).toBe(403);
  });

  it('ne montre que les enseignants de son enfant', async () => {
    const r = await api('GET', '/api/scolarite/enseignants', tuteur);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.length).toBeLessThan(5);
  });
});

describe('Habilitations sur les conges du personnel', () => {
  it('le censeur ne statue pas sur les conges', async () => {
    // Il encadre la vie scolaire, mais les conges relevent du chef.
    const r = await api('GET', '/api/personnel/demandes-absence/en-attente', COMPTES.censeur);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });

  it('le directeur voit les demandes de son entite', async () => {
    const r = await api('GET', '/api/personnel/demandes-absence', COMPTES.directeur);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});
