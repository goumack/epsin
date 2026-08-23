/**
 * Portee d un tuteur : il ne voit QUE son enfant.
 *
 * Un compte parent est rattache a un eleve precis (utilisateur.eleve_suivi_id)
 * et se connecte avec le matricule de cet enfant : ep-2026-0014@epsin.sn.
 * Toute ressource consultee doit concerner cet eleve — notes, bulletin,
 * assiduite, finances. Aucune vue d ensemble, aucun camarade de classe.
 */

/** Vrai si ce compte est un tuteur. */
export function estTuteur(utilisateur) {
  return utilisateur?.role === 'parent';
}

/** Id de l eleve suivi, ou null si le compte n est pas un tuteur. */
export function eleveSuivi(utilisateur) {
  return estTuteur(utilisateur) ? utilisateur.eleve_suivi_id ?? null : null;
}

/**
 * Vrai si le tuteur peut consulter cet eleve. Pour les autres roles, la
 * fonction laisse passer : leur perimetre est fixe ailleurs (entite,
 * portee enseignant).
 */
export function accesEleve(utilisateur, eleveId) {
  if (!estTuteur(utilisateur)) return true;
  const suivi = eleveSuivi(utilisateur);
  return suivi != null && Number(eleveId) === Number(suivi);
}

/**
 * Garde-fou pret a l emploi pour les routes : renvoie un objet
 * { ok, code, message } comme les autres verificateurs du projet.
 */
export function verifierEleveTuteur(utilisateur, eleveId) {
  if (accesEleve(utilisateur, eleveId)) return { ok: true };
  return {
    ok: false, code: 403,
    message: 'Vous ne pouvez consulter que le dossier de votre enfant',
  };
}
