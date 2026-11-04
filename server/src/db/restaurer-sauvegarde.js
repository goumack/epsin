import fs from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { appliquerMigrations } from './migrate.js';
import { schema } from '../sync/noyau.js';

dotenv.config();

/**
 * Restaure une sauvegarde complete (export /api/sync/instantane) dans une
 * base PostgreSQL : demenagement vers une nouvelle base, ou reprise apres
 * incident.
 *
 *   CIBLE_DATABASE_URL=postgresql://... CONFIRMATION=RESTAURER \
 *   node src/db/restaurer-sauvegarde.js <fichier.json> [--remplacer]
 *
 * Fonctionne SANS droits de superutilisateur (Neon) : les cles etrangeres
 * sont retirees le temps du chargement puis recreees, ce qui revalide
 * chaque lien. Tout se fait dans une transaction : en cas d erreur, la base
 * cible reste telle qu avant.
 *
 * Garde-fous :
 *   - la cible est donnee explicitement (CIBLE_DATABASE_URL), jamais par
 *     DATABASE_URL, pour ne pas viser une base par megarde ;
 *   - une base qui contient deja des eleves est refusee, sauf --remplacer ;
 *   - CONFIRMATION=RESTAURER est obligatoire ;
 *   - a la fin, chaque table est comptee et comparee a la sauvegarde.
 */

const identifiant = (nom) => `"${String(nom).replace(/"/g, '""')}"`;

function arreter(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

export async function restaurer(cible, sauvegarde, { remplacer = false, journal = console.log } = {}) {
  const base = new pg.Pool({
    connectionString: cible,
    ssl: /neon\.tech|sslmode=require/.test(cible) ? { rejectUnauthorized: false } : false,
    max: 2,
  });
  try {
    const { rows: existe } = await base.query(`SELECT to_regclass('public.eleve') IS NOT NULL AS oui`);
    if (existe[0].oui) {
      const { rows } = await base.query(`SELECT COUNT(*)::int AS n FROM eleve`);
      if (rows[0].n > 0 && !remplacer) {
        throw new Error(`La base cible contient deja ${rows[0].n} eleve(s) : rien n a ete modifie (--remplacer pour ecraser).`);
      }
    }

    journal('Structure (migrations)…');
    await appliquerMigrations(base, { journal: () => {} });

    const tables = await schema(base);
    const client = await base.connect();
    try {
      await client.query('BEGIN');
      // Rien de ce chargement ne doit partir dans le journal de synchronisation
      await client.query(`SELECT set_config('epsin.sync_en_cours', 'on', true)`);

      // 1. Retirer les cles etrangeres (sans superutilisateur, impossible de les suspendre)
      const { rows: liens } = await client.query(
        `SELECT conrelid::regclass::text AS table_nom, conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`
      );
      for (const l of liens) {
        await client.query(`ALTER TABLE ${l.table_nom} DROP CONSTRAINT ${identifiant(l.conname)}`);
      }

      // 2. Vider puis charger chaque table
      const noms = Object.keys(tables);
      await client.query(`TRUNCATE ${noms.map(identifiant).join(', ')} RESTART IDENTITY`);
      let total = 0;
      for (const nom of noms) {
        const lignes = sauvegarde.tables[nom] || [];
        if (!lignes.length) continue;
        const cols = tables[nom].colonnes.filter((c) => lignes.some((l) => c in l));
        const liste = cols.map(identifiant).join(', ');
        for (let i = 0; i < lignes.length; i += 500) {
          await client.query(
            `INSERT INTO ${identifiant(nom)} (${liste})
             SELECT ${liste} FROM jsonb_populate_recordset(NULL::${identifiant(nom)}, $1)`,
            [JSON.stringify(lignes.slice(i, i + 500))]
          );
        }
        total += lignes.length;
      }
      journal(`${total} lignes chargees dans ${noms.length} tables.`);

      // 3. Recreer les cles etrangeres : chaque lien est revalide
      for (const l of liens) {
        await client.query(`ALTER TABLE ${l.table_nom} ADD CONSTRAINT ${identifiant(l.conname)} ${l.definition}`);
      }
      journal(`${liens.length} liens entre tables recrees et verifies.`);

      // 4. Compteurs d identifiants au-dessus des donnees chargees
      const { rows: sequences } = await client.query(
        `SELECT c.relname AS table_nom, a.attname AS colonne,
                pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS sequence
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`
      );
      for (const s of sequences) {
        await client.query(
          `SELECT setval($1, GREATEST(m, 1), m > 0)
           FROM (SELECT COALESCE(MAX(${identifiant(s.colonne)}), 0) AS m FROM ${identifiant(s.table_nom)}) x`,
          [s.sequence]
        );
      }
      // Le journal de synchronisation repart de zero sur la nouvelle base
      await client.query(`DELETE FROM sync_journal`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // 5. Controle : meme nombre de lignes que la sauvegarde, table par table
    const ecarts = [];
    for (const nom of Object.keys(tables)) {
      const attendu = (sauvegarde.tables[nom] || []).length;
      const { rows } = await base.query(`SELECT COUNT(*)::int AS n FROM ${identifiant(nom)}`);
      if (rows[0].n !== attendu) ecarts.push(`${nom} : ${rows[0].n} au lieu de ${attendu}`);
    }
    const absentes = Object.keys(sauvegarde.tables).filter((t) => !tables[t] && sauvegarde.tables[t].length);
    if (absentes.length) ecarts.push(`tables de la sauvegarde absentes de la cible : ${absentes.join(', ')}`);
    return { ecarts };
  } finally {
    await base.end();
  }
}

// Utilisation en ligne de commande
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const fichier = process.argv[2];
  const cible = process.env.CIBLE_DATABASE_URL;
  if (!fichier || !fs.existsSync(fichier)) arreter('Fichier de sauvegarde introuvable.');
  if (!cible) arreter('CIBLE_DATABASE_URL est obligatoire : l adresse de la base a restaurer.');
  if (process.env.CONFIRMATION !== 'RESTAURER') arreter('Ajoutez CONFIRMATION=RESTAURER pour confirmer.');
  const sauvegarde = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  console.log(`Sauvegarde du ${sauvegarde.exporte_le} (${sauvegarde.source})`);
  console.log(`Cible : ${cible.replace(/:\/\/[^@]+@/, '://…@')}`);
  restaurer(cible, sauvegarde, { remplacer: process.argv.includes('--remplacer') })
    .then(({ ecarts }) => {
      if (ecarts.length) { console.log('ECARTS :\n  ' + ecarts.join('\n  ')); process.exit(1); }
      console.log('Restauration terminee : chaque table a le meme nombre de lignes que la sauvegarde.');
    })
    .catch((err) => arreter(`Echec, rien n a ete modifie : ${err.message}`));
}
