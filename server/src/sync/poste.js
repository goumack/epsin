import {
  lireChangements, appliquerChangements, chargerInstantane, lireEtat, ecrireEtat, cleChangement,
} from './noyau.js';

/**
 * Synchronisation vue du POSTE DE L ECOLE, copie de secours du site en
 * ligne, qui fait reference.
 *
 * Un cycle :
 *   1. RECEVOIR tout ce qui a ete fait en ligne (personnel et parents) :
 *      le poste reste a jour, pret a prendre le relais ;
 *   2. ENVOYER ce qui a ete fait sur le poste pendant une coupure.
 * Recevoir d abord limite les collisions : le poste envoie ensuite un etat
 * qui tient deja compte de l activite en ligne.
 *
 * `distant` est le serveur en ligne : { recevoir, envoyer, instantane }. En production il passe par HTTP (distantHttp) ; dans les
 * tests, directement par une seconde base.
 */

/** Cles des lignes modifiees sur le poste et pas encore envoyees. */
async function clesEnAttente(local) {
  const curseur = Number(await lireEtat(local, 'curseur_envoi', 0));
  const { rows } = await local.query(
    `SELECT DISTINCT table_nom, cle FROM sync_journal WHERE id > $1`, [curseur]
  );
  return new Set(rows.map((r) => cleChangement({ table: r.table_nom, cle: r.cle })));
}

/**
 * Regles d arbitrage a la reception. Ce qui vient d en ligne s applique,
 * sauf :
 *   - une ligne modifiee sur le poste pendant une coupure et pas encore
 *     envoyee : le poste l emporte (c est la saisie la plus recente) ;
 *   - un paiement en ligne deja valide ou rejete sur le poste ne revient
 *     pas a « en attente ».
 */
export function politiqueReception(enAttente) {
  return async (ch, client) => {
    if (enAttente.has(cleChangement(ch))) return null;
    if (ch.table === 'paiement_en_ligne' && ch.operation !== 'D') {
      const { rows } = await client.query(`SELECT statut FROM paiement_en_ligne WHERE id = $1`, [ch.cle.id]);
      const clos = ['reussi', 'rejete'];
      if (rows[0] && clos.includes(rows[0].statut) && !clos.includes(ch.ligne.statut)) return null;
    }
    return ch;
  };
}

/** Un cycle complet : recevoir, puis envoyer. */
export async function synchroniser(local, distant) {
  let recus = 0;
  let curseurRec = Number(await lireEtat(local, 'curseur_reception', 0));
  for (;;) {
    const { changements, curseur } = await distant.recevoir(curseurRec);
    if (!(curseur > curseurRec)) break;
    const enAttente = await clesEnAttente(local);
    recus += await appliquerChangements(local, changements, { politique: politiqueReception(enAttente) });
    curseurRec = curseur;
    await ecrireEtat(local, 'curseur_reception', curseurRec);
  }

  let envoyes = 0;
  let curseurEnv = Number(await lireEtat(local, 'curseur_envoi', 0));
  for (;;) {
    const { changements, curseur } = await lireChangements(local, curseurEnv);
    if (!(curseur > curseurEnv)) break;
    if (changements.length) await distant.envoyer(changements);
    envoyes += changements.length;
    curseurEnv = curseur;
    await ecrireEtat(local, 'curseur_envoi', curseurEnv);
    // Le journal deja envoye ne sert plus
    await local.query(`DELETE FROM sync_journal WHERE id <= $1`, [curseurEnv]);
  }

  await ecrireEtat(local, 'derniere_synchro', new Date().toISOString());
  return { recus, envoyes };
}

/**
 * Premier lancement : le poste recupere toute la base en ligne. Ses propres
 * identifiants partent ensuite de SEUIL_POSTE, pour ne jamais croiser ceux
 * du site en ligne.
 */
export async function cloner(local, distant) {
  const inst = await distant.instantane();
  await chargerInstantane(local, inst);
  await ecrireEtat(local, 'curseur_reception', inst.curseur);
  await ecrireEtat(local, 'curseur_envoi', 0);
  await ecrireEtat(local, 'clone_le', new Date().toISOString());
  return Object.fromEntries(Object.entries(inst.tables).map(([t, l]) => [t, l.length]));
}

/** Serveur en ligne joint par HTTP, avec le jeton de synchronisation. */
export function distantHttp(url, jeton, { delai = 60000 } = {}) {
  const base = String(url).replace(/\/$/, '');
  const appel = async (methode, chemin, corps) => {
    const r = await fetch(`${base}/api/sync${chemin}`, {
      method: methode,
      headers: { 'x-sync-jeton': jeton, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(delai),
    });
    const texte = await r.text();
    let donnees = null;
    try { donnees = texte ? JSON.parse(texte) : null; } catch { /* reponse non JSON */ }
    if (!r.ok) {
      throw Object.assign(new Error(donnees?.erreur || `Serveur en ligne : erreur ${r.status}`), { status: r.status });
    }
    return donnees;
  };
  return {
    recevoir: (depuis) => appel('GET', `/reception?depuis=${depuis}`),
    envoyer: (changements) => appel('POST', '/envoi', { changements }),
    instantane: () => appel('GET', '/instantane'),
  };
}

// ---------- Synchronisation automatique ----------

const etat = { en_cours: false, en_ligne: null, derniere_erreur: null, dernier_essai: null };
let minuterie = null;

/**
 * Lance un cycle toutes les `intervalle` ms. Sans connexion, le cycle
 * echoue sans consequence : les modifications restent dans le journal et
 * partiront au cycle suivant qui reussit.
 */
export function demarrerSynchroAuto(local, distant, { intervalle = 30000, journal = console.log } = {}) {
  const cycle = async () => {
    if (etat.en_cours) return;
    etat.en_cours = true;
    etat.dernier_essai = new Date().toISOString();
    try {
      const r = await synchroniser(local, distant);
      if (etat.en_ligne === false) journal('[synchro] connexion retablie');
      etat.en_ligne = true;
      etat.derniere_erreur = null;
      if (r.recus || r.envoyes) journal(`[synchro] ${r.recus} recu(s), ${r.envoyes} envoye(s)`);
    } catch (err) {
      if (etat.en_ligne !== false) journal(`[synchro] hors ligne : ${err.message}`);
      etat.en_ligne = false;
      etat.derniere_erreur = err.message;
    } finally {
      etat.en_cours = false;
    }
  };
  arreterSynchroAuto();
  minuterie = setInterval(cycle, intervalle);
  cycle();
  return cycle;
}

export function arreterSynchroAuto() {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
}

/** Etat affiche dans l application : en ligne, modifications en attente... */
export async function statutSynchro(local) {
  const curseur = Number(await lireEtat(local, 'curseur_envoi', 0));
  const { rows } = await local.query(
    `SELECT COUNT(DISTINCT (table_nom, cle))::int AS n FROM sync_journal WHERE id > $1`, [curseur]
  );
  return {
    en_ligne: etat.en_ligne,
    en_cours: etat.en_cours,
    en_attente: rows[0].n,
    derniere_synchro: await lireEtat(local, 'derniere_synchro'),
    dernier_essai: etat.dernier_essai,
    derniere_erreur: etat.derniere_erreur,
  };
}
