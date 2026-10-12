/**
 * Regles des mensualites, sans base ni requete : testables isolement.
 *
 * Un frais recurrent (la mensualite) est du chaque mois de l annee
 * scolaire. Les sommes versees sont imputees dans l ordre chronologique :
 * le premier versement solde octobre, le suivant novembre, etc. On ne
 * s appuie donc pas sur `mois_couvert`, que la caisse ne renseigne pas
 * toujours : seul le total verse compte, ce qui evite de faire payer deux
 * fois un mois regle au guichet sans mois indique.
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

/**
 * Etat de chaque mois : regle, partiellement regle, echu non regle, a venir.
 * `montant` est la mensualite, `paye` le total deja verse sur ce frais.
 */
export function etatDesMois(mois, montant, paye, maintenant = new Date()) {
  const m = Number(montant);
  let reste = Number(paye) || 0;
  const courant = moisCourant(maintenant);
  return mois.map((libelle) => {
    const verse = m > 0 ? Math.min(reste, m) : 0;
    reste -= verse;
    let statut;
    if (m > 0 && verse >= m) statut = 'paye';
    else if (verse > 0) statut = 'partiel';
    else if (libelle <= courant) statut = 'en_retard';
    else statut = 'a_venir';
    return { mois: libelle, verse, reste_du: Math.max(m - verse, 0), statut };
  });
}

/**
 * Montant a regler pour solder les `nbMois` prochains mois non regles.
 * Un mois partiellement regle compte pour un mois, au prorata de ce qu il
 * reste a payer dessus.
 */
export function montantPourMois(etat, nbMois) {
  const aRegler = etat.filter((e) => e.statut !== 'paye');
  if (nbMois < 1 || nbMois > aRegler.length) return null;
  return aRegler.slice(0, nbMois).reduce((s, e) => s + e.reste_du, 0);
}

/**
 * Repartit un versement sur les mois, dans l ordre chronologique, a partir
 * de ce qui est deja paye. Retourne une ligne par mois couvert :
 * [{ mois, montant }]. Un excedent au-dela de la fin de l annee est porte
 * sur une ligne sans mois (avance), pour ne jamais perdre d argent recu.
 */
export function repartirVersement(mois, montantMensuel, dejaPaye, versement) {
  const lignes = [];
  let restant = Number(versement) || 0;
  for (const e of etatDesMois(mois, montantMensuel, dejaPaye)) {
    if (restant <= 0) break;
    if (e.reste_du <= 0) continue;
    const part = Math.min(restant, e.reste_du);
    lignes.push({ mois: e.mois, montant: part });
    restant -= part;
  }
  if (restant > 0) lignes.push({ mois: null, montant: restant });
  return lignes;
}
