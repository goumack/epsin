import crypto from 'node:crypto';

/**
 * Chiffrement symetrique des mots de passe TEMPORAIRES (fiches d acces).
 *
 * AES-256-GCM, cle derivee de JWT_SECRET : sans le secret du serveur, la
 * colonne en base est illisible. Si le secret change, les valeurs deja
 * chiffrees deviennent indechiffrables : dechiffrer() renvoie alors null,
 * et l ecole imprime simplement une nouvelle fiche.
 */

function cle() {
  const secret = process.env.JWT_SECRET || 'epsin-dev-secret-a-changer';
  return crypto.createHash('sha256').update(`${secret}:mot-de-passe-temporaire`).digest();
}

/** Texte clair -> "iv.tag.donnees" en base64url. */
export function chiffrer(texte) {
  const iv = crypto.randomBytes(12);
  const chiffreur = crypto.createCipheriv('aes-256-gcm', cle(), iv);
  const donnees = Buffer.concat([chiffreur.update(String(texte), 'utf8'), chiffreur.final()]);
  return [iv, chiffreur.getAuthTag(), donnees].map((b) => b.toString('base64url')).join('.');
}

/** Inverse de chiffrer(), ou null si la valeur est absente ou illisible. */
export function dechiffrer(valeur) {
  if (!valeur) return null;
  try {
    const [iv, tag, donnees] = String(valeur).split('.').map((p) => Buffer.from(p, 'base64url'));
    const dechiffreur = crypto.createDecipheriv('aes-256-gcm', cle(), iv);
    dechiffreur.setAuthTag(tag);
    return Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()]).toString('utf8');
  } catch {
    return null;
  }
}
