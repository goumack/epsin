import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index.js';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * EQUIPE PEDAGOGIQUE : la direction cree ses enseignants, les affecte aux
 * matieres d une classe, designe le professeur principal et, a
 * l elementaire, le maitre titulaire.
 *
 * Ces tests modifient l equipe de classes de la demonstration : l etat
 * d origine est releve avant et restaure apres.
 */

let ctx;
const comptesCrees = [];   // utilisateur.id des enseignants crees
let origine;               // equipe d origine, restauree en fin de test

const unique = Date.now();
const connecter = (identifiant, mot_de_passe) => request(app)
  .post('/api/auth/connexion').send({ identifiant, mot_de_passe });

beforeAll(async () => {
  ctx = await contexte();
  const { rows: pp } = await query(
    `SELECT id, prof_principal_id FROM classe WHERE id = ANY($1)`,
    [[ctx.classes.sixieme.id, ctx.classes.cp.id]]
  );
  const { rows: affectations } = await query(
    `SELECT enseignant_id, classe_id, matiere_id, annee_id FROM affectation WHERE classe_id = ANY($1)`,
    [[ctx.classes.sixieme.id, ctx.classes.cp.id]]
  );
  const { rows: maitre } = await query(
    `SELECT classe_id, enseignant_id, annee_id FROM classe_maitre WHERE classe_id = $1`,
    [ctx.classes.cp.id]
  );
  origine = { pp, affectations, maitre };
});

afterAll(async () => {
  const classes = [ctx.classes.sixieme.id, ctx.classes.cp.id];
  await query(`DELETE FROM affectation WHERE classe_id = ANY($1)`, [classes]);
  for (const a of origine.affectations) {
    await query(
      `INSERT INTO affectation (enseignant_id, classe_id, matiere_id, annee_id) VALUES ($1,$2,$3,$4)`,
      [a.enseignant_id, a.classe_id, a.matiere_id, a.annee_id]
    );
  }
  await query(`DELETE FROM classe_maitre WHERE classe_id = $1`, [ctx.classes.cp.id]);
  for (const m of origine.maitre) {
    await query(`INSERT INTO classe_maitre (classe_id, enseignant_id, annee_id) VALUES ($1,$2,$3)`,
      [m.classe_id, m.enseignant_id, m.annee_id]);
  }
  for (const c of origine.pp) {
    await query(`UPDATE classe SET prof_principal_id = $2 WHERE id = $1`, [c.id, c.prof_principal_id]);
  }
  if (comptesCrees.length) await query(`DELETE FROM utilisateur WHERE id = ANY($1)`, [comptesCrees]);
});

/** Cree un enseignant et memorise son compte pour le nettoyage. */
async function creer(compte, corps) {
  const r = await api('POST', '/api/scolarite/enseignants', compte, corps);
  if (r.body?.utilisateur_id) comptesCrees.push(r.body.utilisateur_id);
  return r;
}

describe('Creation des enseignants par la direction', () => {
  it('le proviseur cree un professeur, rattache d office au secondaire', async () => {
    const r = await creer(COMPTES.proviseur, {
      prenom: 'Prof', nom: `Test${unique}`, email: `prof.test${unique}@epsin.sn`,
      specialite: 'Mathematiques', entite: 'scolaire',   // ignore : pas admin
    });
    expect(r.status).toBe(201);
    expect(r.body.entite).toBe('secondaire');
    expect(r.body.compte.identifiant).toBe(`prof.test${unique}@epsin.sn`);
    expect(r.body.compte.mot_de_passe).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // La fiche permet de se connecter, mot de passe a changer
    const c = await connecter(r.body.compte.identifiant, r.body.compte.mot_de_passe);
    expect(c.status).toBe(200);
    expect(c.body.utilisateur.doit_changer_mdp).toBe(true);

    // Le proviseur le voit dans sa liste ; le directeur non
    const pro = await api('GET', '/api/scolarite/enseignants', COMPTES.proviseur);
    expect(pro.body.some((e) => e.id === r.body.id)).toBe(true);
    const dir = await api('GET', '/api/scolarite/enseignants', COMPTES.directeur);
    expect(dir.body.some((e) => e.id === r.body.id)).toBe(false);
  });

  it('le directeur cree un maitre, connecte par son telephone', async () => {
    const r = await creer(COMPTES.directeur, {
      prenom: 'Maitre', nom: `Test${unique}`, telephone: `70${unique % 10000000}`,
    });
    expect(r.status).toBe(201);
    expect(r.body.entite).toBe('scolaire');
    expect(r.body.compte.identifiant).toBe(`70${unique % 10000000}`);
  });

  it('refuse sans identifiant, en doublon, ou a qui n est pas de la direction', async () => {
    expect((await creer(COMPTES.proviseur, { prenom: 'A', nom: 'B' })).status).toBe(400);
    expect((await creer(COMPTES.proviseur, {
      prenom: 'A', nom: 'B', email: `prof.test${unique}@epsin.sn`,
    })).status).toBe(409);
    expect((await creer(COMPTES.censeur, { prenom: 'A', nom: 'B', email: `x${unique}@epsin.sn` })).status).toBe(403);
    expect((await creer(COMPTES.professeur, { prenom: 'A', nom: 'B', email: `y${unique}@epsin.sn` })).status).toBe(403);
    // L administrateur doit choisir l entite
    expect((await creer(COMPTES.admin, { prenom: 'A', nom: 'B', email: `z${unique}@epsin.sn` })).status).toBe(400);
  });

  it('une nouvelle fiche d acces remplace le mot de passe', async () => {
    const { rows } = await query(
      `SELECT en.id FROM enseignant en JOIN utilisateur u ON u.id = en.utilisateur_id
       WHERE u.email = $1`, [`prof.test${unique}@epsin.sn`]
    );
    const r = await api('POST', `/api/scolarite/enseignants/${rows[0].id}/acces`, COMPTES.proviseur, {});
    expect(r.status).toBe(200);
    expect((await connecter(r.body.identifiant, r.body.mot_de_passe)).status).toBe(200);
    // Le directeur ne gere pas les professeurs du secondaire
    expect((await api('POST', `/api/scolarite/enseignants/${rows[0].id}/acces`, COMPTES.directeur, {})).status).toBe(403);
  });
});

describe('Affectations et professeur principal au secondaire', () => {
  let prof;
  let matiere;

  beforeAll(async () => {
    const { rows } = await query(
      `SELECT en.id, en.utilisateur_id FROM enseignant en JOIN utilisateur u ON u.id = en.utilisateur_id
       WHERE u.email = $1`, [`prof.test${unique}@epsin.sn`]
    );
    prof = rows[0];
    const { rows: m } = await query(
      `SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1 ORDER BY matiere_id LIMIT 1`,
      [ctx.classes.sixieme.niveau_id]
    );
    matiere = m[0].matiere_id;
  });

  it('l equipe liste toutes les matieres du niveau, meme sans professeur', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM matiere_niveau WHERE niveau_id = $1`, [ctx.classes.sixieme.niveau_id]
    );
    const r = await api('GET', `/api/scolarite/classes/${ctx.classes.sixieme.id}/enseignants`, COMPTES.proviseur);
    expect(r.body).toHaveLength(rows[0].n);
  });

  it('affecte, remplace puis retire un professeur', async () => {
    const a = await api('POST', '/api/scolarite/affectations', COMPTES.proviseur, {
      classe_id: ctx.classes.sixieme.id, matiere_id: matiere, enseignant_id: prof.id,
    });
    expect(a.status).toBe(201);
    let equipe = await api('GET', `/api/scolarite/classes/${ctx.classes.sixieme.id}/enseignants`, COMPTES.proviseur);
    const ligne = equipe.body.find((x) => x.matiere_id === matiere);
    expect(ligne.enseignant_id).toBe(prof.id);

    const d = await api('DELETE', `/api/scolarite/affectations/${ligne.affectation_id}`, COMPTES.proviseur);
    expect(d.status).toBe(200);
    equipe = await api('GET', `/api/scolarite/classes/${ctx.classes.sixieme.id}/enseignants`, COMPTES.proviseur);
    expect(equipe.body.find((x) => x.matiere_id === matiere).enseignant_id).toBeNull();
  });

  it('refuse une matiere hors programme, et l autre entite', async () => {
    const { rows: horsProgramme } = await query(
      `SELECT id FROM matiere WHERE id NOT IN (SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1) LIMIT 1`,
      [ctx.classes.sixieme.niveau_id]
    );
    if (horsProgramme[0]) {
      expect((await api('POST', '/api/scolarite/affectations', COMPTES.proviseur, {
        classe_id: ctx.classes.sixieme.id, matiere_id: horsProgramme[0].id, enseignant_id: prof.id,
      })).status).toBe(400);
    }
    expect((await api('POST', '/api/scolarite/affectations', COMPTES.directeur, {
      classe_id: ctx.classes.sixieme.id, matiere_id: matiere, enseignant_id: prof.id,
    })).status).toBe(403);
  });

  it('designe le professeur principal, mais jamais un parent ni un maitre', async () => {
    const chemin = `/api/scolarite/classes/${ctx.classes.sixieme.id}/professeur-principal`;
    const ok = await api('PATCH', chemin, COMPTES.proviseur, { utilisateur_id: prof.utilisateur_id });
    expect(ok.status).toBe(200);
    const classe = await api('GET', `/api/scolarite/classes/${ctx.classes.sixieme.id}`, COMPTES.proviseur);
    expect(classe.body.pp_id).toBe(prof.utilisateur_id);

    const { rows: parent } = await query(`SELECT id FROM utilisateur WHERE role = 'parent' LIMIT 1`);
    expect((await api('PATCH', chemin, COMPTES.proviseur, { utilisateur_id: parent[0].id })).status).toBe(400);
    const { rows: maitre } = await query(
      `SELECT utilisateur_id FROM enseignant WHERE entite = 'scolaire' LIMIT 1`
    );
    expect((await api('PATCH', chemin, COMPTES.proviseur, { utilisateur_id: maitre[0].utilisateur_id })).status).toBe(400);
  });
});

describe('Maitre titulaire a l elementaire', () => {
  it('pose le maitre, ses domaines et le titre de professeur principal en une fois', async () => {
    const { rows } = await query(
      `SELECT en.id, en.utilisateur_id FROM enseignant en JOIN utilisateur u ON u.id = en.utilisateur_id
       WHERE u.telephone = $1`, [`70${unique % 10000000}`]
    );
    const maitre = rows[0];
    const r = await api('PUT', `/api/scolarite/classes/${ctx.classes.cp.id}/maitre`, COMPTES.directeur, {
      enseignant_id: maitre.id,
    });
    expect(r.status).toBe(200);

    const classe = await api('GET', `/api/scolarite/classes/${ctx.classes.cp.id}`, COMPTES.directeur);
    expect(classe.body.maitre_id).toBe(maitre.id);
    expect(classe.body.pp_id).toBe(maitre.utilisateur_id);
    const equipe = await api('GET', `/api/scolarite/classes/${ctx.classes.cp.id}/enseignants`, COMPTES.directeur);
    expect(equipe.body.length).toBeGreaterThan(0);
    expect(equipe.body.every((a) => a.enseignant_id === maitre.id)).toBe(true);
  });

  it('refuse au secondaire, et hors de l entite', async () => {
    expect((await api('PUT', `/api/scolarite/classes/${ctx.classes.sixieme.id}/maitre`, COMPTES.proviseur, {
      enseignant_id: null,
    })).status).toBe(400);
    expect((await api('PUT', `/api/scolarite/classes/${ctx.classes.cp.id}/maitre`, COMPTES.proviseur, {
      enseignant_id: null,
    })).status).toBe(403);
  });
});
