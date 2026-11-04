import crypto from 'node:crypto';

/**
 * Client de l API WavePay : confirmation automatique des paiements Wave.
 *
 * WavePay ecoute le telephone Wave Business de l ecole, rapproche chaque
 * paiement recu de la demande correspondante, puis previent EPSIN par un
 * webhook signe (`payment.succeeded`). L argent ne passe pas par WavePay :
 * il arrive directement sur le compte Wave Business de l ecole.
 *
 * Regles (guide WavePay, section 0) :
 *   - la cle secrete ne quitte jamais le serveur (WAVEPAY_SECRET_KEY) ;
 *   - un paiement n est valide QUE sur un webhook dont la signature est
 *     verifiee — jamais sur le retour du parent ni sur une lecture GET ;
 *   - le parent paie `amount_due`, qui peut depasser le montant de quelques
 *     francs (10 000 -> 10 003) : c est ce qui distingue deux paiements
 *     simultanes du meme prix ;
 *   - chaque creation porte une Idempotency-Key stable.
 *
 * La configuration est lue a chaque appel : les tests la modifient a chaud.
 */

const URL_API = () => String(process.env.WAVEPAY_API_URL || '').replace(/\/+$/, '');

/** Vrai si l API WavePay est configuree (adresse et cle secrete). */
export function wavepayConfigure() {
  return Boolean(URL_API() && process.env.WAVEPAY_SECRET_KEY);
}

/**
 * Appel a l API, avec reessais sur erreur reseau, 429 et 5xx (0,5 s puis
 * 1 s), toujours avec la meme Idempotency-Key.
 */
export async function appelWavepay(methode, chemin, corps = null, idempotencyKey = null) {
  const entetes = { Authorization: `Bearer ${process.env.WAVEPAY_SECRET_KEY}`, Accept: 'application/json' };
  if (corps) entetes['Content-Type'] = 'application/json';
  if (idempotencyKey) entetes['Idempotency-Key'] = idempotencyKey;

  for (let essai = 0; ; essai++) {
    let reponse;
    try {
      reponse = await fetch(URL_API() + chemin, {
        method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      if (essai < 2) { await new Promise((ok) => setTimeout(ok, 500 * 2 ** essai)); continue; }
      throw Object.assign(new Error(`WavePay injoignable : ${err.message}`), { status: 502 });
    }
    if ((reponse.status >= 500 || reponse.status === 429) && essai < 2) {
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** essai));
      continue;
    }
    const donnees = await reponse.json().catch(() => null);
    if (!reponse.ok) {
      const e = donnees?.error || {};
      throw Object.assign(new Error(e.message || `WavePay a refuse la requete (${reponse.status})`), {
        status: reponse.status >= 500 ? 502 : reponse.status === 400 ? 400 : 502,
        code: e.code, param: e.param,
      });
    }
    return donnees;
  }
}

/**
 * Cree le paiement chez WavePay pour une demande EPSIN. Une meme demande
 * redonne toujours le meme paiement (Idempotency-Key) ; un meme parent qui
 * relance voit ses anciens paiements annules (customer_reference).
 */
export function creerPaiementWavepay({ demandeId, montant, telephone, parentId, description, expiresIn = 24 * 3600 }) {
  return appelWavepay('POST', '/v1/payments', {
    amount: Math.round(Number(montant)),
    reference: `EPSIN-${demandeId}`,
    ...(telephone ? { customer_phone: telephone } : {}),
    ...(parentId ? { customer_reference: `parent-${parentId}` } : {}),
    description: String(description || '').slice(0, 200),
    expires_in: expiresIn,
    metadata: { paiement_en_ligne_id: String(demandeId) },
  }, `epsin-paiement-${demandeId}`);
}

/**
 * Verifie l en-tete X-Signature (t=...,v1=...) sur le corps BRUT et renvoie
 * l evenement decode ; leve une erreur sinon. `tolerance` en secondes
 * (null : pas de controle d horodatage, pour le vecteur de test du guide).
 */
export function construireEvenement(corpsBrut, entete, secret, tolerance = 300) {
  const t = /(?:^|,)\s*t=(\d+)/.exec(entete ?? '')?.[1];
  // Plusieurs v1 possibles (rotation de secret) : un seul doit correspondre
  const signatures = [...String(entete ?? '').matchAll(/(?:^|,)\s*v1=([0-9a-f]{64})/g)].map((m) => m[1]);
  if (!t || !signatures.length) throw new Error('X-Signature absent ou mal forme');
  if (tolerance != null && Math.abs(Date.now() / 1000 - Number(t)) > tolerance) {
    throw new Error('Horodatage trop ancien');
  }
  const attendu = crypto.createHmac('sha256', secret).update(`${t}.${corpsBrut.toString('utf8')}`).digest();
  const valide = signatures.some((v1) => crypto.timingSafeEqual(attendu, Buffer.from(v1, 'hex')));
  if (!valide) throw new Error('Signature invalide');
  return JSON.parse(corpsBrut.toString('utf8'));
}

/** Signature d un corps (tests et essais locaux, avec un secret de test). */
export function signerWavepay(corpsBrut, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${corpsBrut}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
