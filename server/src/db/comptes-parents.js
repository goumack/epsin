import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Comptes parents : un par eleve, cree a l inscription.
 *
 * Identifiant : le matricule de l eleve en minuscules + @epsin.sn
 * (ex. ep-2026-0014@epsin.sn). Mot de passe : tire au hasard, a usage
 * unique — il est remis une seule fois sur la fiche d acces imprimee, n est
 * jamais stocke en clair, et doit etre change a la premiere connexion.
 */

// Sans 0/O, 1/I/L : la fiche est recopiee a la main sur un telephone
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Mot de passe lisible de 8 caracteres, presente en deux blocs : K7MP-4QXR. */
export function motDePasseTemporaire() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Identifiant de connexion du parent d un eleve. */
export function identifiantParent(matricule) {
  return `${String(matricule).toLowerCase()}@epsin.sn`;
}

/**
 * Cree le compte parent d un eleve, ou, s il existe deja, lui attribue un
 * nouveau mot de passe temporaire (perte de la fiche, parent bloque).
 * Retourne { identifiant, mot_de_passe, cree } — le mot de passe en clair
 * n est disponible qu ici, une seule fois.
 *
 * `client` : client d une transaction en cours (ou le pool).
 */
export async function attribuerCompteParent(client, eleveId) {
  const { rows: el } = await client.query(
    `SELECT e.id, e.matricule, e.nom,
            t.prenom AS tuteur_prenom, t.nom AS tuteur_nom, t.telephone
     FROM eleve e
     LEFT JOIN LATERAL (
       SELECT t.prenom, t.nom, t.telephone FROM eleve_tuteur et
       JOIN tuteur t ON t.id = et.tuteur_id
       WHERE et.eleve_id = e.id ORDER BY et.principal DESC LIMIT 1
     ) t ON true
     WHERE e.id = $1`,
    [eleveId]
  );
  if (!el[0]) throw Object.assign(new Error('Eleve introuvable'), { status: 404 });
  const eleve = el[0];

  const identifiant = identifiantParent(eleve.matricule);
  const motDePasse = motDePasseTemporaire();
  const empreinte = await bcrypt.hash(motDePasse, 10);

  const { rows: existant } = await client.query(
    `SELECT id FROM utilisateur WHERE eleve_suivi_id = $1 AND role = 'parent' LIMIT 1`,
    [eleveId]
  );
  if (existant[0]) {
    await client.query(
      `UPDATE utilisateur SET mot_de_passe = $2, doit_changer_mdp = true, actif = true
       WHERE id = $1`,
      [existant[0].id, empreinte]
    );
    return { identifiant, mot_de_passe: motDePasse, cree: false, utilisateur_id: existant[0].id };
  }

  // utilisateur.telephone est UNIQUE, mais un tuteur de fratrie a un compte
  // par enfant : on ne renseigne le numero que s il est encore libre.
  let telephone = eleve.telephone || null;
  if (telephone) {
    const { rows: pris } = await client.query(
      `SELECT 1 FROM utilisateur WHERE telephone = $1`, [telephone]
    );
    if (pris.length) telephone = null;
  }

  const { rows } = await client.query(
    `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom, telephone,
                              eleve_suivi_id, doit_changer_mdp)
     VALUES ($1,$2,'parent',$3,$4,$5,$6,true) RETURNING id`,
    [identifiant, empreinte, eleve.tuteur_prenom || 'Tuteur',
     eleve.tuteur_nom || eleve.nom, telephone, eleveId]
  );
  return { identifiant, mot_de_passe: motDePasse, cree: true, utilisateur_id: rows[0].id };
}
