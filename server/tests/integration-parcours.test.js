import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * TESTS D INTEGRATION — parcours pluriannuel et finances.
 *
 * Ces tests ECRIVENT en base (decisions de fin d annee). Chacun nettoie
 * derriere lui pour que la suite reste rejouable indefiniment.
 */

let ctx;
beforeAll(async () => { ctx = await contexte(); });

describe('Parcours pluriannuel', () => {
  it('retrace toutes les annees d un eleve, de la plus recente', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleve6eme.id}`, COMPTES.admin);
    expect(r.status).toBe(200);
    expect(r.body.annees.length).toBeGreaterThanOrEqual(2);

    const dates = r.body.annees.map((a) => new Date(a.date_debut).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('porte pour chaque annee la classe, les moyennes et l assiduite', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleve6eme.id}`, COMPTES.admin);
    const passee = r.body.annees.find((a) => !a.active);
    expect(passee.classe).toBeTruthy();
    expect(passee.niveau).toBeTruthy();
    expect(passee.assiduite).toBeTruthy();
    expect(passee.finances).toBeTruthy();
    expect(Array.isArray(passee.periodes)).toBe(true);
  });

  it('montre une progression de niveau d une annee a la suivante', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleve6eme.id}`, COMPTES.admin);
    const ordres = r.body.annees.map((a) => a.niveau_ordre);
    // Du plus recent au plus ancien : les ordres doivent decroitre
    for (let i = 1; i < ordres.length; i++) {
      expect(ordres[i]).toBeLessThan(ordres[i - 1]);
    }
  });

  it('rend la decision de fin d annee en clair', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleve6eme.id}`, COMPTES.admin);
    const passee = r.body.annees.find((a) => a.decision);
    expect(passee?.decision_libelle).toBeTruthy();
  });

  it('applique le cloisonnement au parcours', async () => {
    const r = await api('GET', `/api/parcours/eleve/${ctx.eleveCP.id}`, COMPTES.maitre);
    // Le maitre de CI ne voit aucune annee d un eleve de CP
    expect(r.body.annees ?? []).toHaveLength(0);
  });
});

describe('Feuille de fin d annee', () => {
  it('propose passe au-dessus de 10, redouble en dessous', async () => {
    const r = await api('GET', `/api/parcours/fin-annee/${ctx.classes.ci.id}`, COMPTES.directeur);
    expect(r.status).toBe(200);

    for (const e of r.body.eleves) {
      if (e.moyenne == null) {
        // Sans moyenne, aucune proposition n est faite
        expect(e.decision).toBeNull();
      } else if (Number(e.moyenne) >= 10) {
        expect(e.decision).toBe('passe');
      } else {
        expect(e.decision).toBe('redouble');
      }
    }
  });

  it('identifie le niveau suivant', async () => {
    const r = await api('GET', `/api/parcours/fin-annee/${ctx.classes.ci.id}`, COMPTES.directeur);
    expect(r.body.niveau_suivant?.libelle).toBe('CP');
  });

  it('refuse la feuille d une classe hors entite', async () => {
    const r = await api('GET', `/api/parcours/fin-annee/${ctx.classes.ci.id}`, COMPTES.proviseur);
    expect(r.status).toBe(403);
  });
});

describe('Decision de fin d annee', () => {
  let inscriptionId;
  let eleveId;

  beforeAll(async () => {
    const r = await api('GET', `/api/parcours/fin-annee/${ctx.classes.ci.id}`, COMPTES.directeur);
    inscriptionId = r.body.eleves[0].inscription_id;
    eleveId = r.body.eleves[0].eleve_id;
  });

  afterAll(async () => {
    // Remise a l etat initial : ces tests ecrivent en base
    await query(
      `UPDATE inscription SET decision = NULL, motif_sortie = NULL,
              statut = 'inscrit', decide_par = NULL, decide_le = NULL
       WHERE id = $1`, [inscriptionId]
    );
    await query(`UPDATE eleve SET statut = 'actif' WHERE id = $1`, [eleveId]);
  });

  it('enregistre un passage et clot l inscription', async () => {
    const r = await api('PATCH', `/api/parcours/decision/${inscriptionId}`,
      COMPTES.directeur, { decision: 'passe' });
    expect(r.status).toBe(200);
    expect(r.body.decision).toBe('passe');
    expect(r.body.statut).toBe('termine');
  });

  it('un transfert sort l eleve des effectifs actifs', async () => {
    const r = await api('PATCH', `/api/parcours/decision/${inscriptionId}`,
      COMPTES.directeur, { decision: 'parti', motif_sortie: 'Demenagement' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('transfere');

    const { rows } = await query(`SELECT statut FROM eleve WHERE id = $1`, [eleveId]);
    expect(rows[0].statut).toBe('parti');
  });

  it('refuse une decision inconnue', async () => {
    const r = await api('PATCH', `/api/parcours/decision/${inscriptionId}`,
      COMPTES.directeur, { decision: 'promu' });
    expect(r.status).toBe(400);
  });

  it('refuse au proviseur une decision sur l elementaire', async () => {
    const r = await api('PATCH', `/api/parcours/decision/${inscriptionId}`,
      COMPTES.proviseur, { decision: 'redouble' });
    expect(r.status).toBe(403);
  });
});

describe('Finances', () => {
  it('rend une situation coherente : du = paye + reste', async () => {
    const r = await api('GET', `/api/finances/situation/${ctx.eleveCI.id}`, COMPTES.comptable);
    expect(r.status).toBe(200);
    const { total_du, total_paye, reste } = r.body;
    expect(Number(total_du) - Number(total_paye)).toBeCloseTo(Number(reste), 2);
  });

  it('detaille les frais ligne par ligne', async () => {
    const r = await api('GET', `/api/finances/situation/${ctx.eleveCI.id}`, COMPTES.comptable);
    expect(Array.isArray(r.body.lignes)).toBe(true);
    for (const l of r.body.lignes) {
      expect(Number(l.du) - Number(l.paye)).toBeCloseTo(Number(l.reste), 2);
    }
  });

  it('le comptable voit les impayes des deux entites', async () => {
    const r = await api('GET', '/api/finances/impayes', COMPTES.comptable);
    expect(r.status).toBe(200);
  });

  it('refuse les finances a un enseignant', async () => {
    const r = await api('GET', '/api/finances/synthese', COMPTES.maitre);
    expect(r.status).toBe(403);
  });
});
