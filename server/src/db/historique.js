import { pool } from './pool.js';

/**
 * Reconstitue deux annees anterieures pour les eleves actuels, afin de
 * disposer d un parcours pluriannuel realiste : un eleve de 6eme etait en
 * CM2 l an dernier, un eleve de CM2 etait en CM1...
 *
 * Genere pour chaque annee passee : l inscription dans le niveau inferieur,
 * les periodes, quelques evaluations et notes, et la decision de fin d annee.
 *
 * Idempotent : les eleves ayant deja un historique sont ignores.
 */

const entier = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function generer() {
  // Comme le seed, ce script fabrique un passe fictif : il n a rien a faire
  // sur une base de production, ou l historique reel sera saisi ou importe.
  if (process.env.NODE_ENV === 'production') {
    console.error('Refus : ce script genere un historique de demonstration.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: annees } = await client.query(
      `SELECT id, libelle, date_debut, date_fin FROM annee_scolaire
       WHERE libelle IN ('2023-2024','2024-2025') ORDER BY date_debut`
    );
    if (annees.length < 2) {
      console.log('Annees anterieures absentes. Lancez d abord les migrations.');
      await client.query('ROLLBACK');
      return;
    }

    const { rows: anneeActive } = await client.query(
      `SELECT id FROM annee_scolaire WHERE active LIMIT 1`
    );

    // Trimestres de chaque annee passee
    const periodesPar = {};
    for (const a of annees) {
      const { rows: dejaLa } = await client.query(
        `SELECT id, libelle FROM periode WHERE annee_id = $1 ORDER BY ordre`, [a.id]
      );
      if (dejaLa.length) { periodesPar[a.id] = dejaLa; continue; }

      const debut = new Date(a.date_debut);
      const creees = [];
      for (let t = 1; t <= 3; t++) {
        const d = new Date(debut); d.setMonth(d.getMonth() + (t - 1) * 3);
        const f = new Date(d); f.setMonth(f.getMonth() + 3);
        const { rows } = await client.query(
          `INSERT INTO periode (annee_id, libelle, ordre, date_debut, date_fin)
           VALUES ($1,$2,$3,$4,$5) RETURNING id, libelle`,
          [a.id, `${t}${t === 1 ? 'er' : 'eme'} trimestre`, t,
           d.toISOString().slice(0, 10), f.toISOString().slice(0, 10)]
        );
        creees.push(rows[0]);
      }
      periodesPar[a.id] = creees;
    }

    // Eleves actuels, avec le niveau ou ils se trouvent aujourd hui
    const { rows: eleves } = await client.query(
      `SELECT e.id, i.classe_id, c.niveau_id, n.ordre, n.entite
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id AND i.annee_id = $1
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       WHERE e.statut = 'actif'`,
      [anneeActive[0].id]
    );

    // Classes disponibles par niveau, pour rattacher l historique
    const { rows: classes } = await client.query(
      `SELECT c.id, c.niveau_id, c.annee_id FROM classe c`
    );

    /**
     * Trouve (ou cree) une classe du niveau voulu pour une annee donnee.
     * Les classes de l historique reprennent le libelle du niveau.
     */
    const cacheClasses = {};
    async function classePour(niveauId, anneeId) {
      const cle = `${niveauId}-${anneeId}`;
      if (cacheClasses[cle]) return cacheClasses[cle];

      const existante = classes.find((c) => c.niveau_id === niveauId && c.annee_id === anneeId);
      if (existante) { cacheClasses[cle] = existante.id; return existante.id; }

      const { rows: niv } = await client.query(
        `SELECT libelle FROM niveau WHERE id = $1`, [niveauId]
      );
      const { rows } = await client.query(
        `INSERT INTO classe (annee_id, niveau_id, libelle, capacite)
         VALUES ($1,$2,$3,50) RETURNING id`,
        [anneeId, niveauId, `${niv[0].libelle} A`]
      );
      classes.push({ id: rows[0].id, niveau_id: niveauId, annee_id: anneeId });
      cacheClasses[cle] = rows[0].id;
      return rows[0].id;
    }

    let inscriptionsCreees = 0;
    let notesCreees = 0;

    for (const el of eleves) {
      // annees[0] = 2023-2024 (ordre - 2), annees[1] = 2024-2025 (ordre - 1)
      for (let k = 0; k < annees.length; k++) {
        const annee = annees[k];
        const ordreVoulu = el.ordre - (annees.length - k);
        if (ordreVoulu < 1) continue;          // l eleve n etait pas encore scolarise

        const { rows: niv } = await client.query(
          `SELECT id FROM niveau WHERE ordre = $1`, [ordreVoulu]
        );
        if (!niv[0]) continue;

        const { rows: deja } = await client.query(
          `SELECT 1 FROM inscription WHERE eleve_id = $1 AND annee_id = $2`,
          [el.id, annee.id]
        );
        if (deja.length) continue;

        const classeId = await classePour(niv[0].id, annee.id);
        await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_id, statut, decision,
                                    decide_le)
           VALUES ($1,$2,$3,'termine','passe',$4)`,
          [el.id, classeId, annee.id, annee.date_fin]
        );
        inscriptionsCreees++;

        // Matieres de ce niveau, pour generer des notes coherentes
        const { rows: matieres } = await client.query(
          `SELECT matiere_id FROM matiere_niveau WHERE niveau_id = $1`, [niv[0].id]
        );

        for (const per of periodesPar[annee.id]) {
          for (const m of matieres) {
            // Une composition par matiere et par trimestre suffit a
            // reconstituer une moyenne annuelle credible.
            const { rows: ev } = await client.query(
              `INSERT INTO evaluation (classe_id, matiere_id, periode_id, type,
                                       libelle, date_eval, bareme, coefficient, publiee)
               VALUES ($1,$2,$3,'composition','Composition',$4,20,2,true)
               RETURNING id`,
              [classeId, m.matiere_id, per.id,
               new Date(annee.date_debut).toISOString().slice(0, 10)]
            );
            await client.query(
              `INSERT INTO note (evaluation_id, eleve_id, valeur) VALUES ($1,$2,$3)`,
              [ev[0].id, el.id, Math.round((Math.random() * 11 + 7) * 4) / 4]
            );
            notesCreees++;
          }
        }

        // Paiements de l annee : la scolarite a bien ete reglee a l epoque,
        // sinon la colonne « Regle cette annee » afficherait 0 partout.
        // Le bareme n existe que pour l annee en cours : on s en sert pour
        // les montants, mais le paiement n est PAS rattache a ce frais —
        // il solderait sinon la scolarite de l annee en cours.
        const { rows: fraisAnnee } = await client.query(
          `SELECT id, montant, recurrent FROM frais
           WHERE annee_id IS NOT NULL AND niveau_id IS NULL LIMIT 4`
        );
        for (const fr of fraisAnnee) {
          // Les frais recurrents (mensualite) sont regles plusieurs fois
          const fois = fr.recurrent ? entier(6, 9) : 1;
          for (let m = 0; m < fois; m++) {
            const d = new Date(annee.date_debut);
            d.setMonth(d.getMonth() + m);
            await client.query(
              `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode,
                                     numero_recu, date_paiement)
               VALUES ($1,NULL,$2,$3,$4,$5,$6)`,
              [el.id, annee.id, fr.montant,
               ['especes', 'wave', 'om'][entier(0, 2)],
               `H-${annee.id}-${el.id}-${fr.id}-${m}`,
               d.toISOString().slice(0, 10)]
            );
          }
        }

        // Quelques absences pour l assiduite de l annee
        for (let a = 0; a < entier(0, 4); a++) {
          const d = new Date(annee.date_debut);
          d.setDate(d.getDate() + entier(10, 200));
          await client.query(
            `INSERT INTO absence (eleve_id, date_abs, type, justifiee)
             VALUES ($1,$2,$3,$4)`,
            [el.id, d.toISOString().slice(0, 10),
             Math.random() > 0.3 ? 'absence' : 'retard', Math.random() > 0.5]
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Historique genere : ${inscriptionsCreees} inscriptions, ${notesCreees} notes.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

generer().catch((err) => {
  console.error('Echec :', err.message);
  process.exit(1);
});
