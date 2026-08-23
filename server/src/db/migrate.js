import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const ici = dirname(fileURLToPath(import.meta.url));
const dossier = join(ici, '..', '..', 'migrations');

async function migrer() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration (
        nom TEXT PRIMARY KEY,
        applique_le TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query(`SELECT nom FROM migration`);
    const deja = new Set(rows.map((r) => r.nom));
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort();

    for (const fichier of fichiers) {
      if (deja.has(fichier)) {
        console.log(`  = ${fichier} (deja applique)`);
        continue;
      }
      const sql = readFileSync(join(dossier, fichier), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO migration (nom) VALUES ($1)`, [fichier]);
        await client.query('COMMIT');
        console.log(`  + ${fichier}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Echec sur ${fichier} : ${err.message}`);
      }
    }
    console.log('Migrations terminees.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrer().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
