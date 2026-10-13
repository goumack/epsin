/**
 * Regles des mensualites, sans base ni requete : testables isolement.
 *
 * Un frais recurrent (la mensualite) est du chaque mois de l annee
 * scolaire, jusqu a son dernier mois (juin, ou juillet pour une classe
 * d examen). Imputation des versements :
 *   1. un versement qui designe un mois (mois_couvert) regle CE mois — c est
 *      le cas du dernier mois, paye d avance avec l inscription ;
 *   2. les versements sans mois (ou l excedent d un mois deja regle) soldent
 *      les mois restants dans l ordre chronologique : octobre, novembre...
 * Un versement au guichet sans mois indique n est donc jamais perdu, et ne
 * fait jamais payer deux fois le meme mois.
 */

/** Mois de l annee scolaire, au format "AAAA-MM", de la rentree a la fin. */
export function moisDeLAnnee(dateDebut, dateFin) {
  if (!dateDebut || !dateFin) return [];
  const d = new Date(dateDebut);
  const f = new Date(dateFin);
  const mois = [];
  let a = d.getFullYear();
  let m = d.getMonth();
  while (a < f.getFullYear() || (a === f.getFullYear() && m <= f.getMonth())) {
    mois.push(`${a}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m === 12) { m = 0; a += 1; }
  }
  return mois;
}

/**
 * Mois dus pour un frais mensuel : ceux de l annee, jusqu au mois moisFin
 * inclus (numero 1-12). « D octobre a juin » s arrete ainsi a juin meme si
 * l annee scolaire court jusqu en juillet. Sans moisFin : toute l annee.
 */
export function moisDuFrais(moisAnnee, moisFin) {
  if (!moisFin) return moisAnnee;
  const i = moisAnnee.findIndex((m) => Number(m.slice(5)) === Number(moisFin));
  return i < 0 ? moisAnnee : moisAnnee.slice(0, i + 1);
}

/** Nombre de mensualites deja exigibles : les mois deja commences. */
export function nbMoisExigibles(mois, maintenant = new Date()) {
  const courant = moisCourant(maintenant);
  return mois.filter((m) => m <= courant).length;
}

/** Mois courant au format "AAAA-MM". */
export function moisCourant(maintenant = new Date()) {
  return `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}`;
}

/** Normalise les versements : un total seul devient un versement sans mois. */
function versementsDe(paiements) {
  if (Array.isArray(paiements)) {
    return paiements.map((p) => ({ montant: Number(p.montant) || 0, mois: p.mois || null }));
  }
  return [{ montant: Number(paiements) || 0, mois: null }];
}

/**
 * Etat de chaque mois : regle, partiellement regle, echu non regle, a venir.
 * `montant` est la mensualite ; `paiements` la liste des versements
 * [{ montant, mois }] — ou, par compatibilite, un simple total verse.
 */
export function etatDesMois(mois, montant, paiements, maintenant = new Date()) {
  const m = Number(montant);
  const verse = Object.fromEntries(mois.map((x) => [x, 0]));
  let libre = 0;

  // 1. Les versements qui designent un mois reglent ce mois
  for (const p of versementsDe(paiements)) {
    if (p.mois && p.mois in verse) {
      const part = Math.min(p.montant, Math.max(m - verse[p.mois], 0));
      verse[p.mois] += part;
      libre += p.montant - part;
    } else {
      libre += p.montant;
    }
  }
  // 2. Le reste solde les mois dans l ordre chronologique
  for (const x of mois) {
    if (libre <= 0) break;
    const part = Math.min(libre, Math.max(m - verse[x], 0));
    verse[x] += part;
    libre -= part;
  }

  const courant = moisCourant(maintenant);
  return mois.map((libelle) => {
    const v = verse[libelle];
    let statut;
    if (m > 0 && v >= m) statut = 'paye';
    else if (v > 0) statut = 'partiel';
    else if (libelle <= courant) statut = 'en_retard';
    else statut = 'a_venir';
    return { mois: libelle, verse: v, reste_du: Math.max(m - v, 0), statut };
  });
}

/**
 * Reste exigible a ce jour : ce qui manque sur les mois deja commences. Un
 * mois paye d avance (juin a l inscription) ne dispense pas d octobre.
 */
export function resteExigible(etat, maintenant = new Date()) {
  const courant = moisCourant(maintenant);
  return etat.filter((e) => e.mois <= courant).reduce((s, e) => s + e.reste_du, 0);
}

/** Reste a payer sur toute l annee (mois a venir compris). */
export function resteAnnee(etat) {
  return etat.reduce((s, e) => s + e.reste_du, 0);
}

/**
 * Etat tenant compte des sommes declarees par Wave et pas encore verifiees
 * par la caisse : elles soldent les mois dans l ordre, comme le fera la
 * validation. Un mois ainsi couvert passe « en_verification » : on ne le
 * propose plus, ni au parent ni au guichet, pour ne pas le payer deux fois.
 */
export function deduireEnCours(etat, montantEnCours) {
  let libre = Number(montantEnCours) || 0;
  return etat.map((e) => {
    if (libre <= 0 || e.reste_du <= 0) return e;
    const part = Math.min(libre, e.reste_du);
    libre -= part;
    const reste = e.reste_du - part;
    return { ...e, reste_du: reste, en_verification: part, statut: reste === 0 ? 'en_verification' : e.statut };
  });
}

/** Mois non regles, dans l ordre de paiement : le dernier d abord si demande. */
function moisARegler(etat, dernierDabord) {
  const aRegler = etat.filter((e) => e.reste_du > 0);
  return dernierDabord && aRegler.length ? [aRegler.at(-1), ...aRegler.slice(0, -1)] : aRegler;
}

/**
 * Montant a regler pour solder `nbMois` mois non regles : les prochains dans
 * l ordre, ou — a l inscription — le dernier mois de l annee d abord.
 * Un mois partiellement regle compte pour un mois, au prorata de son reste.
 */
export function montantPourMois(etat, nbMois, { dernierDabord = false } = {}) {
  const aRegler = moisARegler(etat, dernierDabord);
  if (nbMois < 1 || nbMois > aRegler.length) return null;
  return aRegler.slice(0, nbMois).reduce((s, e) => s + e.reste_du, 0);
}

/**
 * Ventile un versement sur les mois non regles d un etat : dans l ordre
 * chronologique, ou le dernier mois d abord (inscription). Une ligne par
 * mois couvert : [{ mois, montant }]. Un excedent au-dela de la fin de
 * l annee est porte sur une ligne sans mois (avance), pour ne jamais perdre
 * d argent recu.
 */
export function ventilerVersement(etat, versement, { dernierDabord = false } = {}) {
  const lignes = [];
  let restant = Number(versement) || 0;
  for (const e of moisARegler(etat, dernierDabord)) {
    if (restant <= 0) break;
    if (e.reste_du <= 0) continue;
    const part = Math.min(restant, e.reste_du);
    lignes.push({ mois: e.mois, montant: part });
    restant -= part;
  }
  if (restant > 0) lignes.push({ mois: null, montant: restant });
  return lignes;
}

/**
 * Repartit un versement dans l ordre chronologique, a partir de ce qui est
 * deja paye (total ou liste de versements). Forme historique de
 * ventilerVersement, conservee pour ses appelants.
 */
export function repartirVersement(mois, montantMensuel, dejaPaye, versement) {
  return ventilerVersement(etatDesMois(mois, montantMensuel, dejaPaye), versement);
}
