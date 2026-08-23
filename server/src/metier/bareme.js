/**
 * Regles de notation de l etablissement.
 *
 * Fonctions pures, sans base ni requete : elles traduisent une moyenne en
 * mention, en appreciation litterale ou en proposition de conseil de classe.
 * Extraites des routes pour etre testables isolement.
 */

/** Mention portee au bas du bulletin. */
export function mentionDe(m) {
  if (m == null) return null;
  if (m >= 16) return 'Tres bien';
  if (m >= 14) return 'Bien';
  if (m >= 12) return 'Assez bien';
  if (m >= 10) return 'Passable';
  return 'Insuffisant';
}

/**
 * Appreciation litterale portee en face de chaque matiere sur le bulletin
 * officiel (« Excellent travail », « Tres Bon Travail »...).
 */
export function appreciationDe(m) {
  // Number(null) vaut 0 : sans ce garde, une matiere sans moyenne
  // recevrait « Travail Insuffisant » au lieu de rester vide.
  if (m == null || m === '') return null;
  const v = Number(m);
  if (!Number.isFinite(v)) return null;
  if (v >= 18) return 'Excellent travail';
  if (v >= 16) return 'Tres Bon Travail';
  if (v >= 14) return 'Bon Travail';
  if (v >= 12) return 'Assez Bon Travail';
  if (v >= 10) return 'Travail Passable';
  if (v >= 8) return 'Doit fournir plus d efforts';
  return 'Travail Insuffisant';
}

/**
 * Propositions du conseil de classe, pre-cochees d apres la moyenne
 * generale. Le conseil reste libre de les corriger avant impression.
 */
export function propositionsConseil(moyenne) {
  // Sans moyenne (eleve nouvellement inscrit, aucune note saisie), on ne
  // propose RIEN : suggerer un redoublement faute de notes serait injuste.
  if (moyenne == null || moyenne === '') return { appreciation: null, distinction: null };
  const v = Number(moyenne);
  if (!Number.isFinite(v)) return { appreciation: null, distinction: null };

  let appreciation;
  if (v >= 12) appreciation = 'satisfaisant';
  else if (v >= 10) appreciation = 'peut_mieux_faire';
  else if (v >= 8) appreciation = 'insuffisant';
  else appreciation = 'risque_redoubler';

  let distinction = null;
  if (v >= 16) distinction = 'felicitations';
  else if (v >= 14) distinction = 'tableau_honneur';
  else if (v >= 12) distinction = 'encouragement';
  else if (v < 8) distinction = 'avertissement';

  return { appreciation, distinction };
}

/**
 * Moyenne d une matiere a partir de ses evaluations, ramenee sur 20 et
 * ponderee par le coefficient de chaque epreuve.
 *
 * Une note `null` signifie « absent a l epreuve » : elle est EXCLUE du
 * calcul, elle ne vaut pas zero. Sans aucune note chiffree, la moyenne
 * n existe pas (null), elle ne vaut pas zero non plus.
 */
export function moyenneMatiere(evaluations = []) {
  let points = 0;
  let coefficients = 0;
  for (const e of evaluations) {
    if (e?.valeur == null) continue;
    const bareme = Number(e.bareme) || 20;
    const coef = Number(e.coefficient) || 1;
    points += (Number(e.valeur) * coef * 20) / bareme;
    coefficients += coef;
  }
  if (!coefficients) return null;
  return Number((points / coefficients).toFixed(2));
}

/**
 * Moyenne generale : moyennes de matieres ponderees par le coefficient de
 * la matiere au niveau concerne.
 */
export function moyenneGenerale(matieres = []) {
  let points = 0;
  let coefficients = 0;
  for (const m of matieres) {
    if (m?.moyenne == null) continue;
    const coef = Number(m.coefficient) || 1;
    points += Number(m.moyenne) * coef;
    coefficients += coef;
  }
  if (!coefficients) return null;
  return Number((points / coefficients).toFixed(2));
}
