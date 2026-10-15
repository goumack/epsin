import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * CAS SOCIAL : un eleve pris en charge par l etablissement ne doit aucun
 * frais ; il sort des impayes et des relances. Ce qu il verse est classe en
 * « Autres recettes », pas en recettes de scolarite.
 */

let ctx;
let eleve;
let moisSuivi;

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom: 'Cas', nom: 'Social', sexe: 'M', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Tuteur', nom: 'Social', telephone: '770005544', principal: true }],
  });
  eleve = r.body;
  moisSuivi = (await api('GET', '/api/finances/suivi-mois', COMPTES.comptable)).body.mois_disponibles[0];
});

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

const situation = async () => (await api('GET', `/api/finances/situation/${eleve.id}`, COMPTES.comptable)).body;
const declarer = (corps, compte = COMPTES.admin) => api('PATCH', `/api/eleves/${eleve.id}/cas-social`, compte, corps);

describe('Declaration', () => {
  it('reservee a l administrateur, motif obligatoire', async () => {
    expect((await declarer({ cas_social: true, motif: 'Orphelin' }, COMPTES.comptable)).status).toBe(403);
    expect((await declarer({ cas_social: true })).status).toBe(400);
    const r = await declarer({ cas_social: true, motif: 'Orphelin' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cas_social: true, cas_social_motif: 'Orphelin' });
  });
});

describe('Un cas social ne doit rien', () => {
  it('situation : rien de du, rien a payer', async () => {
    const s = await situation();
    expect(s.eleve.cas_social).toBe(true);
    expect(s.total_du).toBe(0);
    expect(s.reste).toBe(0);
  });

  it('absent des impayes, « cas social » dans le suivi du mois', async () => {
    const impayes = (await api('GET', '/api/finances/impayes', COMPTES.comptable)).body;
    expect(impayes.some((e) => e.id === eleve.id)).toBe(false);
    const suivi = (await api('GET', `/api/finances/suivi-mois?mois=${moisSuivi}`, COMPTES.comptable)).body;
    const ligne = suivi.classes.flatMap((c) => c.eleves).find((e) => e.id === eleve.id);
    expect(ligne.statut).toBe('cas_social');
  });
});

describe('Ses versements sont des « Autres recettes »', () => {
  it('une contribution volontaire est encaissee et classee a part', async () => {
    const avant = (await api('GET', '/api/finances/synthese', COMPTES.comptable)).body;
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes', elements: [{ montant: 2000 }],
    });
    expect(r.status).toBe(201);
    const { rows } = await query(`SELECT categorie FROM paiement WHERE eleve_id = $1`, [eleve.id]);
    expect(rows.map((x) => x.categorie)).toEqual(['autres_recettes']);
    const apres = (await api('GET', '/api/finances/synthese', COMPTES.comptable)).body;
    expect(apres.autres_recettes - avant.autres_recettes).toBe(2000);
    expect(apres.recettes_scolarite).toBe(avant.recettes_scolarite);
  });

  it('le recu indique la prise en charge', async () => {
    const { rows: [p] } = await query(`SELECT id FROM paiement WHERE eleve_id = $1`, [eleve.id]);
    const recu = (await api('GET', `/api/finances/recus/${p.id}`, COMPTES.comptable)).body;
    expect(recu.situation.cas_social).toBe(true);
  });
});

describe('Fin de la prise en charge', () => {
  it('l eleve doit de nouveau ses frais ; ses versements passes restent en autres recettes', async () => {
    expect((await declarer({ cas_social: false })).status).toBe(200);
    const s = await situation();
    expect(s.eleve.cas_social).toBe(false);
    expect(s.total_du).toBeGreaterThan(0);
    const { rows } = await query(`SELECT categorie FROM paiement WHERE eleve_id = $1`, [eleve.id]);
    expect(rows.every((x) => x.categorie === 'autres_recettes')).toBe(true);
  });
});
