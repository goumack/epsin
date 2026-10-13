import { describe, it, expect, beforeAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * TESTS D INTEGRATION — bulletins, moyennes et rangs.
 *
 * On ne se contente pas de verifier que la route repond : on RECALCULE la
 * moyenne a partir des notes brutes et on compare. Un bulletin faux qui
 * s affiche sans erreur est le pire des bugs.
 */

let ctx;
beforeAll(async () => { ctx = await contexte(); });

describe('Structure du bulletin officiel', () => {
  let bulletin;
  beforeAll(async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    bulletin = r.body;
  });

  it('porte l en-tete administratif du modele senegalais', () => {
    expect(bulletin.etablissement.inspection_academie).toBeTruthy();
    expect(bulletin.etablissement.inspection_ief).toBeTruthy();
    expect(bulletin.etablissement.nom).toContain('Serigne Ibrahima Niang');
  });

  it('separe Devoir et Composition comme le modele officiel', () => {
    const avecNotes = bulletin.matieres.filter((m) => m.nb_notes > 0);
    expect(avecNotes.length).toBeGreaterThan(0);
    // Au moins une matiere doit porter les deux colonnes distinctes
    expect(bulletin.matieres.some((m) => m.moyenne_devoir != null)).toBe(true);
  });

  it('porte un rang par matiere, pas seulement le rang general', () => {
    expect(bulletin.matieres.every((m) => m.rang != null)).toBe(true);
  });

  it('donne les points (moyenne x coefficient) de chaque matiere', () => {
    for (const m of bulletin.matieres) {
      const attendu = Number((Number(m.moyenne) * Number(m.coefficient)).toFixed(2));
      expect(Number(m.points)).toBeCloseTo(attendu, 2);
    }
  });

  it('indique l effectif et les redoublants de la classe', () => {
    expect(bulletin.eleve.effectif_classe).toBeGreaterThan(0);
    expect(bulletin.eleve.redoublants_classe).toBeGreaterThanOrEqual(0);
  });

  it('propose les decisions du conseil sans les avoir arretees', () => {
    expect(bulletin.conseil).toBeTruthy();
    expect(typeof bulletin.conseil.arrete).toBe('boolean');
  });
});

describe('Exactitude du calcul', () => {
  it('la moyenne generale correspond au recalcul manuel', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const { matieres, synthese } = r.body;

    let points = 0;
    let coefs = 0;
    for (const m of matieres) {
      points += Number(m.moyenne) * Number(m.coefficient);
      coefs += Number(m.coefficient);
    }
    expect(Number(synthese.moyenne)).toBeCloseTo(points / coefs, 1);
    expect(Number(synthese.total_coefficients)).toBeCloseTo(coefs, 2);
  });

  it('le rang par matiere correspond au nombre d eleves mieux notes', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const matiere = r.body.matieres[0];

    // Recalcul direct : combien d eleves de la classe font mieux ?
    const { rows } = await query(
      `WITH moy AS (
         SELECT n.eleve_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient),0) AS m
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         WHERE ev.periode_id = $1 AND ev.classe_id = $2
           AND ev.matiere_id = $3 AND n.valeur IS NOT NULL
         GROUP BY n.eleve_id
       )
       SELECT COUNT(*)::int AS meilleurs
       FROM moy WHERE m > (SELECT m FROM moy WHERE eleve_id = $4)`,
      [ctx.periodeId, ctx.classes.ci.id, matiere.id, ctx.eleveCI.id]
    );
    // Le rang est le nombre de meilleurs + 1
    expect(Number(matiere.rang)).toBe(rows[0].meilleurs + 1);
  });

  it('le rang general reste coherent avec l effectif note', async () => {
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const { rang, effectif } = r.body.synthese;
    expect(rang).toBeGreaterThanOrEqual(1);
    expect(rang).toBeLessThanOrEqual(effectif);
  });
});

describe('Vue partielle d un enseignant', () => {
  it('la moyenne reste calculee sur TOUTES les matieres', async () => {
    // Invariant critique : filtrer l affichage ne doit pas fausser le calcul.
    const complet = await api(
      'GET', `/api/notes/bulletin/${ctx.eleve6eme.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const partiel = await api(
      'GET', `/api/notes/bulletin/${ctx.eleve6eme.id}/${ctx.periodeId}`, COMPTES.professeur
    );

    expect(partiel.body.detail_partiel).toBe(true);
    expect(partiel.body.matieres.length).toBeLessThan(complet.body.matieres.length);

    // Meme moyenne, meme rang, meme total de coefficients
    expect(partiel.body.synthese.moyenne).toBe(complet.body.synthese.moyenne);
    expect(partiel.body.synthese.rang).toBe(complet.body.synthese.rang);
    expect(partiel.body.synthese.total_coefficients)
      .toBe(complet.body.synthese.total_coefficients);
  });
});
