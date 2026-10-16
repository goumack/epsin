import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * MATRICE DES PAIEMENTS : frais d inscription et mois de l annee, eleve
 * par eleve, et le total du a ce jour qui alimente le rappel au parent.
 */

let ctx;
let eleve;

const ligne = async () => {
  const r = await api('GET', `/api/finances/matrice?classe_id=${ctx.classes.ci.id}`, COMPTES.comptable);
  expect(r.status).toBe(200);
  return { corps: r.body, e: r.body.classes[0].eleves.find((x) => x.id === eleve.id) };
};

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom: 'Matrice', nom: 'Essai', sexe: 'M', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Tuteur', nom: 'Matrice', telephone: '770003322', principal: true }],
  });
  eleve = r.body;
});

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

describe('Matrice des paiements', () => {
  it('un eleve sans paiement : inscription due, mois commences en retard', async () => {
    const { corps, e } = await ligne();
    expect(corps.mois.length).toBeGreaterThan(0);
    expect(corps.classes).toHaveLength(1);
    const commences = corps.mois.filter((m) => m <= corps.mois_courant && e.mois[m]);
    for (const m of commences) expect(e.mois[m].statut).toBe('en_retard');
    expect(e.mois_en_retard.map((x) => x.mois)).toEqual(commences);
    const retardMois = e.mois_en_retard.reduce((s, x) => s + x.reste, 0);
    expect(e.exigible).toBe(e.inscription.reste + retardMois);
  });

  it('un mois paye passe au vert et sort du rappel', async () => {
    const { rows: [f] } = await query(
      `SELECT id FROM frais WHERE annee_id = $1 AND recurrent AND obligatoire AND montant > 0
         AND (niveau_id IS NULL OR niveau_id = $2) ORDER BY id LIMIT 1`,
      [ctx.anneeId, ctx.classes.ci.niveau_id]
    );
    const { rows: [n] } = await query(
      `SELECT COUNT(*)::int AS n FROM frais WHERE annee_id = $1 AND recurrent AND obligatoire AND montant > 0
         AND (niveau_id IS NULL OR niveau_id = $2)`,
      [ctx.anneeId, ctx.classes.ci.niveau_id]
    );
    const avant = (await ligne()).e;
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes', elements: [{ frais_id: f.id, nb_mois: 1 }],
    });
    expect(r.status).toBe(201);
    const { corps, e } = await ligne();
    const premier = corps.mois.find((m) => e.mois[m]);
    expect(e.mois[premier].statut).toBe(n.n === 1 ? 'paye' : 'partiel');
    expect(e.exigible).toBe(avant.exigible - r.body.montant);
  });
});
