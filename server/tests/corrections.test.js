import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * CORRECTIONS : erreurs de saisie sur un eleve (identite, tuteurs), retrait
 * de l effectif ou suppression d une inscription faite par erreur, et
 * correction d une classe (nom, niveau). Jamais au prix d un paiement.
 */

let ctx;
const eleves = [];
const classes = [];
const paiements = [];

beforeAll(async () => { ctx = await contexte(); });

afterAll(async () => {
  if (paiements.length) await query(`DELETE FROM paiement WHERE id = ANY($1)`, [paiements]);
  for (const id of eleves) {
    const { rows } = await query(`SELECT tuteur_id FROM eleve_tuteur WHERE eleve_id = $1`, [id]);
    await query(`DELETE FROM eleve WHERE id = $1`, [id]);
    for (const t of rows) {
      await query(`DELETE FROM tuteur WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM eleve_tuteur WHERE tuteur_id = $1)`, [t.tuteur_id]);
    }
  }
  for (const id of classes) await query(`DELETE FROM classe WHERE id = $1`, [id]);
});

async function inscrire(prenom) {
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom, nom: 'Correction', sexe: 'M', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Pere', nom: 'Correction', telephone: `78${Date.now() % 10000000}`, principal: true }],
  });
  eleves.push(r.body.id);
  return r.body;
}

describe('Corriger un eleve', () => {
  it('corrige l identite ; le comptable aussi', async () => {
    const e = await inscrire('Mamadu');
    const r = await api('PUT', `/api/eleves/${e.id}`, COMPTES.comptable, {
      prenom: 'Mamadou', lieu_naissance: 'Rufisque', date_naissance: '2019-05-02',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ prenom: 'Mamadou', lieu_naissance: 'Rufisque' });
  });

  it('refuse d effacer le prenom ou le nom', async () => {
    const r = await api('PUT', `/api/eleves/${eleves[0]}`, COMPTES.admin, { nom: '   ' });
    expect(r.status).toBe(400);
  });

  it('corrige les tuteurs : mise a jour, ajout, retrait', async () => {
    const dossier = await api('GET', `/api/eleves/${eleves[0]}`, COMPTES.admin);
    const pere = dossier.body.tuteurs[0];
    const r = await api('PUT', `/api/eleves/${eleves[0]}/tuteurs`, COMPTES.admin, {
      tuteurs: [
        { id: pere.id, prenom: 'Alioune', nom: 'Correction', telephone: '770000001', lien: 'père' },
        { prenom: 'Awa', nom: 'Diop', telephone: '770000002', lien: 'mère', principal: true },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body.find((t) => t.id === pere.id).prenom).toBe('Alioune');
    expect(r.body.find((t) => t.nom === 'Diop').principal).toBe(true);

    const r2 = await api('PUT', `/api/eleves/${eleves[0]}/tuteurs`, COMPTES.admin, {
      tuteurs: [{ id: pere.id, prenom: 'Alioune', nom: 'Correction', telephone: '770000001' }],
    });
    expect(r2.body).toHaveLength(1);
    expect(r2.body[0].principal).toBe(true);
    // Le tuteur retire, qui ne suivait que cet eleve, est supprime
    const { rows } = await query(`SELECT 1 FROM tuteur WHERE nom = 'Diop' AND telephone = '770000002'`);
    expect(rows).toHaveLength(0);
  });

  it('un tuteur sans nom ni telephone est refuse', async () => {
    const r = await api('PUT', `/api/eleves/${eleves[0]}/tuteurs`, COMPTES.admin, { tuteurs: [{ prenom: 'X' }] });
    expect(r.status).toBe(400);
  });
});

describe('Supprimer un eleve', () => {
  it('supprime definitivement une inscription faite par erreur', async () => {
    const e = await inscrire('Doublon');
    const r = await api('DELETE', `/api/eleves/${e.id}?definitif=1`, COMPTES.admin);
    expect(r.status).toBe(200);
    const { rows } = await query(`SELECT 1 FROM eleve WHERE id = $1`, [e.id]);
    expect(rows).toHaveLength(0);
    // Le compte parent part avec l eleve
    const { rows: comptes } = await query(`SELECT 1 FROM utilisateur WHERE eleve_suivi_id = $1`, [e.id]);
    expect(comptes).toHaveLength(0);
  });

  it('refuse la suppression definitive d un eleve qui a paye', async () => {
    const e = await inscrire('Payeur');
    const p = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: e.id, montant: 1000, mode: 'especes',
    });
    paiements.push(p.body.id);
    const r = await api('DELETE', `/api/eleves/${e.id}?definitif=1`, COMPTES.admin);
    expect(r.status).toBe(409);
    const { rows } = await query(`SELECT 1 FROM paiement WHERE id = $1`, [p.body.id]);
    expect(rows).toHaveLength(1);
  });

  it('retire de l effectif (archive), puis remet dans l effectif', async () => {
    const id = eleves.at(-1);
    expect((await api('DELETE', `/api/eleves/${id}`, COMPTES.admin)).status).toBe(200);
    const { rows } = await query(
      `SELECT e.statut, u.actif FROM eleve e LEFT JOIN utilisateur u ON u.eleve_suivi_id = e.id WHERE e.id = $1`, [id]
    );
    expect(rows[0]).toMatchObject({ statut: 'archive', actif: false });

    expect((await api('PATCH', `/api/eleves/${id}/restaurer`, COMPTES.admin)).status).toBe(200);
    const { rows: apres } = await query(
      `SELECT e.statut, u.actif FROM eleve e LEFT JOIN utilisateur u ON u.eleve_suivi_id = e.id WHERE e.id = $1`, [id]
    );
    expect(apres[0]).toMatchObject({ statut: 'actif', actif: true });
  });

  it('seul l administrateur supprime', async () => {
    expect((await api('DELETE', `/api/eleves/${eleves[0]}`, COMPTES.comptable)).status).toBe(403);
    expect((await api('DELETE', `/api/eleves/${eleves[0]}`, COMPTES.directeur)).status).toBe(403);
  });
});

describe('Corriger une classe', () => {
  it('renomme une classe et corrige son niveau', async () => {
    const c = await api('POST', '/api/scolarite/classes', COMPTES.admin, {
      niveau_id: ctx.classes.ci.niveau_id, libelle: `6eme Erreur ${Date.now()}`,
    });
    classes.push(c.body.id);
    const r = await api('PATCH', `/api/scolarite/classes/${c.body.id}`, COMPTES.admin, {
      libelle: `6eme Corrigee ${Date.now()}`, niveau_id: ctx.classes.sixieme.niveau_id, capacite: 40, salle: 'B2',
    });
    expect(r.status).toBe(200);
    expect(r.body.niveau_modifie).toBe(true);
    const d = await api('GET', `/api/scolarite/classes/${c.body.id}`, COMPTES.admin);
    expect(d.body).toMatchObject({ niveau_id: ctx.classes.sixieme.niveau_id, capacite: 40, salle: 'B2' });
  });

  it('refuse un nom deja pris cette annee', async () => {
    const r = await api('PATCH', `/api/scolarite/classes/${classes[0]}`, COMPTES.admin, {
      libelle: ctx.classes.ci.libelle,
    });
    expect(r.status).toBe(409);
  });

  it('le directeur ne corrige pas une classe du secondaire', async () => {
    const r = await api('PATCH', `/api/scolarite/classes/${classes[0]}`, COMPTES.directeur, { salle: 'X' });
    expect(r.status).toBe(403);
  });

  it('supprime une classe vide ; refuse une classe avec des eleves', async () => {
    expect((await api('DELETE', `/api/scolarite/classes/${ctx.classes.ci.id}`, COMPTES.admin)).status).toBe(400);
    expect((await api('DELETE', `/api/scolarite/classes/${classes[0]}`, COMPTES.admin)).status).toBe(200);
    classes.pop();
  });
});
