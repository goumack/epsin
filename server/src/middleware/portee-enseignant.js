import { query } from '../db/pool.js';

/**
 * Portee d un enseignant : il ne voit que SES eleves et SES matieres.
 *
 * Regles metier (confirmees par l utilisateur) :
 *   - Un professeur du moyen/secondaire ne voit que les classes ou il a une
 *     affectation, et dans le bulletin d un eleve, uniquement les matieres
 *     qu il enseigne lui-meme.
 *   - Un maitre de l elementaire ne voit que SA classe (il en est le
 *     titulaire unique), avec l integralite des domaines puisqu il les
 *     enseigne tous.
 *   - EXCEPTION : le PROFESSEUR PRINCIPAL d une classe voit l integralite du
 *     bulletin de ses eleves, toutes matieres confondues — c est lui qui
 *     presente le conseil de classe.
 *
 * Les chefs (admin, directeur, proviseur, censeur) ne sont pas concernes :
 * leur perimetre est deja fixe par le cloisonnement d entite.
 */

/** Vrai si ce compte est soumis a la portee « enseignant ». */
export function estEnseignant(utilisateur) {
  return utilisateur?.role === 'enseignant';
}

/** Fiche enseignant liee au compte, ou null. */
export async function enseignantDuCompte(utilisateurId) {
  const { rows } = await query(
    `SELECT id, entite FROM enseignant WHERE utilisateur_id = $1`,
    [utilisateurId]
  );
  return rows[0] || null;
}

/**
 * Ids des classes qu un enseignant peut voir : celles ou il enseigne, plus
 * celles dont il est professeur principal, plus sa classe de titulaire a
 * l elementaire.
 */
export async function classesDeLEnseignant(utilisateur) {
  const ens = await enseignantDuCompte(utilisateur.id);
  if (!ens) return [];
  const { rows } = await query(
    `SELECT DISTINCT c.id
     FROM classe c
     LEFT JOIN affectation a ON a.classe_id = c.id AND a.enseignant_id = $1
     LEFT JOIN classe_maitre cm ON cm.classe_id = c.id AND cm.enseignant_id = $1
     WHERE a.id IS NOT NULL
        OR cm.id IS NOT NULL
        OR c.prof_principal_id = $2`,
    [ens.id, utilisateur.id]
  );
  return rows.map((r) => r.id);
}

/** Vrai si l enseignant est professeur principal de cette classe. */
export async function estProfPrincipal(utilisateur, classeId) {
  const { rows } = await query(
    `SELECT 1 FROM classe WHERE id = $1 AND prof_principal_id = $2`,
    [classeId, utilisateur.id]
  );
  return rows.length > 0;
}

/**
 * Vrai si l enseignant voit l integralite des matieres d une classe :
 * soit il en est le professeur principal, soit c est sa classe de maitre
 * unique a l elementaire (il enseigne alors tous les domaines).
 */
export async function voitToutesMatieres(utilisateur, classeId) {
  if (await estProfPrincipal(utilisateur, classeId)) return true;
  const ens = await enseignantDuCompte(utilisateur.id);
  if (!ens) return false;
  const { rows } = await query(
    `SELECT 1 FROM classe_maitre WHERE classe_id = $1 AND enseignant_id = $2`,
    [classeId, ens.id]
  );
  return rows.length > 0;
}

/** Vrai si l enseignant a acces a cette classe. */
export async function accesClasse(utilisateur, classeId) {
  const classes = await classesDeLEnseignant(utilisateur);
  return classes.includes(Number(classeId));
}

/**
 * Ids des matieres qu un enseignant enseigne dans une classe donnee.
 * Sert a filtrer un bulletin quand il n est pas professeur principal.
 */
export async function matieresDeLEnseignant(utilisateur, classeId) {
  const ens = await enseignantDuCompte(utilisateur.id);
  if (!ens) return [];
  // Affectations explicites, plus — pour un maitre unique — toutes les
  // matieres du niveau de sa classe, y compris celles ajoutees apres coup
  // par la direction et pas encore affectees.
  const { rows } = await query(
    `SELECT DISTINCT matiere_id FROM affectation
     WHERE enseignant_id = $1 AND classe_id = $2
     UNION
     SELECT DISTINCT mn.matiere_id FROM classe_maitre cm
     JOIN classe c ON c.id = cm.classe_id
     JOIN matiere_niveau mn ON mn.niveau_id = c.niveau_id
     WHERE cm.enseignant_id = $1 AND cm.classe_id = $2`,
    [ens.id, classeId]
  );
  return rows.map((r) => r.matiere_id);
}

/**
 * Fragment SQL restreignant une requete aux classes de l enseignant.
 * `alias` designe la table `classe`. Retourne { clause, params }.
 * Vide si l utilisateur n est pas un enseignant (aucune restriction).
 */
export async function filtreClassesEnseignant(utilisateur, alias = 'c', indexDepart = 1) {
  if (!estEnseignant(utilisateur)) return { clause: '', params: [] };
  const classes = await classesDeLEnseignant(utilisateur);
  if (!classes.length) {
    return { clause: 'false', params: [] };   // aucune classe : ne rien renvoyer
  }
  return {
    clause: `${alias}.id = ANY($${indexDepart}::int[])`,
    params: [classes],
  };
}
