import { describe, it, expect } from 'vitest';
import { api, COMPTES, contexte } from './aides.js';
import { query } from '../src/db/pool.js';

/**
 * SUPPRESSION DEFINITIVE : l eleve disparait du systeme comme s il n avait
 * jamais existe — donnees, journal d audit, notifications. Seule reste une
 * ligne anonyme « suppression definitive » (qui, quand).
 */

describe('Suppression definitive', () => {
  it('ne laisse aucune trace de l eleve', async () => {
    const ctx = await contexte();
    const r = await api('POST', '/api/eleves', COMPTES.admin, {
      prenom: 'Disparu', nom: 'Totalement', sexe: 'M', classe_id: ctx.classes.ci.id,
      tuteurs: [{ prenom: 'Tuteur', nom: 'Disparu', telephone: '770004411', principal: true }],
    });
    const eleve = r.body;
    const { rows: [f] } = await query(
      `SELECT id, montant FROM frais WHERE annee_id = $1 AND NOT recurrent AND montant > 0
         AND (niveau_id IS NULL OR niveau_id = $2) LIMIT 1`,
      [ctx.anneeId, ctx.classes.ci.niveau_id]
    );
    const p = await api('POST', '/api/finances/paiements', COMPTES.comptable, {
      eleve_id: eleve.id, mode: 'especes', elements: [{ frais_id: f.id, montant: Number(f.montant) }],
    });
    expect(p.status).toBe(201);
    // Une notification du personnel qui le cite
    await query(
      `INSERT INTO notification (utilisateur_id, type, titre, contenu)
       SELECT id, 'paiement', 'Paiement Wave a verifier', $1 FROM utilisateur WHERE email = 'admin@epsin.sn'`,
      [`Disparu Totalement (${eleve.matricule}) : 10000 FCFA`]
    );

    const d = await api('DELETE', `/api/eleves/${eleve.id}?definitif=1&historique=1&confirmation=${eleve.matricule}`, COMPTES.admin);
    expect(d.status).toBe(200);

    const reste = async (sql, params) => (await query(sql, params)).rows[0].n;
    expect(await reste(`SELECT COUNT(*)::int AS n FROM eleve WHERE id = $1`, [eleve.id])).toBe(0);
    expect(await reste(`SELECT COUNT(*)::int AS n FROM paiement WHERE id = $1`, [p.body.id])).toBe(0);
    expect(await reste(
      `SELECT COUNT(*)::int AS n FROM journal_audit
       WHERE (entite = 'eleve' AND entite_id = $1) OR (entite = 'paiement' AND entite_id = $2)
          OR details->>'eleve_id' = $1::text`,
      [eleve.id, p.body.id]
    )).toBe(0);
    expect(await reste(`SELECT COUNT(*)::int AS n FROM notification WHERE contenu LIKE '%' || $1 || '%'`,
      [eleve.matricule])).toBe(0);
    // La suppression elle-meme reste tracee, anonymement
    const { rows: [trace] } = await query(
      `SELECT entite_id, details FROM journal_audit WHERE action = 'suppression_definitive' ORDER BY id DESC LIMIT 1`
    );
    expect(trace.entite_id).toBeNull();
    expect(JSON.stringify(trace.details || {})).not.toContain('Disparu');
  });
});
