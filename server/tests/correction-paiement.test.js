import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * CORRECTION D UN ENCAISSEMENT : rien n est modifie ni efface. Les lignes
 * encaissees par erreur sont annulees (avec motif, auteur, date) — une
 * seule ligne d un recu si besoin — puis le bon montant est re-encaisse.
 */

let ctx;
let eleve;
let ponctuel;
let mensualite;

beforeAll(async () => {
  ctx = await contexte();
  const r = await api('POST', '/api/eleves', COMPTES.admin, {
    prenom: 'Correction', nom: 'Essai', sexe: 'F', classe_id: ctx.classes.ci.id,
    tuteurs: [{ prenom: 'Tuteur', nom: 'Correction', telephone: '770001199', principal: true }],
  });
  eleve = r.body;
  const { rows: f } = await query(
    `SELECT id, montant, recurrent FROM frais
     WHERE annee_id = $1 AND (niveau_id IS NULL OR niveau_id = $2) AND montant > 0 AND obligatoire ORDER BY id`,
    [ctx.anneeId, ctx.classes.ci.niveau_id]
  );
  ponctuel = f.find((x) => !x.recurrent);
  mensualite = f.find((x) => x.recurrent);
});

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

describe('Correction d un encaissement', () => {
  let recu;

  it('encaissement de l inscription avec deux mois au lieu d un', async () => {
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes',
      elements: [
        { frais_id: ponctuel.id, montant: Number(ponctuel.montant) },
        { frais_id: mensualite.id, nb_mois: 2 },
      ],
    });
    expect(r.status).toBe(201);
    recu = (await api('GET', `/api/finances/recus/${r.body.id}`, COMPTES.comptable)).body;
    expect(recu.lignes).toHaveLength(3);
  });

  it('le motif est obligatoire', async () => {
    const r = await api('PATCH', `/api/finances/paiements/${recu.lignes[0].id}/annuler`, COMPTES.comptable, {});
    expect(r.status).toBe(400);
  });

  it('une ligne d un autre recu est refusee', async () => {
    const { rows: [autre] } = await query(`SELECT id FROM paiement WHERE eleve_id <> $1 AND NOT annule LIMIT 1`, [eleve.id]);
    const r = await api('PATCH', `/api/finances/paiements/${recu.lignes[0].id}/annuler`, COMPTES.comptable,
      { ids: [autre.id], motif: 'Erreur' });
    expect(r.status).toBe(400);
    const { rows: [intacte] } = await query(`SELECT annule FROM paiement WHERE id = $1`, [autre.id]);
    expect(intacte.annule).toBe(false);
  });

  it('annule seulement le mois en trop, avec motif et auteur', async () => {
    const enTrop = recu.lignes.filter((l) => l.mois).at(-1);
    const r = await api('PATCH', `/api/finances/paiements/${recu.lignes[0].id}/annuler`, COMPTES.comptable,
      { ids: [enTrop.id], motif: 'Mois encaisse par erreur' });
    expect(r.status).toBe(200);
    expect(r.body.ecritures).toBe(1);

    const apres = (await api('GET', `/api/finances/recus/${recu.lignes[0].id}`, COMPTES.comptable)).body;
    const ligne = apres.lignes.find((l) => l.id === enTrop.id);
    expect(ligne).toMatchObject({ annule: true, motif_annulation: 'Mois encaisse par erreur' });
    expect(ligne.annule_par).toBeTruthy();
    expect(apres.annule).toBe(false);
    expect(apres.total).toBe(recu.total - enTrop.montant);

    // Historique : le recu reste, marque corrige, montant a jour
    const liste = (await api('GET', `/api/finances/recus?eleve_id=${eleve.id}`, COMPTES.comptable)).body;
    expect(liste[0]).toMatchObject({ annule: false, annule_en_partie: true });
    expect(Number(liste[0].montant)).toBe(apres.total);
  });

  it('le mois annule redevient a payer et se re-encaisse', async () => {
    const r = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes', elements: [{ frais_id: mensualite.id, nb_mois: 1 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.numero_recu).not.toBe(recu.numeros[0]);
  });
});
