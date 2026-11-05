import { describe, it, expect, afterAll } from 'vitest';
import { api, COMPTES } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * COMMUNICATION AU PERSONNEL : une annonce « Personnel » ou un message
 * « Tout le personnel » atteint chaque membre (comptable, direction,
 * enseignants), jamais les parents ni les eleves.
 */

const MARQUE = `Test personnel ${Date.now()}`;
let annonceId;

afterAll(async () => {
  if (annonceId) await query(`DELETE FROM annonce WHERE id = $1`, [annonceId]);
  await query(`DELETE FROM message WHERE objet = $1`, [MARQUE]);
  await query(`DELETE FROM notification WHERE titre = $1 OR contenu = $1`, [MARQUE]);
});

const rolesNotifies = async (condition) => (await query(
  `SELECT DISTINCT u.role::text AS role FROM notification n JOIN utilisateur u ON u.id = n.utilisateur_id
   WHERE ${condition} AND n.lien = '/communication'`, [MARQUE]
)).rows.map((r) => r.role);

describe('Communication au personnel', () => {
  it('une annonce « personnel » notifie et s affiche pour tout le personnel', async () => {
    const r = await api('POST', '/api/communication/annonces', COMPTES.directeur,
      { titre: MARQUE, contenu: 'Reunion du personnel', cible: 'personnel' });
    expect(r.status).toBe(201);
    annonceId = r.body.id;

    const roles = await rolesNotifies('n.titre = $1');
    expect(roles).toEqual(expect.arrayContaining(['admin', 'comptable', 'enseignant']));
    expect(roles).not.toContain('parent');
    expect(roles).not.toContain('eleve');

    const vue = (await api('GET', '/api/communication/annonces', COMPTES.comptable)).body;
    expect(vue.some((a) => a.id === annonceId)).toBe(true);
  });

  it('un message « tout le personnel » arrive a chacun', async () => {
    const r = await api('POST', '/api/communication/messages', COMPTES.admin,
      { destinataire_id: 'personnel', objet: MARQUE, contenu: MARQUE });
    expect(r.status).toBe(201);
    expect(r.body.envoyes).toBeGreaterThan(1);

    const roles = (await query(
      `SELECT DISTINCT u.role::text AS role FROM notification n JOIN utilisateur u ON u.id = n.utilisateur_id
       WHERE n.contenu = $1 AND n.lien = '/communication?onglet=messages'`, [MARQUE]
    )).rows.map((x) => x.role);
    expect(roles).toEqual(expect.arrayContaining(['comptable', 'enseignant']));
    expect(roles).not.toContain('parent');

    const recus = (await api('GET', '/api/communication/messages', COMPTES.comptable)).body;
    expect(recus.some((m) => m.objet === MARQUE)).toBe(true);
  });
});
