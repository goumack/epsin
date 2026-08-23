import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { api, COMPTES } from './aides.js';

/**
 * TESTS DE FUMEE — la verification rapide avant tout le reste.
 *
 * Si l un d eux echoue, inutile de lancer la suite complete : quelque chose
 * de fondamental est casse (base injoignable, route disparue, comptes de
 * demonstration absents).
 */

describe('Fumee : le serveur repond', () => {
  it('expose un point de sante', async () => {
    const r = await request(app).get('/api/sante');
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('ok');
  });

  it('rend une erreur nommee sur une route inconnue', async () => {
    // Le routeur des modules est monte sur /api et exige un jeton : une
    // route inconnue sous /api repond donc 401 avant d atteindre le 404.
    // Hors de /api, le 404 est direct.
    const sousApi = await request(app).get('/api/inexistant');
    expect([401, 404]).toContain(sousApi.status);
    expect(sousApi.body.erreur).toBeTruthy();

    const horsApi = await request(app).get('/inexistant');
    expect(horsApi.status).toBe(404);
    expect(horsApi.body.erreur).toBeTruthy();
  });
});

describe('Fumee : les comptes de demonstration fonctionnent', () => {
  for (const [role, identifiant] of Object.entries(COMPTES)) {
    it(`connecte le compte ${role}`, async () => {
      const r = await request(app)
        .post('/api/auth/connexion')
        .send({ identifiant, mot_de_passe: 'epsin2026' });
      expect(r.status).toBe(200);
      expect(r.body.token).toBeTruthy();
    });
  }

  it('refuse un mauvais mot de passe', async () => {
    const r = await request(app)
      .post('/api/auth/connexion')
      .send({ identifiant: COMPTES.admin, mot_de_passe: 'faux' });
    expect(r.status).toBe(401);
  });
});

describe('Fumee : les ecrans principaux repondent', () => {
  const routes = [
    ['/api/tableau-bord', 'tableau de bord'],
    ['/api/eleves?taille=5', 'eleves'],
    ['/api/scolarite/classes', 'classes'],
    ['/api/scolarite/matieres', 'matieres'],
    ['/api/scolarite/niveaux', 'niveaux'],
    ['/api/scolarite/periodes', 'periodes'],
    ['/api/vie-scolaire/absences', 'absences'],
    ['/api/finances/impayes', 'impayes'],
    ['/api/communication/annonces', 'annonces'],
    ['/api/personnel/demandes-absence', 'demandes d absence'],
  ];

  for (const [route, nom] of routes) {
    it(`sert ${nom}`, async () => {
      const r = await api('GET', route, COMPTES.admin);
      expect(r.status).toBe(200);
    });
  }
});

describe('Fumee : les donnees de demonstration sont presentes', () => {
  it('contient des eleves, des classes et des notes', async () => {
    const eleves = await api('GET', '/api/eleves?taille=1', COMPTES.admin);
    expect(eleves.body.total).toBeGreaterThan(0);

    const classes = await api('GET', '/api/scolarite/classes', COMPTES.admin);
    expect(classes.body.length).toBeGreaterThan(0);

    const bord = await api('GET', '/api/tableau-bord', COMPTES.admin);
    expect(bord.body.effectifs.total).toBeGreaterThan(0);
  });
});
