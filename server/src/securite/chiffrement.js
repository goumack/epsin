import crypto from 'node:crypto';

/**
 * Chiffrement symetrique des mots de passe TEMPORAIRES (fiches d acces).
 *
 * AES-256-GCM. La cle derive du jeton de synchronisation (SYNC_JETON)
 * quand il existe : il est commun au site en ligne et au poste de l ecole,
 * qui peuvent ainsi reimprimer tous deux une fiche creee chez l autre.
 * Sinon, elle derive de JWT_SECRET. Sans ce secret, la colonne en base est
 * illisible. Si le secret change, les valeurs deja chiffrees deviennent
 * indechiffrables : dechiffrer() renvoie alors null, et l ecole imprime
 * simplement une nouvelle fiche.
 */

const deriver = (secret) => crypto.createHash('sha256').update(`${secret}:mot-de-passe-temporaire`).digest();
const cleJwt = () => deriver(process.env.JWT_SECRET || 'epsin-dev-secret-a-changer');
const cleSynchro = () => (process.env.SYNC_JETON ? deriver(`synchro:${process.env.SYNC_JETON}`) : null);

/** Texte clair -> "iv.tag.donnees" en base64url. */
export function chiffrer(texte) {
  const iv = crypto.randomBytes(12);
  const chiffreur = crypto.createCipheriv('aes-256-gcm', cleSynchro() || cleJwt(), iv);
  const donnees = Buffer.concat([chiffreur.update(String(texte), 'utf8'), chiffreur.final()]);
  return [iv, chiffreur.getAuthTag(), donnees].map((b) => b.toString('base64url')).join('.');
}

/**
 * Inverse de chiffrer(), ou null si la valeur est absente ou illisible.
 * Essaie la cle de synchronisation puis l ancienne cle (fiches creees
 * avant la synchronisation).
 */
export function dechiffrer(valeur) {
  if (!valeur) return null;
  for (const cle of [cleSynchro(), cleJwt()]) {
    if (!cle) continue;
    try {
      const [iv, tag, donnees] = String(valeur).split('.').map((p) => Buffer.from(p, 'base64url'));
      const dechiffreur = crypto.createDecipheriv('aes-256-gcm', cle, iv);
      dechiffreur.setAuthTag(tag);
      return Buffer.concat([dechiffreur.update(donnees), dechiffreur.final()]).toString('utf8');
    } catch { /* cle suivante */ }
  }
  return null;
}
