import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

/**
 * Cree un compte parent pour chaque eleve qui n en a pas encore.
 *
 * Identifiant : le matricule de l eleve en minuscules, suivi de @epsin.sn
 * (ex. ep-2026-0014@epsin.sn). Un compte par enfant : le tuteur d une
 * fratrie se connecte avec le matricule de l enfant concerne.
 *
 * Le compte reprend l identite du tuteur principal quand il existe, sinon
 * celle du premier tuteur enregistre.
 *
 * Script idempotent : relancable sans creer de doublon.
 */
async function creerComptes() {
  const client = await pool.connect();
  try {
    const mdp = await bcrypt.hash('epsin2026', 10);

    const { rows: eleves } = await client.query(
      `SELECT e.id, e.matricule, e.prenom AS eleve_prenom, e.nom AS eleve_nom,
              t.prenom AS tuteur_prenom, t.nom AS tuteur_nom, t.telephone
       FROM eleve e
       LEFT JOIN LATERAL (
         SELECT t.prenom, t.nom, t.telephone
         FROM eleve_tuteur et
         JOIN tuteur t ON t.id = et.tuteur_id
         WHERE et.eleve_id = e.id
         ORDER BY et.principal DESC
         LIMIT 1
       ) t ON true
       WHERE e.statut = 'actif'
         AND NOT EXISTS (
           SELECT 1 FROM utilisateur u WHERE u.eleve_suivi_id = e.id
         )`
    );

    let crees = 0;
    for (const e of eleves) {
      const email = `${e.matricule.toLowerCase()}@epsin.sn`;
      // Un email deja pris (cas limite) ne doit pas interrompre le lot
      const { rows: existe } = await client.query(
        `SELECT 1 FROM utilisateur WHERE email = $1`, [email]
      );
      if (existe.length) continue;

      // `utilisateur.telephone` est UNIQUE, mais un tuteur d une fratrie a
      // un compte par enfant : le meme numero reviendrait plusieurs fois.
      // On ne le renseigne donc que s il est encore libre — la connexion se
      // fait de toute facon par le matricule de l enfant.
      let telephone = e.telephone || null;
      if (telephone) {
        const { rows: pris } = await client.query(
          `SELECT 1 FROM utilisateur WHERE telephone = $1`, [telephone]
        );
        if (pris.length) telephone = null;
      }

      await client.query(
        `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom,
                                  telephone, eleve_suivi_id)
         VALUES ($1,$2,'parent',$3,$4,$5,$6)`,
        [
          email, mdp,
          e.tuteur_prenom || 'Tuteur',
          e.tuteur_nom || e.eleve_nom,
          telephone,
          e.id,
        ]
      );
      crees++;
    }

    const { rows: total } = await client.query(
      `SELECT COUNT(*)::int AS n FROM utilisateur WHERE role = 'parent'`
    );
    console.log(`${crees} compte(s) tuteur cree(s). Total : ${total[0].n}`);
    if (eleves.length) {
      const exemple = eleves[0].matricule.toLowerCase();
      console.log(`Exemple de connexion : ${exemple}@epsin.sn / epsin2026`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

creerComptes().catch((err) => {
  console.error('Echec :', err.message);
  process.exit(1);
});
