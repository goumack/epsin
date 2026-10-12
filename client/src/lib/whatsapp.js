/**
 * Envoi de messages par WhatsApp, sans service payant : un lien wa.me ouvre
 * WhatsApp (application ou WhatsApp Web) avec le destinataire et le texte
 * deja remplis ; il ne reste qu a appuyer sur Envoyer. Le message part du
 * compte WhatsApp ouvert sur l appareil : celui de l ecole.
 */

/** Numero WhatsApp de l ecole, d ou partent les messages. */
export const NUMERO_ENVOI = '77 219 77 73';

/** Site des parents : jamais l adresse locale du poste de l ecole. */
const SITE_EN_LIGNE = 'https://epsin-web.onrender.com';

export function adressePublique() {
  const origine = window.location.origin;
  const locale = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origine);
  return locale ? SITE_EN_LIGNE : origine;
}

/**
 * Numero au format international sans « + » (221771234567), ou null s il
 * n est pas exploitable. Un numero senegalais a 9 chiffres recoit 221.
 */
export function numeroWhatsApp(telephone) {
  let n = String(telephone || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.length === 9 && /^[37]/.test(n)) n = `221${n}`;
  return n.length >= 11 && n.length <= 15 ? n : null;
}

/** Lien qui ouvre WhatsApp sur ce numero, message pret. */
export function lienWhatsApp(telephone, texte) {
  const numero = numeroWhatsApp(telephone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texte)}` : null;
}
