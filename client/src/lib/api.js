/**
 * Racine de l API.
 *
 * En developpement, le proxy Vite renvoie `/api` vers localhost:4000.
 * En production, l interface et l API sont sur deux domaines distincts :
 * VITE_API_URL porte alors l adresse complete du service, injectee au
 * moment du build.
 */
const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

/** Recupere le jeton stocke. localStorage peut lever une exception (navigation privee). */
export function lireJeton() {
  try { return localStorage.getItem('epsin_token'); } catch { return null; }
}

export function ecrireJeton(token) {
  try {
    if (token) localStorage.setItem('epsin_token', token);
    else localStorage.removeItem('epsin_token');
  } catch { /* stockage indisponible : la session vaut pour l onglet */ }
}

/** Appel HTTP centralise : ajoute le jeton et normalise les erreurs. */
export async function api(chemin, options = {}) {
  const { methode = 'GET', corps, ...reste } = options;
  const entetes = { ...(reste.headers || {}) };
  const jeton = lireJeton();
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';

  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
    ...reste,
  });

  // Session expiree : on nettoie et on renvoie vers la connexion
  if (reponse.status === 401 && jeton) {
    ecrireJeton(null);
    window.location.href = '/connexion';
    throw new Error('Session expiree');
  }

  const type = reponse.headers.get('content-type') || '';
  const donnees = type.includes('application/json') ? await reponse.json() : null;

  if (!reponse.ok) {
    throw new Error(donnees?.erreur || `Erreur ${reponse.status}`);
  }
  return donnees;
}

export const get = (chemin) => api(chemin);
export const post = (chemin, corps) => api(chemin, { methode: 'POST', corps });
export const put = (chemin, corps) => api(chemin, { methode: 'PUT', corps });
export const patch = (chemin, corps) => api(chemin, { methode: 'PATCH', corps });
export const supprimer = (chemin) => api(chemin, { methode: 'DELETE' });

/** Formate un montant en francs CFA. */
export function fcfa(montant) {
  if (montant == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(Number(montant)) + ' FCFA';
}

/** Formate une date ISO en jj/mm/aaaa. */
export function dateFr(valeur) {
  if (!valeur) return '—';
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
}

/** Couleur d une moyenne selon le bareme sur 20. */
export function couleurNote(note) {
  if (note == null) return 'text-slate-400';
  if (note >= 14) return 'text-emerald-600 dark:text-emerald-400';
  if (note >= 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
