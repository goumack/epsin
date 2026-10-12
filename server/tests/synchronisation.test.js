import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { appliquerMigrations } from '../src/db/migrate.js';
import {
  lireChangements, appliquerChangements, instantane, placerSequencesPoste, SEUIL_POSTE,
} from '../src/sync/noyau.js';
import { synchroniser, cloner } from '../src/sync/poste.js';
import { prochainNumeroRecu } from '../src/db/recus.js';
import { chiffrer, dechiffrer } from '../src/securite/chiffrement.js';

/**
 * SYNCHRONISATION POSTE <-> SERVEUR EN LIGNE, sur deux vraies bases.
 *
 * Le site en ligne fait reference : tout le monde y travaille. Le poste de
 * l ecole en garde une copie a jour, sert de secours pendant une coupure,
 * et envoie ce qui y a ete fait des que la connexion revient — sans
 * doublon, sans collision de numeros, sans aller-retour infini.
 */

const url = (nom) => process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${nom}$1`);
const NOMS = { enLigne: 'epsin_test_en_ligne', poste: 'epsin_test_poste' };
let admin, enLigne, poste;

/** Le serveur en ligne vu du poste, sans HTTP : memes operations que les routes. */
const distant = () => ({
  recevoir: async (depuis) => {
    if (depuis > 0) await enLigne.query(`DELETE FROM sync_journal WHERE id <= $1`, [depuis]);
    return lireChangements(enLigne, depuis);
  },
  envoyer: async (changements) => ({ appliques: await appliquerChangements(enLigne, changements) }),
  instantane: () => instantane(enLigne),
});

const un = async (base, sql, params) => (await base.query(sql, params)).rows[0];

/** Execute fn avec EPSIN_MODE donne, puis le retablit. */
async function enMode(mode, fn) {
  const avant = process.env.EPSIN_MODE;
  process.env.EPSIN_MODE = mode;
  try { return await fn(); } finally {
    if (avant === undefined) delete process.env.EPSIN_MODE; else process.env.EPSIN_MODE = avant;
  }
}

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: url('postgres') });
  for (const nom of Object.values(NOMS)) {
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${nom}`);
  }
  enLigne = new pg.Pool({ connectionString: url(NOMS.enLigne) });
  poste = new pg.Pool({ connectionString: url(NOMS.poste) });
  // Comme le poste et le serveur en ligne synchronise : le journal est tenu
  for (const base of [enLigne, poste]) {
    base.on('connect', (client) => client.query(`SET epsin.journal = 'on'`));
  }
  const silence = { journal: () => {} };
  await appliquerMigrations(enLigne, silence);
  await appliquerMigrations(poste, silence);

  // Donnees deja en ligne avant l installation du poste
  await enLigne.query(`INSERT INTO etablissement (nom) VALUES ('EPSIN')`);
  await enLigne.query(`INSERT INTO annee_scolaire (libelle, date_debut, date_fin, active)
                       VALUES ('2026-2027', '2026-10-01', '2027-07-15', true)`);
  await enLigne.query(`INSERT INTO niveau (libelle, cycle, ordre, entite) VALUES ('CI', 'elementaire', 1, 'scolaire')`);
  await enLigne.query(`INSERT INTO classe (annee_id, niveau_id, libelle) VALUES (1, 1, 'CI')`);
  await enLigne.query(`INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-0001', 'Awa', 'Diop')`);
  await enLigne.query(`INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES (1, 1, 1)`);
  await enLigne.query(`INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom, eleve_suivi_id)
                       VALUES ('ep-2026-0001@epsin.sn', 'empreinte-1', 'parent', 'Fatou', 'Diop', 1)`);
  await enLigne.query(`INSERT INTO frais (annee_id, niveau_id, libelle, montant, recurrent, mois_fin)
                       VALUES (1, 1, 'Mensualite', 10000, true, 6)`);
});

afterAll(async () => {
  await enLigne?.end();
  await poste?.end();
  for (const nom of Object.values(NOMS)) await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
  await admin?.end();
});

describe('Premier lancement du poste : copie de la base en ligne', () => {
  it('recupere toutes les donnees, identifiants compris', async () => {
    const compte = await cloner(poste, distant());
    expect(compte.eleve).toBe(1);
    expect(await un(poste, `SELECT prenom FROM eleve WHERE id = 1`)).toEqual({ prenom: 'Awa' });
    expect(await un(poste, `SELECT COUNT(*)::int AS n FROM sync_journal`)).toEqual({ n: 0 });
  });

  it('le poste numerote dans sa propre plage, le site en ligne continue la sienne', async () => {
    const p = await un(poste, `INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-P001', 'Moussa', 'Ba') RETURNING id`);
    expect(p.id).toBe(SEUIL_POSTE + 1);
    const l = await un(enLigne, `INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-0002', 'Ibou', 'Sarr') RETURNING id`);
    expect(l.id).toBe(2);
  });

  it('replacer les sequences est sans effet de bord (a chaque demarrage)', async () => {
    await placerSequencesPoste(poste);
    const t = await un(poste, `INSERT INTO tuteur (prenom, nom, telephone) VALUES ('A', 'B', '770000001') RETURNING id`);
    expect(t.id).toBe(SEUIL_POSTE + 1);
    await poste.query(`DELETE FROM tuteur WHERE id = $1`, [t.id]);
    await placerSequencesPoste(poste);
    const e = await un(poste, `SELECT nextval(pg_get_serial_sequence('eleve', 'id'))::int AS n`);
    expect(e.n).toBe(SEUIL_POSTE + 2);
  });
});

describe('Le personnel travaille en ligne : le poste reste a jour', () => {
  it('recoit ce qui a ete fait en ligne, comptes compris', async () => {
    await enLigne.query(`UPDATE utilisateur SET nom = 'Diop Sow', mot_de_passe = 'empreinte-2' WHERE id = 1`);
    await enLigne.query(`UPDATE classe SET salle = 'Salle 3' WHERE id = 1`);
    const r = await synchroniser(poste, distant());
    expect(r.recus).toBeGreaterThanOrEqual(3);
    expect(await un(poste, `SELECT prenom FROM eleve WHERE id = 2`)).toEqual({ prenom: 'Ibou' });
    expect(await un(poste, `SELECT nom, mot_de_passe FROM utilisateur WHERE id = 1`))
      .toEqual({ nom: 'Diop Sow', mot_de_passe: 'empreinte-2' });
    expect(await un(poste, `SELECT salle FROM classe WHERE id = 1`)).toEqual({ salle: 'Salle 3' });
  });

  it('ce que font les parents en ligne arrive aussi', async () => {
    const pel = await un(enLigne,
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant, statut, transaction_id)
       VALUES ('lien', 1, 1, 1, 1, 10000, 'a_verifier', 'T_PARENT') RETURNING id`);
    await enLigne.query(`INSERT INTO absence (eleve_id, date_abs, type, confirmee, motif_tuteur) VALUES (1, '2026-10-20', 'absence', false, 'Malade')`);
    await synchroniser(poste, distant());
    expect(await un(poste, `SELECT statut, transaction_id FROM paiement_en_ligne WHERE id = $1`, [pel.id]))
      .toEqual({ statut: 'a_verifier', transaction_id: 'T_PARENT' });
    expect(await un(poste, `SELECT motif_tuteur FROM absence WHERE eleve_id = 1`)).toEqual({ motif_tuteur: 'Malade' });
    // Ce qui vient d en ligne ne repart pas en ligne
    expect(await un(poste, `SELECT COUNT(*)::int AS n FROM sync_journal`)).toEqual({ n: 0 });
  });
});

describe('Coupure internet : travail sur le poste, puis retour de la connexion', () => {
  it('envoie tout ce qui a ete fait sur le poste', async () => {
    await poste.query(`INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES ($1, 1, 1)`, [SEUIL_POSTE + 1]);
    await poste.query(`INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, numero_recu, mois_couvert)
                       VALUES ($1, 1, 1, 10000, 'especes', 'REC-2026-P00001', '2027-06')`, [SEUIL_POSTE + 1]);
    await poste.query(`UPDATE eleve SET nom = 'Diop Ndiaye' WHERE id = 1`);

    const r = await synchroniser(poste, distant());
    expect(r.envoyes).toBeGreaterThanOrEqual(3);
    expect(await un(enLigne, `SELECT nom FROM eleve WHERE id = 1`)).toEqual({ nom: 'Diop Ndiaye' });
    expect(await un(enLigne, `SELECT prenom, matricule FROM eleve WHERE id = $1`, [SEUIL_POSTE + 1]))
      .toEqual({ prenom: 'Moussa', matricule: 'EP-2026-P001' });
    expect(await un(enLigne, `SELECT numero_recu, mois_couvert FROM paiement WHERE eleve_id = $1`, [SEUIL_POSTE + 1]))
      .toEqual({ numero_recu: 'REC-2026-P00001', mois_couvert: '2027-06' });
  });

  it('sans aller-retour : le serveur en ligne ne renvoie pas ce qu il a recu', async () => {
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM sync_journal`)).toEqual({ n: 0 });
    const r = await synchroniser(poste, distant());
    expect(r).toEqual({ recus: 0, envoyes: 0 });
  });

  it('inscriptions des deux cotes pendant la coupure : aucune collision', async () => {
    const p = await un(poste, `INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-P002', 'Coupure', 'Poste') RETURNING id`);
    const l = await un(enLigne, `INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-0003', 'Coupure', 'En ligne') RETURNING id`);
    await synchroniser(poste, distant());
    for (const base of [poste, enLigne]) {
      const { rows } = await base.query(`SELECT id FROM eleve WHERE prenom = 'Coupure' ORDER BY id`);
      expect(rows.map((x) => x.id)).toEqual([l.id, p.id]);
    }
  });

  it('une suppression sur le poste est repercutee', async () => {
    await poste.query(`DELETE FROM paiement WHERE numero_recu = 'REC-2026-P00001'`);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM paiement`)).toEqual({ n: 0 });
  });
});

describe('Conflits', () => {
  it('un paiement Wave valide sur le poste ne redevient pas « a verifier »', async () => {
    const pel = await un(poste, `SELECT id FROM paiement_en_ligne LIMIT 1`);
    await poste.query(`UPDATE paiement_en_ligne SET statut = 'reussi' WHERE id = $1`, [pel.id]);
    await enLigne.query(`UPDATE paiement_en_ligne SET statut = 'a_verifier', transaction_id = 'T_BIS' WHERE id = $1`, [pel.id]);

    await synchroniser(poste, distant());
    expect(await un(poste, `SELECT statut FROM paiement_en_ligne WHERE id = $1`, [pel.id])).toEqual({ statut: 'reussi' });
    expect(await un(enLigne, `SELECT statut FROM paiement_en_ligne WHERE id = $1`, [pel.id])).toEqual({ statut: 'reussi' });
  });

  it('une ligne modifiee sur le poste pendant la coupure l emporte', async () => {
    await poste.query(`UPDATE absence SET confirmee = true, justifiee = true WHERE eleve_id = 1`);
    await enLigne.query(`UPDATE absence SET motif_tuteur = 'Rendez-vous' WHERE eleve_id = 1`);
    await synchroniser(poste, distant());
    const p = await un(poste, `SELECT confirmee, motif_tuteur FROM absence WHERE eleve_id = 1`);
    const l = await un(enLigne, `SELECT confirmee, motif_tuteur FROM absence WHERE eleve_id = 1`);
    expect(p).toEqual({ confirmee: true, motif_tuteur: 'Malade' });
    expect(l).toEqual(p);
  });

  it('tables a cle composee (tuteurs d un eleve)', async () => {
    const t = await un(poste, `INSERT INTO tuteur (prenom, nom, telephone) VALUES ('Fatou', 'Diop', '770000000') RETURNING id`);
    await poste.query(`INSERT INTO eleve_tuteur (eleve_id, tuteur_id, lien, principal) VALUES (1, $1, 'mere', true)`, [t.id]);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT lien FROM eleve_tuteur WHERE eleve_id = 1 AND tuteur_id = $1`, [t.id])).toEqual({ lien: 'mere' });
    await poste.query(`DELETE FROM eleve_tuteur WHERE eleve_id = 1 AND tuteur_id = $1`, [t.id]);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM eleve_tuteur`)).toEqual({ n: 0 });
  });
});

describe('Numeros et fiches communs aux deux cotes', () => {
  it('le poste a sa propre serie de recus', async () => {
    await enLigne.query(`INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, numero_recu)
                         VALUES (1, 1, 1, 10000, 'especes', 'REC-2026-00007')`);
    await synchroniser(poste, distant());
    const date = new Date('2026-11-02');
    const client = await poste.connect();
    try {
      await client.query('BEGIN');
      expect(await enMode('poste', () => prochainNumeroRecu(client, date))).toBe('REC-2026-P00001');
      expect(await enMode('replique', () => prochainNumeroRecu(client, date))).toBe('REC-2026-00008');
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('une fiche d acces creee en ligne se reimprime sur le poste', () => {
    const avant = { jwt: process.env.JWT_SECRET, jeton: process.env.SYNC_JETON };
    try {
      process.env.SYNC_JETON = 'jeton-commun-0123456789abcdef';
      process.env.JWT_SECRET = 'secret-du-site-en-ligne';
      const chiffre = chiffrer('K7MP-4QXR');
      process.env.JWT_SECRET = 'secret-du-poste';
      expect(dechiffrer(chiffre)).toBe('K7MP-4QXR');
    } finally {
      for (const [cle, val] of [['JWT_SECRET', avant.jwt], ['SYNC_JETON', avant.jeton]]) {
        if (val === undefined) delete process.env[cle]; else process.env[cle] = val;
      }
    }
  });
});
