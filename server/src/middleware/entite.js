/**
 * Cloisonnement par entité.
 *
 * L établissement regroupe deux entités dirigées séparément, avec des
 * équipes de direction distinctes :
 *   - « scolaire »   : l élémentaire (CI -> CM2), dirigé par le DIRECTEUR
 *                       de l école, qui encadre les maitres.
 *   - « secondaire » : le moyen et le secondaire, diriges par le PROVISEUR,
 *                       secondé par le CENSEUR (vie scolaire, discipline).
 *                       Le censeur n est PAS un rôle transverse : c est
 *                       l adjoint du proviseur, donc cloisonné sur
 *                       « secondaire » exactement comme lui.
 *
 * Un directeur, un proviseur ou un censeur ne voit que son entité. L admin
 * et le comptable voient l ensemble (la caisse est commune a l etablissement).
 */

/** Rôles dont la vue est limitée à leur propre entité. */
const ROLES_CLOISONNES = ['directeur', 'proviseur', 'censeur', 'enseignant'];

/**
 * Entité applicable à la requête, ou null si l utilisateur voit tout.
 * Le rôle fixe l entité par défaut quand elle n est pas renseignée sur le
 * compte : directeur -> scolaire, proviseur/censeur -> secondaire.
 */
export function entiteDe(utilisateur) {
  if (!utilisateur) return null;
  if (!ROLES_CLOISONNES.includes(utilisateur.role)) return null;
  if (utilisateur.entite) return utilisateur.entite;
  if (utilisateur.role === 'directeur') return 'scolaire';
  if (utilisateur.role === 'proviseur' || utilisateur.role === 'censeur') return 'secondaire';
  return null; // enseignant sans entite : pas de restriction supplementaire
}

/**
 * Fragment SQL restreignant une requête à l entité de l utilisateur.
 * `alias` est l alias de la table `niveau` dans la requête appelante.
 * Retourne { clause, params } ; la clause vaut '' si aucun filtre ne s applique.
 *
 * Le numero de depart des parametres est fourni par l appelant pour ne pas
 * entrer en conflit avec ses propres $1, $2...
 */
export function filtreEntite(utilisateur, alias = 'n', indexDepart = 1) {
  const entite = entiteDe(utilisateur);
  if (!entite) return { clause: '', params: [] };
  return {
    clause: `${alias}.entite = $${indexDepart}`,
    params: [entite],
  };
}

/**
 * Middleware : expose req.entite (null = accès complet) pour que les
 * routes puissent filtrer sans réinterroger le rôle.
 */
export function porteeEntite(req, res, next) {
  req.entite = entiteDe(req.user);
  next();
}

/**
 * Vérifie qu une ressource appartient bien à l entité de l utilisateur.
 * Renvoie true si l accès est permis.
 */
export function accesAutorise(utilisateur, entiteRessource) {
  const entite = entiteDe(utilisateur);
  if (!entite) return true;                 // admin, comptable : transverses
  if (!entiteRessource) return false;       // ressource non rattachee
  return entite === entiteRessource;
}

/** Roles de direction, tous entites confondues. */
export const DIRECTION = ['admin', 'directeur', 'proviseur'];

/** Roles habilites a gerer la scolarite dans leur perimetre. */
export const GESTION_SCOLAIRE = ['admin', 'censeur', 'directeur', 'proviseur'];

/**
 * Chef hierarchique d une entite : c est lui qui statue sur les demandes
 * d absence des enseignants de son perimetre.
 *   scolaire   -> le directeur encadre les maitres
 *   secondaire -> le proviseur encadre les professeurs
 */
export const CHEF_ENTITE = { scolaire: 'directeur', secondaire: 'proviseur' };

/** Roles habilites a statuer sur une demande d absence d enseignant. */
export const VALIDATION_ABSENCES = ['admin', 'directeur', 'proviseur'];
