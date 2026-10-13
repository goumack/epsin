import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';
import { deduireEnCours, etatDesMois, resteAnnee } from '../src/metier/mensualites.js';

/**
 * CONTROLES : rien ne se paie deux fois. Un mois deja regle, un frais unique
 * deja solde, un mois declare par le parent sur Wave et en cours de
 * verification ne peuvent plus etre encaisses — au guichet comme par Wave.
 *
 * Sur un eleve cree pour l occasion, sans aucun paiement.
 */

let ctx;
let eleve;
let mensualite;
let ponctuel;

const encaisser = (corps) => api('POST', '/api/finances/paiements', COMPTES.comptable,
  { eleve_id: eleve.id, mode: 'especes', ...corps });
const echeancier = async () => (await api('GET', `/api/finances/echeancier/${eleve.id}`, COMPTES.comptable))
  .body.find((f) => f.id === mensualite.id);

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom: 'Controle', nom: 'Paiements', sexe: 'M', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Tuteur', nom: 'Controle', telephone: '770009988', principal: true }],
  });
  eleve = r.body;
  const { rows: f } = await query(
    `SELECT id, libelle, montant, recurrent FROM frais
     WHERE annee_id = $1 AND (niveau_id IS NULL OR niveau_id = $2) AND montant > 0 AND obligatoire
     ORDER BY recurrent DESC, id`,
    [ctx.anneeId, ctx.classes.ci.niveau_id]
  );
  mensualite = f.find((x) => x.recurrent);
  ponctuel = f.find((x) => !x.recurrent);
});

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

describe('Frais unique (droit d inscription, blouse...)', () => {
  it('se paie une fois ; un second paiement est refuse', async () => {
    if (!ponctuel) return;
    const premier = await encaisser({ elements: [{ frais_id: ponctuel.id, montant: Number(ponctuel.montant) }] });
    expect(premier.status).toBe(201);
    const second = await encaisser({ elements: [{ frais_id: ponctuel.id, montant: 1 }] });
    expect(second.status).toBe(409);
    expect(second.body.erreur).toMatch(/déjà réglé/);
  });
});

describe('Mensualite', () => {
  it('refuse un montant superieur au reste de l annee', async () => {
    const e = await echeancier();
    const reste = e.mois.reduce((s, m) => s + m.reste_du, 0);
    const r = await encaisser({ elements: [{ frais_id: mensualite.id, montant: reste + 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.erreur).toMatch(/il ne reste que/);
  });

  it('refuse d encaisser un mois que le parent a declare par Wave', async () => {
    const montant = Number(mensualite.montant);
    const { rows: [pel] } = await query(
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant, statut)
       VALUES ('lien', $1, $2, $3, 1, $4, 'a_verifier') RETURNING id`,
      [eleve.id, mensualite.id, ctx.anneeId, montant]
    );
    const e = await echeancier();
    expect(e.en_verification).toBe(montant);
    const nbMois = e.mois.filter((m) => m.reste_du > 0).length;
    const r = await encaisser({ elements: [{ frais_id: mensualite.id, nb_mois: nbMois }] });
    expect(r.status).toBe(409);
    expect(r.body.erreur).toMatch(/Wave/);
    // Les autres mois restent encaissables
    const autres = await encaisser({ elements: [{ frais_id: mensualite.id, nb_mois: nbMois - 1 }] });
    expect(autres.status).toBe(201);

    // Le mois laisse au parent se valide normalement : l annee est soldee
    const validation = await api('POST', `/api/paiements-en-ligne/${pel.id}/valider`, COMPTES.comptable, {});
    expect(validation.status).toBe(200);
    expect(validation.body.recus).toHaveLength(1);
    expect((await echeancier()).mois.every((m) => m.statut === 'paye')).toBe(true);
  });

  it('une fois l annee reglee, plus rien ne s encaisse', async () => {
    const r = await encaisser({ elements: [{ frais_id: mensualite.id, montant: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.erreur).toMatch(/toute l'année est déjà réglée/);
  });
});

describe('Validation Wave apres un reglement au guichet', () => {
  it('signale le trop-percu ; la caisse peut le garder en avance', async () => {
    const montant = Number(mensualite.montant);
    const { rows: [pel] } = await query(
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant, statut)
       VALUES ('lien', $1, $2, $3, 1, $4, 'a_verifier') RETURNING id`,
      [eleve.id, mensualite.id, ctx.anneeId, montant]
    );
    const refus = await api('POST', `/api/paiements-en-ligne/${pel.id}/valider`, COMPTES.comptable, {});
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('TROP_PERCU');
    const force = await api('POST', `/api/paiements-en-ligne/${pel.id}/valider`, COMPTES.comptable, { forcer: true });
    expect(force.status).toBe(200);
    expect(force.body.statut).toBe('reussi');
  });
});

describe('Regles de calcul', () => {
  it('une declaration en cours couvre les mois dans l ordre', () => {
    const etat = etatDesMois(['2026-10', '2026-11', '2026-12'], 10000, [], new Date('2026-11-15'));
    const e = deduireEnCours(etat, 15000);
    expect(e.map((m) => [m.statut, m.reste_du])).toEqual([
      ['en_verification', 0], ['en_retard', 5000], ['a_venir', 10000],
    ]);
    expect(resteAnnee(e)).toBe(15000);
  });
});
