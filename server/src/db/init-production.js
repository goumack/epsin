import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { pool } from './pool.js';

/**
 * Initialisation d une base de PRODUCTION.
 *
 * Cree le strict necessaire pour ouvrir l application :
 *   - l etablissement (nom, IA, IEF — figurent sur les bulletins)
 *   - l annee scolaire en cours et ses trois trimestres
 *   - les 13 niveaux du systeme senegalais avec leurs examens
 *   - un compte administrateur
 *
 * AUCUNE donnee de demonstration : ni eleve, ni note, ni paiement fictif.
 * L etablissement saisit ensuite ses vraies donnees.
 *
 * Script idempotent : relancable sans rien dupliquer.
 */

/**
 * Reutilisable : le programme Windows l appelle pour demarrer avec une base
 * vide. Leve une erreur (sans quitter) si le mot de passe est trop faible.
 * Ne ferme pas le pool.
 */
export async function initialiserBase({
  adminEmail = 'admin@epsin.sn', adminMotDePasse, adminPrenom = 'Administrateur', adminNom = 'EPSIN',
  journal = console.log,
} = {}) {
  const ADMIN_EMAIL = String(adminEmail).trim().toLowerCase();
  const ADMIN_MDP = adminMotDePasse;
  if (!ADMIN_MDP) throw new Error('Le mot de passe administrateur est obligatoire.');
  if (ADMIN_MDP.length < 10) {
    throw new Error('Le mot de passe administrateur doit faire au moins 10 caracteres.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---------- Etablissement ----------
    const { rows: etab } = await client.query(`SELECT id FROM etablissement LIMIT 1`);
    if (!etab.length) {
      await client.query(
        `INSERT INTO etablissement (nom, sigle, adresse, telephone, email,
                                    inspection_academie, inspection_ief)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          process.env.ETAB_NOM || 'École Privée Serigne Ibrahima Niang',
          process.env.ETAB_SIGLE || 'EPSIN - YENE',
          process.env.ETAB_ADRESSE || 'Dakar, Senegal',
          process.env.ETAB_TELEPHONE || '+221 33 000 00 00',
          process.env.ETAB_EMAIL || 'contact@epsin.sn',
          process.env.ETAB_IA || 'IA DAKAR',
          process.env.ETAB_IEF || 'IEF Dakar 1',
        ]
      );
      journal('  etablissement cree');
    } else {
      journal('  = etablissement deja present');
    }

    // ---------- Annee scolaire et trimestres ----------
    // L annee court d octobre a juillet : avant octobre, on est encore sur
    // l annee entamee l annee civile precedente.
    const maintenant = new Date();
    const debut = maintenant.getMonth() >= 9
      ? maintenant.getFullYear()
      : maintenant.getFullYear() - 1;
    const libelleAnnee = `${debut}-${debut + 1}`;

    const { rows: annee } = await client.query(
      `SELECT id FROM annee_scolaire WHERE libelle = $1`, [libelleAnnee]
    );
    let anneeId;
    if (annee.length) {
      anneeId = annee[0].id;
      journal(`  = annee ${libelleAnnee} deja presente`);
    } else {
      const { rows } = await client.query(
        `INSERT INTO annee_scolaire (libelle, date_debut, date_fin, active)
         VALUES ($1,$2,$3,true) RETURNING id`,
        [libelleAnnee, `${debut}-10-01`, `${debut + 1}-07-15`]
      );
      anneeId = rows[0].id;
      journal(`  annee ${libelleAnnee} creee`);

      for (const [libelle, ordre, d, f] of [
        ['1er trimestre', 1, `${debut}-10-01`, `${debut}-12-20`],
        ['2eme trimestre', 2, `${debut + 1}-01-05`, `${debut + 1}-03-28`],
        ['3eme trimestre', 3, `${debut + 1}-04-06`, `${debut + 1}-07-15`],
      ]) {
        await client.query(
          `INSERT INTO periode (annee_id, libelle, ordre, date_debut, date_fin)
           VALUES ($1,$2,$3,$4,$5)`,
          [anneeId, libelle, ordre, d, f]
        );
      }
      journal('  3 trimestres crees');
    }

    // ---------- Niveaux du systeme senegalais ----------
    const niveaux = [
      ['CI', 'elementaire', 1, null], ['CP', 'elementaire', 2, null],
      ['CE1', 'elementaire', 3, null], ['CE2', 'elementaire', 4, null],
      ['CM1', 'elementaire', 5, null], ['CM2', 'elementaire', 6, 'CFEE'],
      ['6eme', 'moyen', 7, null], ['5eme', 'moyen', 8, null],
      ['4eme', 'moyen', 9, null], ['3eme', 'moyen', 10, 'BFEM'],
      ['Seconde', 'secondaire', 11, null], ['Premiere', 'secondaire', 12, null],
      ['Terminale', 'secondaire', 13, 'Baccalaureat'],
    ];
    let nouveaux = 0;
    for (const [libelle, cycle, ordre, examen] of niveaux) {
      const entite = cycle === 'elementaire' ? 'scolaire' : 'secondaire';
      const { rowCount } = await client.query(
        `INSERT INTO niveau (libelle, cycle, ordre, examen, entite)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (libelle) DO NOTHING`,
        [libelle, cycle, ordre, examen, entite]
      );
      nouveaux += rowCount;
    }
    journal(nouveaux ? `  ${nouveaux} niveaux crees` : '  = niveaux deja presents');

    // ---------- Compte administrateur ----------
    const { rows: admin } = await client.query(
      `SELECT id FROM utilisateur WHERE email = $1`, [ADMIN_EMAIL]
    );
    if (admin.length) {
      journal(`  = compte ${ADMIN_EMAIL} deja present`);
    } else {
      const mdp = await bcrypt.hash(ADMIN_MDP, 10);
      await client.query(
        `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom)
         VALUES ($1,$2,'admin',$3,$4)`,
        [ADMIN_EMAIL, mdp,
         adminPrenom,
         adminNom]
      );
      journal(`  compte administrateur cree : ${ADMIN_EMAIL}`);
    }

    await client.query('COMMIT');

    const { rows: bilan } = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM niveau) AS niveaux,
              (SELECT COUNT(*)::int FROM utilisateur) AS comptes,
              (SELECT COUNT(*)::int FROM eleve) AS eleves`
    );
    journal('\nBase de production prete :');
    journal(`  ${bilan[0].niveaux} niveaux, ${bilan[0].comptes} compte(s), ${bilan[0].eleves} eleve(s)`);
    journal(`\nConnectez-vous avec ${ADMIN_EMAIL}, puis creez vos classes et vos comptes.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Lance en ligne de commande : npm run init-production
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  initialiserBase({
    adminEmail: process.env.ADMIN_EMAIL || 'admin@epsin.sn',
    adminMotDePasse: process.env.ADMIN_MOT_DE_PASSE,
    adminPrenom: process.env.ADMIN_PRENOM || 'Administrateur',
    adminNom: process.env.ADMIN_NOM || 'EPSIN',
  }).then(() => pool.end()).catch((err) => {
    console.error('Echec de l initialisation :', err.message);
    process.exit(1);
  });
}
