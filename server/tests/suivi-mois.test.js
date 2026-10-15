import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * SUIVI DU MOIS : pour la caisse, classe par classe, qui a paye la
 * mensualite d un mois et qui reste a relancer.
 */

let ctx;
let eleve;
let premierMois;

const suivi = async (mois) => {
  const r = await api('GET', `/api/finances/suivi-mois?mois=${mois}`, COMPTES.comptable);
  expect(r.status).toBe(200);
  const classe = r.body.classes.find((c) => c.id === ctx.classes.ci.id);
  return { corps: r.body, ligne: classe?.eleves.find((e) => e.id === eleve.id) };
};

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom: 'Suivi', nom: 'Mensuel', sexe: 'F', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Awa', nom: 'Mensuel', telephone: '770007766', principal: true }],
  });
  eleve = r.body;
  premierMois = (await api('GET', '/api/finances/suivi-mois', COMPTES.comptable)).body.mois_disponibles[0];
});

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

describe('Suivi du mois', () => {
  it('un eleve qui n a rien paye est a relancer, avec le contact du tuteur', async () => {
    const { corps, ligne } = await suivi(premierMois);
    expect(corps.mois).toBe(premierMois);
    expect(ligne).toMatchObject({ statut: 'non_paye', tuteur: 'Awa Mensuel', telephone: '770007766' });
    expect(ligne.reste).toBe(ligne.du);
    expect(ligne.mois_retard).toEqual([premierMois]);
  });

  it('une fois le mois encaisse, il passe « paye »', async () => {
    const { rows: [f] } = await query(
      `SELECT id FROM frais WHERE annee_id = $1 AND recurrent AND obligatoire AND montant > 0
         AND (niveau_id IS NULL OR niveau_id = $2) ORDER BY id`,
      [ctx.anneeId, ctx.classes.ci.niveau_id]
    );
    const { rows: tous } = await query(
      `SELECT COUNT(*)::int AS n FROM frais WHERE annee_id = $1 AND recurrent AND obligatoire AND montant > 0
         AND (niveau_id IS NULL OR niveau_id = $2)`,
      [ctx.anneeId, ctx.classes.ci.niveau_id]
    );
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes', elements: [{ frais_id: f.id, nb_mois: 1 }],
    });
    expect(r.status).toBe(201);
    const { ligne } = await suivi(premierMois);
    // Une seule mensualite obligatoire : le mois est regle ; sinon partiel
    expect(ligne.statut).toBe(tous[0].n === 1 ? 'paye' : 'partiel');
  });

  it('un mois hors de l annee est ramene dans l annee', async () => {
    const r = await api('GET', '/api/finances/suivi-mois?mois=1990-01', COMPTES.comptable);
    expect(r.body.mois).toBe(r.body.mois_disponibles[0]);
  });
});
