import { describe, it, expect, beforeAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';

/**
 * TESTS DE CONTRAT — la forme des reponses de l API.
 *
 * Le client React consomme des champs precis : renommer `detail_partiel`
 * ou supprimer `synthese.rang` casserait l interface sans qu aucun test
 * fonctionnel ne s en apercoive. On fige donc la forme, pas les valeurs.
 */

let ctx;
beforeAll(async () => { ctx = await contexte(); });

/** Verifie que l objet porte toutes les cles attendues. */
function aLesCles(objet, cles) {
  const manquantes = cles.filter((c) => !(c in objet));
  expect(manquantes, `cles manquantes : ${manquantes.join(', ')}`).toHaveLength(0);
}

describe('Contrat : connexion', () => {
  it('rend l utilisateur sous la cle attendue par le client', async () => {
    const r = await api('GET', '/api/auth/moi', COMPTES.admin);
    expect(r.status).toBe(200);
    aLesCles(r.body, ['utilisateur']);
    aLesCles(r.body.utilisateur, ['id', 'email', 'role', 'prenom', 'nom']);
  });

  it('expose eleve_suivi_id pour un compte parent', async () => {
    // Le portail tuteur s appuie sur ce champ pour savoir quel enfant afficher
    const r = await api('GET', '/api/auth/moi', `${ctx.eleveCI.matricule.toLowerCase()}@epsin.sn`);
    expect(r.status).toBe(200);
    expect(r.body.utilisateur.eleve_suivi_id).toBe(ctx.eleveCI.id);
  });
});

describe('Contrat : liste des eleves', () => {
  it('rend une page avec donnees et total', async () => {
    const r = await api('GET', '/api/eleves?taille=5', COMPTES.admin);
    aLesCles(r.body, ['donnees', 'total']);
    expect(Array.isArray(r.body.donnees)).toBe(true);
    aLesCles(r.body.donnees[0], ['id', 'matricule', 'prenom', 'nom', 'classe']);
  });
});

describe('Contrat : bulletin', () => {
  let b;
  beforeAll(async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    b = r.body;
  });

  it('porte les quatre blocs attendus', () => {
    aLesCles(b, ['etablissement', 'eleve', 'conseil', 'matieres', 'synthese', 'detail_partiel']);
  });

  it('chaque matiere porte les colonnes du modele officiel', () => {
    aLesCles(b.matieres[0], [
      'id', 'matiere', 'coefficient', 'moyenne',
      'moyenne_devoir', 'moyenne_composition',
      'points', 'rang', 'appreciation',
    ]);
  });

  it('la synthese porte moyenne, rang et assiduite', () => {
    aLesCles(b.synthese, [
      'moyenne', 'total_coefficients', 'rang', 'effectif',
      'moyenne_classe', 'mention', 'absences', 'retards',
    ]);
  });

  it('l en-tete porte les mentions administratives', () => {
    aLesCles(b.etablissement, ['nom', 'inspection_academie', 'inspection_ief']);
    aLesCles(b.eleve, ['matricule', 'classe', 'effectif_classe', 'redoublants_classe']);
  });
});

describe('Contrat : parcours', () => {
  it('rend l eleve et ses annees', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleve6eme.id}`, COMPTES.admin);
    aLesCles(r.body, ['eleve', 'annees']);
    aLesCles(r.body.annees[0], [
      'annee', 'classe', 'niveau', 'periodes',
      'moyenne_annuelle', 'assiduite', 'finances', 'decision',
    ]);
  });
});

describe('Contrat : erreurs', () => {
  it('rend une erreur nommee, pas une pile technique', async () => {
    const r = await api('GET', '/api/eleves/999999', COMPTES.admin);
    expect([403, 404]).toContain(r.status);
    expect(typeof r.body.erreur).toBe('string');
    expect(r.body.erreur.length).toBeGreaterThan(0);
  });

  it('refuse sans jeton', async () => {
    const request = (await import('supertest')).default;
    const app = (await import('../src/index.js')).default;
    const r = await request(app).get('/api/eleves');
    expect(r.status).toBe(401);
    expect(r.body.erreur).toBeTruthy();
  });
});
