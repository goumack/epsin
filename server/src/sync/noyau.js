/**
 * Coeur de la synchronisation, independant du reseau : lire les
 * modifications notees dans le journal, les appliquer sur une autre base,
 * copier une base entiere. Chaque fonction recoit le pool de la base visee,
 * ce qui permet de tester un echange entre deux bases sans serveur.
 *
 * Les ecritures faites ici positionnent epsin.sync_en_cours : le
 * declencheur du journal les ignore, sans quoi elles repartiraient dans
 * l autre sens.
 */

/** Tables jamais synchronisees : propres a chaque base. */
const HORS_SYNCHRO = new Set(['migration', 'sync_journal', 'sync_etat']);

const identifiant = (nom) => `"${String(nom).replace(/"/g, '""')}"`;

/** Cle d un changement : « table|{json de la cle} », pour dedoublonner. */
export const cleChangement = (ch) => `${ch.table}|${JSON.stringify(ch.cle)}`;

/** Tables de donnees, avec leurs colonnes et leur cle primaire. */
export async function schema(base) {
  const { rows } = await base.query(
    `SELECT c.relname AS nom,
            (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colonnes,
            (SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum))
             FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = c.oid AND i.indisprimary) AS cle
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`
  );
  return Object.fromEntries(rows.filter((t) => !HORS_SYNCHRO.has(t.nom) && t.cle).map((t) => [t.nom, t]));
}

/** Clause WHERE sur la cle primaire, parametres a partir de $1. */
function surCle(table, cle, depart = 1) {
  const cols = Object.keys(cle);
  return {
    where: cols.map((c, i) => `${identifiant(c)} = $${depart + i}`).join(' AND '),
    params: cols.map((c) => cle[c]),
  };
}

/**
 * Modifications notees apres `depuis`, une par ligne (la derniere operation
 * l emporte, a la place de sa premiere apparition : un parent passe ainsi
 * avant ses enfants). Chaque changement porte la ligne complete a jour, ou
 * une suppression.
 */
export async function lireChangements(base, depuis = 0, limite = 500) {
  const tables = await schema(base);
  const { rows: journal } = await base.query(
    `SELECT id, table_nom, cle, operation FROM sync_journal WHERE id > $1 ORDER BY id LIMIT $2`,
    [depuis, limite]
  );
  const parCle = new Map();
  for (const j of journal) {
    if (!tables[j.table_nom]) continue;
    const ch = { table: j.table_nom, cle: j.cle };
    const k = cleChangement(ch);
    if (!parCle.has(k)) parCle.set(k, ch);
  }
  const changements = [];
  for (const ch of parCle.values()) {
    const { where, params } = surCle(ch.table, ch.cle);
    const { rows } = await base.query(
      `SELECT to_jsonb(t) AS ligne FROM ${identifiant(ch.table)} t WHERE ${where}`, params
    );
    // Ligne absente : elle a ete supprimee depuis
    changements.push(rows[0] ? { ...ch, operation: 'U', ligne: rows[0].ligne } : { ...ch, operation: 'D' });
  }
  return { changements, curseur: journal.length ? Number(journal.at(-1).id) : Number(depuis) };
}

/**
 * Applique des changements dans une transaction, sans les journaliser.
 * `politique(changement, client)` peut les filtrer ou les reduire : elle
 * renvoie le changement a appliquer, ou null pour l ignorer. Un changement
 * peut porter `colonnes` : seules ces colonnes sont mises a jour.
 */
export async function appliquerChangements(base, changements, { politique = null } = {}) {
  const tables = await schema(base);
  const client = await base.connect();
  let appliques = 0;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('epsin.sync_en_cours', 'on', true)`);
    for (const brut of changements) {
      const t = tables[brut.table];
      if (!t) continue;
      const ch = politique ? await politique(brut, client) : brut;
      if (!ch) continue;

      if (ch.operation === 'D') {
        const { where, params } = surCle(ch.table, ch.cle);
        await client.query(`DELETE FROM ${identifiant(ch.table)} WHERE ${where}`, params);
      } else if (ch.colonnes) {
        // Mise a jour partielle d une ligne existante
        const cols = ch.colonnes.filter((c) => t.colonnes.includes(c) && !t.cle.includes(c));
        if (!cols.length) continue;
        const { where, params } = surCle(ch.table, ch.cle, 2);
        await client.query(
          `UPDATE ${identifiant(ch.table)} t SET ${cols.map((c) => `${identifiant(c)} = r.${identifiant(c)}`).join(', ')}
           FROM jsonb_populate_record(NULL::${identifiant(ch.table)}, $1) r WHERE ${where.replace(/"([^"]+)" =/g, 't."$1" =')}`,
          [ch.ligne, ...params]
        );
      } else {
        const cols = t.colonnes.filter((c) => c in ch.ligne);
        const liste = cols.map(identifiant).join(', ');
        const maj = cols.filter((c) => !t.cle.includes(c));
        await client.query(
          `INSERT INTO ${identifiant(ch.table)} (${liste})
           SELECT ${liste} FROM jsonb_populate_record(NULL::${identifiant(ch.table)}, $1)
           ON CONFLICT (${t.cle.map(identifiant).join(', ')}) DO ${maj.length
             ? `UPDATE SET ${maj.map((c) => `${identifiant(c)} = EXCLUDED.${identifiant(c)}`).join(', ')}`
             : 'NOTHING'}`,
          [ch.ligne]
        );
      }
      appliques++;
    }
    await client.query('COMMIT');
    return appliques;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Remet chaque sequence au-dessus du plus grand identifiant de sa table. */
export async function recalerSequences(client) {
  const { rows } = await client.query(
    `SELECT c.relname AS table_nom, a.attname AS colonne,
            pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS sequence
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`
  );
  for (const s of rows) {
    // Table vide : la sequence repart de 1 (troisieme argument a faux)
    await client.query(
      `SELECT setval($1, GREATEST(m, 1), m > 0)
       FROM (SELECT COALESCE(MAX(${identifiant(s.colonne)}), 0) AS m FROM ${identifiant(s.table_nom)}) x`,
      [s.sequence]
    );
  }
}

/** Copie complete d une base : toutes les tables de donnees, ligne a ligne. */
export async function instantane(base) {
  const tables = await schema(base);
  const { rows: c } = await base.query(`SELECT COALESCE(MAX(id), 0) AS n FROM sync_journal`);
  const contenu = {};
  for (const nom of Object.keys(tables)) {
    const { rows } = await base.query(`SELECT to_jsonb(t) AS ligne FROM ${identifiant(nom)} t`);
    contenu[nom] = rows.map((r) => r.ligne);
  }
  return { tables: contenu, curseur: Number(c[0].n) };
}

/**
 * Remplace TOUT le contenu d une base par un instantane (premier lancement
 * du poste). Les contraintes de cle etrangere sont suspendues le temps du
 * chargement (session_replication_role) : cela demande un compte
 * superutilisateur, ce qu est la base embarquee du poste.
 */
export async function chargerInstantane(base, inst) {
  const tables = await schema(base);
  const client = await base.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('epsin.sync_en_cours', 'on', true)`);
    await client.query(`SET LOCAL session_replication_role = replica`);
    const noms = Object.keys(tables);
    await client.query(`TRUNCATE ${noms.map(identifiant).join(', ')} RESTART IDENTITY CASCADE`);
    for (const nom of noms) {
      const lignes = inst.tables[nom] || [];
      if (!lignes.length) continue;
      const cols = tables[nom].colonnes.filter((c) => c in lignes[0]);
      const liste = cols.map(identifiant).join(', ');
      // Par paquets, pour ne pas envoyer une requete demesuree
      for (let i = 0; i < lignes.length; i += 500) {
        await client.query(
          `INSERT INTO ${identifiant(nom)} (${liste})
           SELECT ${liste} FROM jsonb_populate_recordset(NULL::${identifiant(nom)}, $1)`,
          [JSON.stringify(lignes.slice(i, i + 500))]
        );
      }
    }
    await recalerSequences(client);
    await client.query(`DELETE FROM sync_journal`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lecture et ecriture des curseurs et reglages de synchronisation. */
export async function lireEtat(base, cle, defaut = null) {
  const { rows } = await base.query(`SELECT valeur FROM sync_etat WHERE cle = $1`, [cle]);
  return rows[0] ? rows[0].valeur : defaut;
}
export async function ecrireEtat(base, cle, valeur) {
  await base.query(
    `INSERT INTO sync_etat (cle, valeur) VALUES ($1, $2)
     ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur`,
    [cle, valeur == null ? null : String(valeur)]
  );
}

/** Tables ou les parents creent des lignes en ligne. */
export const CREEES_EN_LIGNE = ['paiement_en_ligne', 'absence', 'message', 'notification', 'journal_audit'];
/** Les identifiants crees en ligne partent de ce seuil : le poste ne l atteint jamais. */
export const SEUIL_EN_LIGNE = 1000000000;

/**
 * Cote serveur en ligne : reserve une plage d identifiants aux lignes creees
 * en ligne (au-dela d un milliard), pour qu elles ne croisent jamais celles
 * du poste. Relancable sans effet de bord.
 */
export async function preparerServeur(base) {
  // Noms de tables fixes, ci-dessus : aucune entree exterieure dans la requete
  for (const table of CREEES_EN_LIGNE) {
    await base.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'),
                     GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), $2))`,
      [table, SEUIL_EN_LIGNE]
    );
  }
}
