/** Prefixes des mobiles senegalais (Orange, Free, Expresso, Promobile). */
const PREFIXES_MOBILES = ['70', '75', '76', '77', '78'];

/**
 * Numero mobile senegalais sur 9 chiffres (771234567), ou null s il n en
 * est pas un. Accepte espaces, points, tirets, +221 et 00221.
 */
export function normaliserTelephone(valeur) {
  let n = String(valeur || '').replace(/[\s.\-()]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('00')) n = n.slice(2);
  if (n.length === 12 && n.startsWith('221')) n = n.slice(3);
  if (!/^\d{9}$/.test(n)) return null;
  return PREFIXES_MOBILES.includes(n.slice(0, 2)) ? n : null;
}
