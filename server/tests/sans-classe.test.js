import { describe, it, expect, afterAll } from 'vitest';
import { api, COMPTES } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * ELEVES SANS CLASSE : hors des inscrits du tableau de bord, mais signales
 * a part et retrouvables dans la liste des eleves (filtre « Sans classe »).
 */

let eleve;

afterAll(async () => {
  if (eleve?.id) await query(`DELETE FROM eleve WHERE id = $1`, [eleve.id]);
});

describe('Eleves sans classe', () => {
  it('compte a part au tableau de bord et filtre dans la liste', async () => {
    const avant = (await api('GET', '/api/tableau-bord', COMPTES.admin)).body.effectifs;
    const r = await api('POST', '/api/eleves', COMPTES.admin, { prenom: 'Sans', nom: 'Classe', sexe: 'M' });
    expect(r.status).toBe(201);
    eleve = r.body;

    const apres = (await api('GET', '/api/tableau-bord', COMPTES.admin)).body.effectifs;
    expect(apres.total).toBe(avant.total);
    expect(apres.sans_classe).toBe(avant.sans_classe + 1);

    const liste = (await api('GET', '/api/eleves?classe_id=aucune&taille=100', COMPTES.admin)).body;
    expect(liste.donnees.some((e) => e.id === eleve.id)).toBe(true);
    expect(liste.donnees.every((e) => !e.classe)).toBe(true);
  });
});
