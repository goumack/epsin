import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Les colonnes NUMERIC reviennent en texte par defaut avec node-postgres.
// On les convertit en nombres pour que les montants et moyennes soient
// directement exploitables cote client.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

// Poste de l ecole ou serveur en ligne en mode copie : chaque connexion
// tient le journal des modifications a synchroniser
if (['poste', 'replique'].includes(process.env.EPSIN_MODE)) {
  pool.on('connect', (client) => {
    client.query(`SET epsin.journal = 'on'`).catch(() => {});
  });
}

pool.on('error', (err) => {
  console.error('[db] erreur inattendue sur un client inactif', err);
});

export const query = (text, params) => pool.query(text, params);

/** Execute plusieurs requetes dans une transaction. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
