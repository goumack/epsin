import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Rentree 2026-2027 : classes et bareme, d apres la fiche de renseignements
 * officielle de l etablissement.
 *
 *   DATABASE_URL=... DATABASE_SSL=true npm run configurer-rentree
 *
 * 1. applique les migrations (structure a jour) ;
 * 2. verifie que l annee active est 2026-2027 ;
 * 3. cree une classe par niveau de la fiche, si ce niveau n en a pas deja ;
 * 4. enregistre le montant de chaque frais pour chaque niveau.
 *
 * Relancable sans risque : aucune classe en double, aucun frais supprime ;
 * un montant deja enregistre est remis a la valeur de la fiche.
 */

const ANNEE = '2026-2027';

/** Classes de la fiche : libelle du niveau en base -> nom de la classe. */
const CLASSES = [
  ['CI', 'CI'], ['CP', 'CP'], ['CE1', 'CE1'], ['CE2', 'CE2'], ['CM1', 'CM1'], ['CM2', 'CM2'],
  ['6eme', '6ème'], ['5eme', '5ème'], ['4eme', '4ème'], ['3eme', '3ème'],
];

/**
 * Bareme de la fiche, par niveau. La mensualite est due d octobre a juin
 * (mois_fin = 6) : 9 mensualites. « Fosco V/Med 1 000 F / 500 F » est lu
 * comme Fosco 1 000 F et visite medicale 500 F.
 *
 * La colonne « Inscription » de la fiche n est pas un frais : c est le total
 * paye a l inscription (droit d inscription + blouse ou uniforme + assurance
 * ou Fosco et visite medicale + 1er mois). Elle n est donc pas creee.
 */
const BAREME = [
  { libelle: "Droit d'inscription", montants: {
    CI: 5000, CP: 5000, CE1: 5000, CE2: 5000, CM1: 5000, CM2: 5000,
    '6eme': 5000, '5eme': 5000, '4eme': 5000, '3eme': 5000 } },
  { libelle: 'Blouse', montants: {
    CI: 5000, CP: 5000, CE1: 5000, CE2: 5000, CM1: 5000, CM2: 5000 } },
  { libelle: 'Assurance', montants: {
    CI: 1000, CP: 1000, CE1: 1000, CE2: 1000, CM1: 1000, CM2: 1000 } },
  { libelle: 'Uniforme', montants: { '6eme': 10000, '5eme': 10000, '4eme': 10000, '3eme': 10000 } },
  { libelle: 'Fosco', montants: { '6eme': 1000, '5eme': 1000, '4eme': 1000, '3eme': 1000 } },
  { libelle: 'Visite médicale', montants: { '6eme': 500, '5eme': 500, '4eme': 500, '3eme': 500 } },
  // Jusqu a juin, sauf la 3eme (classe d examen du BFEM) : jusqu a juillet
  { libelle: 'Mensualité', recurrent: true, mois_fin: 6, fins: { '3eme': 7 }, montants: {
    CI: 10000, CP: 10000, CE1: 11000, CE2: 11000, CM1: 12000, CM2: 12000,
    '6eme': 12500, '5eme': 12500, '4eme': 13500, '3eme': 13500 } },
];

const ici = dirname(fileURLToPath(import.meta.url));
const cleFrais = (libelle) => String(libelle || '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function arreter(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function configurer() {
  const url = process.env.DATABASE_URL;
  if (!url) arreter('DATABASE_URL est obligatoire : l adresse de la base a configurer.');
  let hote;
  try { hote = new URL(url).host; } catch { arreter('DATABASE_URL illisible.'); }

  console.log('\n--- Structure (migrations) ---');
  execFileSync(process.execPath, [join(ici, 'migrate.js')], { stdio: 'inherit', env: process.env });

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    const { rows: an } = await client.query(
      `SELECT id, libelle FROM annee_scolaire WHERE active LIMIT 1`
    );
    if (!an[0]) arreter('Aucune annee scolaire active. Creez et activez 2026-2027 (Parametres > Annees).');
    if (an[0].libelle !== ANNEE && process.env.FORCER !== 'oui') {
      arreter(`L annee active est ${an[0].libelle}, pas ${ANNEE}. Activez ${ANNEE} `
        + '(Parametres > Annees), ou relancez avec FORCER=oui pour configurer l annee active.');
    }
    const anneeId = an[0].id;

    const { rows: niveaux } = await client.query(`SELECT id, libelle FROM niveau`);
    const niveau = (l) => niveaux.find((n) => n.libelle === l)?.id;
    const manquants = CLASSES.map(([l]) => l).filter((l) => !niveau(l));
    if (manquants.length) arreter(`Niveaux absents de la base : ${manquants.join(', ')}.`);

    // Un frais du meme nom « pour tous les niveaux » serait facture en plus
    const { rows: globaux } = await client.query(
      `SELECT libelle FROM frais WHERE annee_id = $1 AND niveau_id IS NULL`, [anneeId]
    );
    const conflit = globaux.find((g) => BAREME.some((b) => cleFrais(b.libelle) === cleFrais(g.libelle)));
    if (conflit) {
      arreter(`« ${conflit.libelle} » existe deja pour tous les niveaux : il serait facture deux fois. `
        + 'Supprimez ou renommez ce frais general, puis relancez.');
    }

    console.log('\n=== RENTREE ' + an[0].libelle + ' ===');
    console.log(`Serveur : ${hote}`);
    console.log(`Classes : ${CLASSES.map(([, c]) => c).join(', ')}`);
    console.log(`Frais   : ${BAREME.map((b) => b.libelle).join(', ')}`);
    console.log('Mensualites dues d octobre a juin (9 mois), juillet en 3eme (BFEM).');

    let reponse = process.env.CONFIRMATION;
    if (reponse === undefined && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      reponse = await rl.question('\nTapez OUI pour appliquer : ');
      rl.close();
    }
    if (String(reponse || '').trim().toUpperCase() !== 'OUI') arreter('Annule : rien n a ete modifie.');

    await client.query('BEGIN');

    // ---------- Classes ----------
    let classesCreees = 0;
    for (const [libelleNiveau, nomClasse] of CLASSES) {
      const { rows: existe } = await client.query(
        `SELECT libelle FROM classe WHERE annee_id = $1 AND niveau_id = $2 LIMIT 1`,
        [anneeId, niveau(libelleNiveau)]
      );
      if (existe[0]) {
        console.log(`  = classe ${existe[0].libelle} deja presente`);
        continue;
      }
      await client.query(
        `INSERT INTO classe (annee_id, niveau_id, libelle) VALUES ($1,$2,$3)`,
        [anneeId, niveau(libelleNiveau), nomClasse]
      );
      classesCreees++;
      console.log(`  + classe ${nomClasse}`);
    }

    // ---------- Bareme ----------
    let fraisCrees = 0;
    let fraisMisAJour = 0;
    for (const b of BAREME) {
      for (const [libelleNiveau, montant] of Object.entries(b.montants)) {
        const niveauId = niveau(libelleNiveau);
        const { rows: ex } = await client.query(
          `SELECT id, libelle FROM frais WHERE annee_id = $1 AND niveau_id = $2`, [anneeId, niveauId]
        );
        const existant = ex.find((f) => cleFrais(f.libelle) === cleFrais(b.libelle));
        if (existant) {
          await client.query(
            `UPDATE frais SET libelle = $2, montant = $3, recurrent = $4, obligatoire = true, mois_fin = $5
             WHERE id = $1`,
            [existant.id, b.libelle, montant, Boolean(b.recurrent), b.fins?.[libelleNiveau] || b.mois_fin || null]
          );
          fraisMisAJour++;
        } else {
          await client.query(
            `INSERT INTO frais (annee_id, niveau_id, libelle, montant, recurrent, obligatoire, mois_fin)
             VALUES ($1,$2,$3,$4,$5,true,$6)`,
            [anneeId, niveauId, b.libelle, montant, Boolean(b.recurrent), b.fins?.[libelleNiveau] || b.mois_fin || null]
          );
          fraisCrees++;
        }
      }
    }

    await client.query('COMMIT');

    // ---------- Recapitulatif ----------
    const { rows: recap } = await client.query(
      `SELECT n.libelle AS niveau, n.ordre,
              json_object_agg(f.libelle, f.montant ORDER BY f.libelle) AS frais
       FROM frais f JOIN niveau n ON n.id = f.niveau_id
       WHERE f.annee_id = $1 GROUP BY n.libelle, n.ordre ORDER BY n.ordre`,
      [anneeId]
    );
    console.log(`\n${classesCreees} classe(s) creee(s), ${fraisCrees} frais cree(s), ${fraisMisAJour} mis a jour.\n`);
    for (const r of recap) {
      const ligne = Object.entries(r.frais).map(([l, m]) => `${l} ${Number(m)}`).join(' | ');
      console.log(`  ${r.niveau.padEnd(5)} ${ligne}`);
    }
    console.log('\nRentree configuree. Verifiez dans Finances > Bareme des frais.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

configurer().catch((err) => {
  console.error('Echec :', err.message);
  process.exit(1);
});
