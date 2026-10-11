import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Remise a neuf d une base : efface TOUTES les donnees, puis reconstruit
 * la structure (migrations) et le strict necessaire pour demarrer
 * (init-production : etablissement, annee, niveaux, compte administrateur).
 *
 * Operation IRREVERSIBLE. Garde-fous :
 *   - tout est verifie AVANT d effacer (mot de passe admin notamment), pour
 *     ne jamais laisser une base vide sans compte pour s y connecter ;
 *   - la base visee et son contenu sont affiches ;
 *   - il faut taper VIDER (ou fournir CONFIRMATION=VIDER sans terminal).
 *
 *   DATABASE_URL=... DATABASE_SSL=true ADMIN_EMAIL=... ADMIN_MOT_DE_PASSE=... \
 *   npm run reinitialiser-base
 */

const ici = dirname(fileURLToPath(import.meta.url));

function arreter(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function reinitialiser() {
  const url = process.env.DATABASE_URL;
  if (!url) arreter('DATABASE_URL est obligatoire : l adresse de la base a remettre a neuf.');

  const mdp = process.env.ADMIN_MOT_DE_PASSE;
  if (!mdp || mdp.length < 10) {
    arreter('ADMIN_MOT_DE_PASSE est obligatoire (10 caracteres minimum) : '
      + 'sans lui, la base serait videe sans compte pour s y connecter. Rien n a ete efface.');
  }

  let hote;
  try { hote = new URL(url).host; } catch { arreter('DATABASE_URL illisible. Rien n a ete efface.'); }

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  try {
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const compter = async (table) => {
      if (!tables.some((t) => t.tablename === table)) return 0;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      return rows[0].n;
    };

    console.log('\n=== REMISE A NEUF DE LA BASE ===');
    console.log(`Serveur       : ${hote}`);
    console.log(`Tables        : ${tables.length}`);
    console.log(`Eleves        : ${await compter('eleve')}`);
    console.log(`Comptes       : ${await compter('utilisateur')}`);
    console.log(`Paiements     : ${await compter('paiement')}`);
    console.log(`Admin ensuite : ${process.env.ADMIN_EMAIL || 'admin@epsin.sn'}`);
    console.log('\nTOUTES ces donnees seront definitivement effacees.');

    let reponse = process.env.CONFIRMATION;
    if (reponse === undefined && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      reponse = await rl.question('Tapez VIDER pour confirmer : ');
      rl.close();
    }
    if (String(reponse || '').trim() !== 'VIDER') arreter('Annule : rien n a ete efface.');

    // Efface tables et type enum crees par les migrations, en une transaction
    await client.query('BEGIN');
    for (const { tablename } of tables) {
      await client.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    }
    await client.query('DROP TYPE IF EXISTS role_utilisateur CASCADE');
    await client.query('COMMIT');
    console.log(`\n${tables.length} table(s) effacee(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  // Reconstruction avec les scripts habituels, dans le meme environnement
  const lancer = (script) => execFileSync(process.execPath, [join(ici, script)], {
    stdio: 'inherit', env: process.env,
  });
  console.log('\n--- Structure (migrations) ---');
  lancer('migrate.js');
  console.log('\n--- Donnees de depart ---');
  lancer('init-production.js');
  console.log('\nBase remise a neuf.');
}

reinitialiser().catch((err) => {
  console.error('Echec :', err.message);
  process.exit(1);
});
