/**
 * Montant en toutes lettres, pour la mention des recus :
 * « Arrete le present recu a la somme de quinze mille francs CFA ».
 *
 * Orthographe traditionnelle : « vingt et un », « soixante et onze »,
 * « quatre-vingts » et « deux cents » au pluriel seulement en fin de nombre
 * ou devant million/milliard (noms), jamais devant « mille » (invariable).
 */

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0 a 99. `pluriel` : « quatre-vingts » peut prendre un s. */
function moinsDeCent(n, pluriel) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    // 70-79 et 90-99 se construisent sur 10-19
    const base = d === 7 ? 'soixante' : 'quatre-vingt';
    if (d === 7 && u === 1) return 'soixante et onze';
    return `${base}-${UNITES[10 + u]}`;
  }
  if (d === 8) return u === 0 ? (pluriel ? 'quatre-vingts' : 'quatre-vingt') : `quatre-vingt-${UNITES[u]}`;
  if (u === 0) return DIZAINES[d];
  if (u === 1) return `${DIZAINES[d]} et un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

/** 0 a 999. */
function moinsDeMille(n, pluriel) {
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c === 0) return moinsDeCent(r, pluriel);
  const cent = c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && pluriel ? 's' : ''}`;
  return r === 0 ? cent : `${cent} ${moinsDeCent(r, pluriel)}`;
}

/** Entier positif ou nul en toutes lettres. */
export function nombreEnLettres(valeur) {
  const n = Math.floor(Math.abs(Number(valeur) || 0));
  if (n === 0) return 'zéro';

  const parties = [];
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const milliers = Math.floor((n % 1e6) / 1e3);
  const reste = n % 1e3;

  if (milliards) parties.push(`${moinsDeMille(milliards, true)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions) parties.push(`${moinsDeMille(millions, true)} million${millions > 1 ? 's' : ''}`);
  // « mille » est invariable et ne prend pas « un » devant
  if (milliers) parties.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`);
  if (reste) parties.push(moinsDeMille(reste, true));
  return parties.join(' ');
}

/** « quinze mille francs CFA » */
export function montantEnLettres(montant) {
  const n = Math.round(Number(montant) || 0);
  const lettres = nombreEnLettres(n);
  // « un million de francs », « deux millions de francs »
  const de = /(million|milliard)s?$/.test(lettres) ? ' de' : '';
  return `${lettres}${de} franc${n > 1 ? 's' : ''} CFA`;
}
