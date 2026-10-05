import crypto from 'node:crypto';

/**
 * Client de l API Checkout de Wave (https://docs.wave.com/checkout).
 *
 * Le parcours :
 *   1. on cree une session de paiement : Wave renvoie `wave_launch_url`,
 *      vers laquelle on redirige le tuteur ;
 *   2. le tuteur paie dans son application Wave ;
 *   3. Wave appelle notre webhook (`checkout.session.completed`), signe
 *      avec le secret du webhook ; on peut aussi relire la session.
 *
 * La configuration est lue a chaque appel, pas au chargement du module :
 * les tests et le mode simulation la modifient a chaud.
 */

const URL_API = () => (process.env.WAVE_API_URL || 'https://api.wave.com').replace(/\/$/, '');

/** Vrai si une cle d API Wave est configuree. */
export function waveConfigure() {
  return Boolean(process.env.WAVE_API_KEY);
}

/** Lien marchand Wave fixe (pay.wave.com/m/...), ou null. */
export function lienMarchand() {
  const lien = process.env.WAVE_LIEN_PAIEMENT?.trim();
  return lien || null;
}

/**
 * Mode de paiement en vigueur, par ordre de preference :
 *   'api'         cle API : confirmation automatique
 *   'lien'        lien marchand : verification par la caisse
 *   'simulation'  ni l un ni l autre, hors production
 *   null          rien de configure en production : paiement indisponible
 */
export function modePaiement() {
  if (waveConfigure()) return 'api';
  if (lienMarchand()) return 'lien';
  if (process.env.NODE_ENV !== 'production') return 'simulation';
  return null;
}

/** Vrai en mode simulation (developpement sans compte Wave). */
export function modeSimulation() {
  return modePaiement() === 'simulation';
}

/**
 * Lien marchand avec le montant pre-rempli. Le parametre `amount` est
 * ajoute pour que le tuteur n ait pas a saisir la somme ; s il n est pas
 * pris en compte par Wave, le montant reste affiche dans le portail.
 */
export function lienAvecMontant(montant) {
  const lien = lienMarchand();
  if (!lien) return null;
  const url = new URL(lien);
  url.searchParams.set('amount', String(Math.round(Number(montant))));
  return url.toString();
}

async function appelWave(methode, chemin, corps) {
  const reponse = await fetch(`${URL_API()}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await reponse.text();
  let donnees = null;
  try { donnees = texte ? JSON.parse(texte) : null; } catch { /* reponse non JSON */ }
  if (!reponse.ok) {
    const detail = donnees?.message || donnees?.code || texte.slice(0, 200);
    throw Object.assign(new Error(`Wave a refuse la requete (${reponse.status}) : ${detail}`), {
      status: 502,
    });
  }
  return donnees;
}

/**
 * Cree une session de paiement. `montant` en francs CFA, entier : le XOF
 * n a pas de subdivision et Wave attend une chaine.
 */
export function creerSession({ montant, reference, urlSucces, urlErreur }) {
  return appelWave('POST', '/v1/checkout/sessions', {
    amount: String(Math.round(Number(montant))),
    currency: 'XOF',
    client_reference: reference,
    success_url: urlSucces,
    error_url: urlErreur,
  });
}

/** Relit une session : sert quand le webhook tarde ou s est perdu. */
export function lireSession(sessionId) {
  return appelWave('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/** Ecart toleré entre l horodatage signe et l heure du serveur. */
const TOLERANCE_SECONDES = 5 * 60;

/**
 * Verifie l en-tete `Wave-Signature: t=<horodatage>,v1=<signature>[,v1=...]`.
 * La signature est un HMAC-SHA256, avec le secret du webhook, de
 * l horodatage suivi du corps BRUT de la requete — d ou la necessite de
 * recevoir le corps sans le faire passer par express.json().
 */
export function signatureValide(entete, corpsBrut, secret = process.env.WAVE_WEBHOOK_SECRET,
  maintenant = Date.now()) {
  if (!entete || !secret || corpsBrut == null) return false;
  let horodatage = null;
  const signatures = [];
  for (const partie of String(entete).split(',')) {
    const [cle, valeur] = partie.trim().split('=');
    if (cle === 't') horodatage = valeur;
    else if (cle === 'v1' && valeur) signatures.push(valeur);
  }
  if (!horodatage || !signatures.length) return false;

  // Refuse un message ancien rejoue
  const ecart = Math.abs(maintenant / 1000 - Number(horodatage));
  if (!Number.isFinite(ecart) || ecart > TOLERANCE_SECONDES) return false;

  const attendu = crypto.createHmac('sha256', secret)
    .update(horodatage + corpsBrut.toString('utf8'))
    .digest('hex');
  const bufAttendu = Buffer.from(attendu, 'hex');
  return signatures.some((s) => {
    const buf = Buffer.from(s, 'hex');
    return buf.length === bufAttendu.length && crypto.timingSafeEqual(buf, bufAttendu);
  });
}

/** Produit un en-tete signe — pour les tests uniquement. */
export function signer(corpsBrut, secret, horodatage = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret)
    .update(String(horodatage) + corpsBrut)
    .digest('hex');
  return `t=${horodatage},v1=${sig}`;
}
