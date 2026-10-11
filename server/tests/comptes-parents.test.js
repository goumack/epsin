import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';
import { motDePasseTemporaire } from '../src/db/comptes-parents.js';

/**
 * COMPTES PARENTS : crees a l inscription, avec un mot de passe a usage
 * unique remis sur une fiche, et a changer avant toute autre action.
 */

let ctx;
let eleve;          // inscrit par le test
let fiche;          // { identifiant, mot_de_passe } renvoyes a l inscription
const eleves = [];

/** Connexion avec un mot de passe explicite ; renvoie la reponse brute. */
const connecter = (identifiant, mot_de_passe) => request(app)
  .post('/api/auth/connexion').send({ identifiant, mot_de_passe });
const avecJeton = (methode, chemin, jeton, corps) => {
  const r = request(app)[methode](chemin).set('Authorization', `Bearer ${jeton}`);
  return corps ? r.send(corps) : r;
};

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.directeur, {
    prenom: 'Test', nom: 'Fiche Acces', sexe: 'F', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Parent', nom: 'Fiche Acces', telephone: `77${Date.now() % 10000000}`, principal: true }],
  });
  eleve = r.body;
  fiche = r.body.compte_parent;
  eleves.push(eleve.id);
});

afterAll(async () => {
  for (const id of eleves) {
    // Le compte parent part avec l eleve (ON DELETE CASCADE)
    await query(`DELETE FROM inscription WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve_tuteur WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve WHERE id = $1`, [id]);
  }
});

describe('Unitaire : mot de passe temporaire', () => {
  it('8 caracteres lisibles en deux blocs, sans 0/O ni 1/I/L', () => {
    for (let i = 0; i < 200; i++) {
      expect(motDePasseTemporaire()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    }
  });

  it('change a chaque tirage', () => {
    const tirages = new Set(Array.from({ length: 50 }, motDePasseTemporaire));
    expect(tirages.size).toBe(50);
  });
});

describe('Inscription : le compte parent nait avec l eleve', () => {
  it('l inscription renvoie la fiche d acces, une seule fois', () => {
    expect(fiche.identifiant).toBe(`${eleve.matricule.toLowerCase()}@epsin.sn`);
    expect(fiche.mot_de_passe).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('le mot de passe n est pas stocke en clair', async () => {
    const { rows } = await query(
      `SELECT mot_de_passe, doit_changer_mdp FROM utilisateur WHERE eleve_suivi_id = $1`, [eleve.id]
    );
    expect(rows[0].mot_de_passe).not.toContain(fiche.mot_de_passe);
    expect(rows[0].doit_changer_mdp).toBe(true);
  });

  it('la direction voit l etat du compte dans le dossier', async () => {
    const r = await api('GET', `/api/eleves/${eleve.id}`, COMPTES.directeur);
    expect(r.body.compte_parent).toMatchObject({ identifiant: fiche.identifiant, doit_changer_mdp: true });
  });
});

describe('Premiere connexion : changer le mot de passe avant tout', () => {
  let jeton;
  const personnel = 'MonSecret2026';

  it('la fiche permet de se connecter, compte marque « a changer »', async () => {
    const r = await connecter(fiche.identifiant, fiche.mot_de_passe);
    expect(r.status).toBe(200);
    expect(r.body.utilisateur.doit_changer_mdp).toBe(true);
    jeton = r.body.token;
  });

  it('le serveur refuse tout le reste tant que le mot de passe n est pas change', async () => {
    const r = await avecJeton('get', '/api/eleves', jeton);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MOT_DE_PASSE_A_CHANGER');
    expect((await avecJeton('get', '/api/finances/recus', jeton)).status).toBe(403);
    // ... sauf de se reconnaitre
    expect((await avecJeton('get', '/api/auth/moi', jeton)).status).toBe(200);
  });

  it('refuse de garder le mot de passe de la fiche', async () => {
    const r = await avecJeton('post', '/api/auth/mot-de-passe', jeton, {
      ancien: fiche.mot_de_passe, nouveau: fiche.mot_de_passe,
    });
    expect(r.status).toBe(400);
  });

  it('une fois change, le compte est pleinement utilisable', async () => {
    const r = await avecJeton('post', '/api/auth/mot-de-passe', jeton, {
      ancien: fiche.mot_de_passe, nouveau: personnel,
    });
    expect(r.status).toBe(200);
    const eleves = await avecJeton('get', '/api/eleves', jeton);
    expect(eleves.status).toBe(200);
    expect(eleves.body.donnees.map((e) => e.id)).toEqual([eleve.id]);
    // L ancien mot de passe de la fiche ne marche plus
    expect((await connecter(fiche.identifiant, fiche.mot_de_passe)).status).toBe(401);
  });

  it('une nouvelle fiche remplace le mot de passe et impose un nouveau changement', async () => {
    const r = await api('POST', `/api/eleves/${eleve.id}/compte-parent`, COMPTES.directeur, {});
    expect(r.status).toBe(200);
    expect(r.body.cree).toBe(false);
    expect(r.body.mot_de_passe).not.toBe(fiche.mot_de_passe);

    expect((await connecter(fiche.identifiant, personnel)).status).toBe(401);
    const c = await connecter(fiche.identifiant, r.body.mot_de_passe);
    expect(c.status).toBe(200);
    expect(c.body.utilisateur.doit_changer_mdp).toBe(true);
  });
});

describe('Fiche d acces : qui peut la generer', () => {
  it('cree le compte d un eleve qui n en a pas (inscrit avant cette fonction)', async () => {
    await query(`DELETE FROM utilisateur WHERE eleve_suivi_id = $1`, [eleve.id]);
    const r = await api('POST', `/api/eleves/${eleve.id}/compte-parent`, COMPTES.directeur, {});
    expect(r.status).toBe(201);
    expect(r.body.cree).toBe(true);
    expect(r.body.identifiant).toBe(fiche.identifiant);
  });

  it('refusee hors de l entite, a un enseignant, a un parent', async () => {
    const chemin = `/api/eleves/${eleve.id}/compte-parent`;
    expect((await api('POST', chemin, COMPTES.proviseur, {})).status).toBe(403);
    expect((await api('POST', chemin, COMPTES.maitre, {})).status).toBe(403);
    const parent = `${ctx.eleveCI.matricule.toLowerCase()}@epsin.sn`;
    expect((await api('POST', chemin, parent, {})).status).toBe(403);
  });

  it('permise au comptable, qui inscrit souvent a la caisse', async () => {
    const dossier = await api('GET', `/api/eleves/${eleve.id}`, COMPTES.comptable);
    expect(dossier.body.compte_parent).toMatchObject({ identifiant: fiche.identifiant });
    const r = await api('POST', `/api/eleves/${eleve.id}/compte-parent`, COMPTES.comptable, {});
    expect(r.status).toBe(200);
    expect(r.body.mot_de_passe).toBeTruthy();
  });
});
