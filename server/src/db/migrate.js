import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './pool.js';

const ici = dirname(fileURLToPath(import.meta.url));
const dossier = join(ici, '..', '..', 'migrations');

/**
 * Applique les migrations manquantes, dans l ordre. Reutilisable : le
 * programme Windows l appelle a chaque demarrage. Ne ferme pas le pool.
 */
export async function appliquerMigrations(base = pool, { journal = console.log } = {}) {
  const client = await base.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration (
        nom TEXT PRIMARY KEY,
        applique_le TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query(`SELECT nom FROM migration`);
    const deja = new Set(rows.map((r) => r.nom));
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort();

    let appliquees = 0;
    for (const fichier of fichiers) {
      if (deja.has(fichier)) {
        journal(`  = ${fichier} (deja applique)`);
        continue;
      }
      const sql = readFileSync(join(dossier, fichier), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO migration (nom) VALUES ($1)`, [fichier]);
        await client.query('COMMIT');
        appliquees++;
        journal(`  + ${fichier}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Echec sur ${fichier} : ${err.message}`);
      }
    }

    // Une table ajoutee par une migration doit etre suivie par la
    // synchronisation : on repose les declencheurs du journal.
    if (appliquees) {
      const { rows: f } = await client.query(
        `SELECT 1 FROM pg_proc WHERE proname = 'sync_installer_declencheurs'`
      );
      if (f.length) await client.query(`SELECT sync_installer_declencheurs()`);
    }
    journal('Migrations terminees.');
    return appliquees;
  } finally {
    client.release();
  }
}

// Lance en ligne de commande : npm run migrate
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  appliquerMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
