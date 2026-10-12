import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { appliquerMigrations } from '../src/db/migrate.js';
import {
  lireChangements, appliquerChangements, instantane, preparerServeur, SEUIL_EN_LIGNE,
} from '../src/sync/noyau.js';
import { synchroniser, cloner } from '../src/sync/poste.js';

/**
 * SYNCHRONISATION POSTE <-> SERVEUR EN LIGNE, sur deux vraies bases.
 *
 * Le poste de l ecole fait foi et travaille sans internet ; en ligne, seuls
 * les parents agissent. Quand la connexion revient, chaque cote recoit ce
 * que l autre a fait, sans doublon ni aller-retour infini.
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
  preparer: () => preparerServeur(enLigne),
});

const un = async (base, sql, params) => (await base.query(sql, params)).rows[0];

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: url('postgres') });
  for (const nom of Object.values(NOMS)) {
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${nom}`);
  }
  enLigne = new pg.Pool({ connectionString: url(NOMS.enLigne) });
  poste = new pg.Pool({ connectionString: url(NOMS.poste) });
  // Comme le poste et le serveur en mode copie : le journal est tenu
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

  it('les nouveaux identifiants du poste suivent ceux copies', async () => {
    const e = await un(poste, `INSERT INTO eleve (matricule, prenom, nom) VALUES ('EP-2026-0002', 'Moussa', 'Ba') RETURNING id`);
    expect(e.id).toBe(2);
  });

  it('les lignes creees en ligne partent au-dela d un milliard', async () => {
    const n = await un(enLigne, `INSERT INTO notification (utilisateur_id, type, titre) VALUES (1, 'test', 'x') RETURNING id`);
    expect(n.id).toBeGreaterThan(SEUIL_EN_LIGNE);
    await enLigne.query(`DELETE FROM notification WHERE id = $1`, [n.id]);
  });
});

describe('Travail hors ligne sur le poste, puis connexion', () => {
  it('envoie tout ce qui a ete fait sur le poste', async () => {
    // L eleve 2 a ete inscrit plus haut ; on encaisse et on corrige un nom
    await poste.query(`INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES (2, 1, 1)`);
    await poste.query(`INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, numero_recu, mois_couvert)
                       VALUES (2, 1, 1, 10000, 'especes', 'REC-2026-00001', '2027-06')`);
    await poste.query(`UPDATE eleve SET nom = 'Diop Ndiaye' WHERE id = 1`);

    const r = await synchroniser(poste, distant());
    expect(r.envoyes).toBeGreaterThanOrEqual(4);
    expect(await un(enLigne, `SELECT nom FROM eleve WHERE id = 1`)).toEqual({ nom: 'Diop Ndiaye' });
    expect(await un(enLigne, `SELECT numero_recu, mois_couvert FROM paiement WHERE eleve_id = 2`))
      .toEqual({ numero_recu: 'REC-2026-00001', mois_couvert: '2027-06' });
  });

  it('sans aller-retour : le serveur en ligne ne renvoie pas ce qu il a recu', async () => {
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM sync_journal`)).toEqual({ n: 0 });
    const r = await synchroniser(poste, distant());
    expect(r).toEqual({ recus: 0, envoyes: 0 });
  });

  it('une suppression sur le poste est repercutee', async () => {
    await poste.query(`DELETE FROM paiement WHERE numero_recu = 'REC-2026-00001'`);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM paiement`)).toEqual({ n: 0 });
  });
});

describe('Ce que les parents font en ligne arrive sur le poste', () => {
  it('declaration Wave, absence signalee, nouveau mot de passe', async () => {
    const pel = await un(enLigne,
      `INSERT INTO paiement_en_ligne (mode, eleve_id, frais_id, annee_id, nb_mois, montant, statut, transaction_id)
       VALUES ('lien', 1, 1, 1, 1, 10000, 'a_verifier', 'T_PARENT') RETURNING id`);
    await enLigne.query(`INSERT INTO absence (eleve_id, date_abs, type, confirmee, motif_tuteur) VALUES (1, '2026-10-20', 'absence', false, 'Malade')`);
    await enLigne.query(`UPDATE utilisateur SET mot_de_passe = 'empreinte-parent', doit_changer_mdp = false WHERE id = 1`);

    const r = await synchroniser(poste, distant());
    expect(r.recus).toBe(3);
    expect(await un(poste, `SELECT statut, transaction_id FROM paiement_en_ligne WHERE id = $1`, [pel.id]))
      .toEqual({ statut: 'a_verifier', transaction_id: 'T_PARENT' });
    expect(await un(poste, `SELECT motif_tuteur FROM absence WHERE eleve_id = 1`)).toEqual({ motif_tuteur: 'Malade' });
    expect(await un(poste, `SELECT mot_de_passe FROM utilisateur WHERE id = 1`)).toEqual({ mot_de_passe: 'empreinte-parent' });
    // Ce qui vient d en ligne ne repart pas en ligne
    expect(await un(poste, `SELECT COUNT(*)::int AS n FROM sync_journal`)).toEqual({ n: 0 });
  });

  it('d un compte, seul le mot de passe vient d en ligne, jamais le reste', async () => {
    await enLigne.query(`UPDATE utilisateur SET nom = 'Pirate', email = 'pirate@epsin.sn', actif = false, mot_de_passe = 'empreinte-2' WHERE id = 1`);
    await synchroniser(poste, distant());
    expect(await un(poste, `SELECT nom, email, actif, mot_de_passe FROM utilisateur WHERE id = 1`))
      .toEqual({ nom: 'Diop', email: 'ep-2026-0001@epsin.sn', actif: true, mot_de_passe: 'empreinte-2' });
  });
});

describe('Conflits : le poste fait foi', () => {
  it('un paiement Wave valide sur le poste ne redevient pas « a verifier »', async () => {
    const pel = await un(poste, `SELECT id FROM paiement_en_ligne LIMIT 1`);
    // Hors ligne, la caisse valide ; en ligne, le parent redeclare
    await poste.query(`UPDATE paiement_en_ligne SET statut = 'reussi' WHERE id = $1`, [pel.id]);
    await enLigne.query(`UPDATE paiement_en_ligne SET statut = 'a_verifier', transaction_id = 'T_BIS' WHERE id = $1`, [pel.id]);

    await synchroniser(poste, distant());
    expect(await un(poste, `SELECT statut FROM paiement_en_ligne WHERE id = $1`, [pel.id])).toEqual({ statut: 'reussi' });
    expect(await un(enLigne, `SELECT statut FROM paiement_en_ligne WHERE id = $1`, [pel.id])).toEqual({ statut: 'reussi' });
  });

  it('une ligne modifiee sur le poste et pas encore envoyee l emporte', async () => {
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
    // Table vide au moment de la copie : la numerotation repart bien de 1
    expect(t.id).toBe(1);
    await poste.query(`INSERT INTO eleve_tuteur (eleve_id, tuteur_id, lien, principal) VALUES (1, $1, 'mere', true)`, [t.id]);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT lien FROM eleve_tuteur WHERE eleve_id = 1 AND tuteur_id = $1`, [t.id])).toEqual({ lien: 'mere' });
    await poste.query(`DELETE FROM eleve_tuteur WHERE eleve_id = 1 AND tuteur_id = $1`, [t.id]);
    await synchroniser(poste, distant());
    expect(await un(enLigne, `SELECT COUNT(*)::int AS n FROM eleve_tuteur`)).toEqual({ n: 0 });
  });
});
