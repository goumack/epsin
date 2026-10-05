import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Printer, Smartphone, XCircle } from 'lucide-react';
import { get, post, fcfa, dateFr } from '../lib/api';
import { Chargement, Modale, Puce } from './ui';

/** "2025-12" -> "déc. 2025" */
export function libelleMois(mois) {
  if (!mois) return 'Avance';
  const [a, m] = mois.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

const STATUTS_MOIS = {
  paye: { ton: 'succes', texte: 'Réglé' },
  partiel: { ton: 'alerte', texte: 'Partiel' },
  en_retard: { ton: 'danger', texte: 'À régler' },
  a_venir: { ton: 'neutre', texte: 'À venir' },
};

export const STATUTS_PAIEMENT = {
  en_attente: { ton: 'neutre', texte: 'Non déclaré' },
  a_verifier: { ton: 'alerte', texte: 'En vérification' },
  reussi: { ton: 'succes', texte: 'Validé' },
  rejete: { ton: 'danger', texte: 'Rejeté' },
  echoue: { ton: 'danger', texte: 'Échoué' },
  expire: { ton: 'neutre', texte: 'Expiré' },
};

/**
 * Mensualites de l enfant, mois par mois, avec le paiement Wave.
 * Le montant affiche est indicatif : le serveur le recalcule a partir du
 * nombre de mois choisi, jamais a partir d une somme envoyee par le client.
 */
export function MensualitesWave({ onPaye, onErreur }) {
  const [donnees, setDonnees] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [fraisChoisi, setFraisChoisi] = useState(null);
  const [aDeclarer, setADeclarer] = useState(null);   // reprise d une declaration

  const charger = () => {
    get('/paiements-en-ligne/mensualites')
      .then(setDonnees)
      .catch(() => setDonnees({ frais: [], wave: { disponible: false } }));
    get('/paiements-en-ligne').then(setHistorique).catch(() => setHistorique([]));
  };

  useEffect(() => { charger(); }, []);

  if (!donnees) return <Chargement />;
  if (!donnees.frais.length) return null;

  // Relit la situation avant d ouvrir le formulaire : un paiement a pu etre
  // enregistre a la caisse depuis l affichage de la page.
  const ouvrirPaiement = async (fraisId) => {
    try {
      const fraiches = await get('/paiements-en-ligne/mensualites');
      setDonnees(fraiches);
      const f = fraiches.frais.find((x) => x.id === fraisId);
      if (f && f.mois.some((m) => m.statut !== 'paye')) setFraisChoisi(f);
    } catch (err) {
      onErreur?.(err.message);
    }
  };

  const apresPaiement = () => { setFraisChoisi(null); setADeclarer(null); charger(); onPaye?.(); };

  return (
    <div className="space-y-3">
      {donnees.annee?.terminee && (
        <p className="rounded-lg bg-sky-50 dark:bg-sky-900/30 p-3 text-sm text-sky-800 dark:text-sky-200">
          L'année scolaire {donnees.annee.libelle} est terminée. Les mensualités de la nouvelle
          année apparaîtront ici dès que l'établissement aura ouvert la rentrée.
        </p>
      )}
      {donnees.frais.map((f) => {
        const aRegler = f.mois.filter((m) => m.statut !== 'paye');
        const enRetard = f.mois.filter((m) => m.statut === 'en_retard' || m.statut === 'partiel');
        return (
          <div key={f.id} className="carte p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{f.libelle}</h3>
                <p className="text-sm text-slate-500">
                  {fcfa(f.montant)} par mois
                  {enRetard.length > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {' '}· {enRetard.length} mois à régler
                    </span>
                  )}
                </p>
              </div>
              {donnees.wave.disponible && aRegler.length > 0 && (
                <button type="button" className="bouton-wave" onClick={() => ouvrirPaiement(f.id)}>
                  <Smartphone className="h-4 w-4" />
                  Payer avec Wave
                </button>
              )}
            </div>

            {f.en_verification > 0 && (
              <p className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-2.5 text-sm text-amber-800 dark:text-amber-200">
                {fcfa(f.en_verification)} déclaré(s), en cours de vérification par l'établissement.
                Les mois correspondants seront marqués réglés après validation.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {f.mois.map((m) => (
                <div key={m.mois} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-center">
                  <p className="text-xs capitalize text-slate-500">{libelleMois(m.mois)}</p>
                  <div className="mt-1">
                    <Puce ton={STATUTS_MOIS[m.statut].ton}>{STATUTS_MOIS[m.statut].texte}</Puce>
                  </div>
                </div>
              ))}
            </div>

            {aRegler.length === 0 && (
              <p className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-2.5 text-sm text-emerald-800 dark:text-emerald-200">
                Toutes les mensualités de l'année {donnees.annee?.libelle} sont réglées.
              </p>
            )}

            {!donnees.wave.disponible && aRegler.length > 0 && (
              <p className="text-xs text-slate-500">
                Le paiement en ligne n'est pas encore activé : réglez au secrétariat.
              </p>
            )}
          </div>
        );
      })}

      {historique.length > 0 && (
        <div className="carte overflow-hidden">
          <h3 className="border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold">
            Mes paiements Wave
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {historique.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="tabular-nums font-medium">{fcfa(p.montant)}</span>
                <span className="text-slate-500">{p.nb_mois} mois · {dateFr(p.cree_le)}</span>
                {p.transaction_id && <span className="font-mono text-xs text-slate-500">{p.transaction_id}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <Puce ton={STATUTS_PAIEMENT[p.statut]?.ton}>{STATUTS_PAIEMENT[p.statut]?.texte}</Puce>
                  {p.statut === 'reussi' && p.paiement_id && (
                    <a href={`/recu/${p.paiement_id}`} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 underline">
                      <Printer className="h-3.5 w-3.5" /> Reçu
                    </a>
                  )}
                  {p.statut === 'en_attente' && p.mode === 'lien' && (
                    <button type="button" className="text-xs font-medium text-sky-600 underline"
                            onClick={() => setADeclarer(p)}>
                      J'ai payé
                    </button>
                  )}
                </span>
                {p.statut === 'rejete' && p.erreur && (
                  <p className="w-full text-xs text-red-600 dark:text-red-400">Motif : {p.erreur}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ModalePaiementWave
        frais={fraisChoisi}
        mode={donnees.wave.mode}
        onFermer={() => { setFraisChoisi(null); charger(); }}
        onPaye={apresPaiement}
        onErreur={onErreur}
      />
      <Modale ouverte={Boolean(aDeclarer)} onFermer={() => setADeclarer(null)}
              titre="Mon paiement Wave" taille="sm">
        {aDeclarer && (
          <EtapeLien tentative={aDeclarer} onDeclare={apresPaiement} onErreur={onErreur} />
        )}
      </Modale>
    </div>
  );
}

/**
 * Paiement en deux gestes : « Payer avec Wave » ouvre Wave, puis
 * « Oui, j ai paye ». Le reste (choix des mois, reference) est facultatif.
 */
function ModalePaiementWave({ frais, mode, onFermer, onPaye, onErreur }) {
  const [nbMois, setNbMois] = useState(1);
  // Avance : le parent saisit la somme qu il peut verser
  const [libre, setLibre] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [tentative, setTentative] = useState(null);

  useEffect(() => {
    if (!frais) return;
    // Par defaut : solder tout ce qui est echu, au moins un mois
    const echus = frais.mois.filter((m) => m.statut === 'en_retard' || m.statut === 'partiel').length;
    setNbMois(Math.max(echus, 1));
    setLibre(false);
    setSaisie('');
    setTentative(null);
  }, [frais]);

  if (!frais) return null;

  const aRegler = frais.mois.filter((m) => m.statut !== 'paye');
  // Borne le choix aux mois reellement restants : un nombre memorise d une
  // ouverture precedente ne doit jamais partir vers le serveur. Ce qui est
  // affiche et ce qui est envoye viennent de la meme valeur.
  const nb = Math.min(Math.max(nbMois, 1), aRegler.length);
  const couverts = aRegler.slice(0, nb);
  const totalMois = couverts.reduce((s, m) => s + Number(m.reste_du), 0);
  const resteAnnee = aRegler.reduce((s, m) => s + Number(m.reste_du), 0);

  // Montant libre : meme imputation que le serveur, dans l ordre des mois
  const montantLibre = Math.floor(Number(saisie)) || 0;
  const libreValide = montantLibre >= 1 && montantLibre <= resteAnnee;
  const apercu = [];
  for (let r = montantLibre, i = 0; r > 0 && i < aRegler.length; i++) {
    const part = Math.min(r, Number(aRegler[i].reste_du));
    apercu.push({ mois: aRegler[i].mois, part, du: Number(aRegler[i].reste_du) });
    r -= part;
  }

  const total = libre ? montantLibre : totalMois;
  const payable = libre ? libreValide : totalMois > 0;

  const ouvrir = async () => {
    // L onglet Wave est ouvert DES le clic : ouvert apres la reponse du
    // serveur, il serait bloque par le navigateur (anti-fenetres surgissantes).
    const fenetre = mode === 'lien' ? window.open('', '_blank') : null;
    setEnvoi(true);
    try {
      const r = await post('/paiements-en-ligne/wave', libre
        ? { frais_id: frais.id, montant: montantLibre }
        : { frais_id: frais.id, nb_mois: nb });
      if (r.mode === 'api') {
        // Wave prend le relais, puis renvoie vers /mon-enfant?paiement=<id>
        window.location.assign(r.url);
        return;
      }
      if (r.mode === 'lien' && fenetre) {
        fenetre.opener = null;
        fenetre.location.href = r.url;
      } else {
        fenetre?.close();
      }
      setTentative({ ...r, waveOuvert: Boolean(fenetre) });
    } catch (err) {
      fenetre?.close();
      onErreur?.(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  let contenu;
  if (tentative?.mode === 'lien') {
    contenu = <EtapeLien tentative={tentative} onDeclare={onPaye} onErreur={onErreur} />;
  } else if (tentative?.mode === 'simulation') {
    contenu = <EtapeSimulation tentative={tentative} onFini={onPaye} onAnnule={onFermer} onErreur={onErreur} />;
  } else {
    const choix = (actif) => `flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
      actif
        ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100'
        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
    }`;
    contenu = (
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1" role="tablist">
          <button type="button" role="tab" aria-selected={!libre} className={choix(!libre)}
                  onClick={() => setLibre(false)}>
            Mois complets
          </button>
          <button type="button" role="tab" aria-selected={libre} className={choix(libre)}
                  onClick={() => setLibre(true)}>
            Avance (autre montant)
          </button>
        </div>

        {libre ? (
          <div className="space-y-2">
            <label className="etiquette" htmlFor="montant-libre">Montant que vous versez</label>
            <div className="relative">
              <input id="montant-libre" className="champ pr-16 text-lg tabular-nums" type="number"
                     inputMode="numeric" min="1" max={resteAnnee} step="1" autoFocus
                     placeholder="ex. 5000" value={saisie}
                     onChange={(e) => setSaisie(e.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">
                FCFA
              </span>
            </div>
            {montantLibre > resteAnnee ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Au maximum {fcfa(resteAnnee)} : c'est tout ce qui reste à payer cette année.
              </p>
            ) : apercu.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-slate-500">
                {apercu.map((a) => (
                  <li key={a.mois} className="flex justify-between">
                    <span className="capitalize">{libelleMois(a.mois)}</span>
                    <span className="tabular-nums">
                      {a.part >= a.du
                        ? `réglé (${fcfa(a.part)})`
                        : `${fcfa(a.part)} sur ${fcfa(a.du)} — reste ${fcfa(a.du - a.part)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                Versez ce que vous pouvez : le reste du mois pourra être complété plus tard.
              </p>
            )}
          </div>
        ) : aRegler.length > 1 ? (
          <div>
            <label className="etiquette" htmlFor="nb-mois">Mois à régler</label>
            <select id="nb-mois" className="champ" value={nb}
                    onChange={(e) => setNbMois(Number(e.target.value))}>
              {aRegler.map((m, i) => (
                <option key={m.mois} value={i + 1}>
                  {i + 1} mois — jusqu'à {libelleMois(m.mois)} · {fcfa(
                    aRegler.slice(0, i + 1).reduce((s, x) => s + Number(x.reste_du), 0)
                  )}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Mois à régler : <strong className="capitalize text-slate-800 dark:text-slate-200">
              {libelleMois(aRegler[0]?.mois)}
            </strong>
          </p>
        )}

        {!libre && <p className="text-center text-3xl font-semibold tabular-nums">{fcfa(total)}</p>}

        <button type="button" className="bouton-wave w-full py-3 text-base"
                disabled={envoi || !payable} onClick={ouvrir}>
          <Smartphone className="h-5 w-5" />
          {envoi ? 'Ouverture de Wave…'
            : libre && !payable ? 'Saisissez un montant'
              : `Payer ${fcfa(total)} avec Wave`}
        </button>
      </div>
    );
  }

  return (
    <Modale ouverte={Boolean(frais)} onFermer={onFermer} titre={`Payer — ${frais.libelle}`} taille="sm">
      {contenu}
    </Modale>
  );
}

/**
 * Lien marchand, apres ouverture de Wave : un seul bouton, « Oui, j ai
 * paye ». La reference Wave et le numero sont facultatifs — ils aident
 * seulement la caisse a retrouver le paiement plus vite.
 */
function EtapeLien({ tentative, onDeclare, onErreur }) {
  const [transaction, setTransaction] = useState('');
  const [telephone, setTelephone] = useState('');
  const [details, setDetails] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [fini, setFini] = useState(false);
  const url = tentative.url || tentative.url_paiement;

  const declarer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post(`/paiements-en-ligne/${tentative.id}/declarer`, {
        transaction_id: transaction.trim() || null,
        telephone: telephone.trim() || null,
      });
      setFini(true);
    } catch (err) {
      onErreur?.(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  if (fini) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <div>
          <p className="font-semibold">Merci, c'est noté !</p>
          <p className="mt-1 text-sm text-slate-500">
            L'établissement confirme votre paiement de {fcfa(tentative.montant)} dans Wave.
            Vous recevrez une notification, et le mois passera à « Réglé ».
          </p>
        </div>
        <button type="button" className="bouton-primaire w-full" onClick={onDeclare}>Fermer</button>
      </div>
    );
  }

  return (
    <form onSubmit={declarer} className="space-y-4">
      <div className="rounded-lg bg-sky-50 dark:bg-sky-900/30 p-3 text-sm text-sky-900 dark:text-sky-100">
        <p>
          {tentative.waveOuvert ? 'Wave s’est ouvert dans un nouvel onglet.' : 'Ouvrez Wave'}
          {' '}Payez <strong className="tabular-nums">{fcfa(tentative.montant)}</strong>
          {' '}(saisissez-le si le montant n'est pas déjà rempli).
        </p>
        <a href={url} target="_blank" rel="noopener noreferrer"
           className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline">
          <ExternalLink className="h-3.5 w-3.5" />
          {tentative.waveOuvert ? 'Rouvrir Wave' : 'Ouvrir Wave'}
        </a>
      </div>

      <button type="submit" className="bouton-primaire w-full py-3 text-base" disabled={envoi}>
        <CheckCircle2 className="h-5 w-5" />
        {envoi ? 'Envoi…' : 'Oui, j’ai payé'}
      </button>

      {details ? (
        <div className="space-y-3">
          <div>
            <label className="etiquette" htmlFor="transaction">Référence Wave (facultatif)</label>
            <input id="transaction" className="champ font-mono" value={transaction}
                   placeholder="ex. T_ABCD1234EFGH" autoComplete="off"
                   onChange={(e) => setTransaction(e.target.value)} />
          </div>
          <div>
            <label className="etiquette" htmlFor="telephone">Numéro Wave utilisé (facultatif)</label>
            <input id="telephone" className="champ" inputMode="tel" value={telephone}
                   placeholder="77 123 45 67" onChange={(e) => setTelephone(e.target.value)} />
          </div>
        </div>
      ) : (
        <button type="button" className="w-full text-xs text-slate-500 underline"
                onClick={() => setDetails(true)}>
          Ajouter la référence Wave ou le numéro (facultatif, accélère la confirmation)
        </button>
      )}
    </form>
  );
}

/** Developpement sans compte Wave : confirmation simulee. */
function EtapeSimulation({ tentative, onFini, onAnnule, onErreur }) {
  const [envoi, setEnvoi] = useState(false);
  const simuler = async (succes) => {
    setEnvoi(true);
    try {
      await post(`/paiements-en-ligne/${tentative.id}/simuler`, { succes });
      if (succes) onFini(); else onAnnule();
    } catch (err) {
      onErreur?.(err.message);
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-200">
        <strong>Mode simulation.</strong> Aucun moyen de paiement Wave n'est configuré sur ce
        serveur : aucun argent n'est débité.
      </p>
      <p className="text-center text-2xl font-semibold tabular-nums">{fcfa(tentative.montant)}</p>
      <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
        <button type="button" className="bouton-secondaire" disabled={envoi} onClick={() => simuler(false)}>
          Simuler un échec
        </button>
        <button type="button" className="bouton-wave" disabled={envoi} onClick={() => simuler(true)}>
          Confirmer le paiement
        </button>
      </div>
    </div>
  );
}

/**
 * Bandeau affiche au retour de Wave (mode api) : interroge le serveur
 * jusqu a ce que le paiement soit confirme ou abandonne. Le serveur, lui,
 * demande a Wave si le webhook n est pas encore arrive.
 */
export function SuiviPaiement({ id, onTermine, onFermer }) {
  const [pel, setPel] = useState(null);
  const [epuise, setEpuise] = useState(false);

  useEffect(() => {
    let essais = 0;
    let arret = false;
    let minuteur;
    const verifier = async () => {
      try {
        const r = await get(`/paiements-en-ligne/${id}`);
        if (arret) return;
        setPel(r);
        if (r.statut !== 'en_attente') { onTermine?.(r); return; }
      } catch { /* on reessaie */ }
      essais += 1;
      if (essais >= 20) { setEpuise(true); return; }
      minuteur = setTimeout(verifier, 3000);
    };
    verifier();
    return () => { arret = true; clearTimeout(minuteur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const statut = pel?.statut || 'en_attente';
  const styles = {
    en_attente: ['bg-sky-50 dark:bg-sky-900/30 text-sky-800 dark:text-sky-200', Clock],
    a_verifier: ['bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200', Clock],
    reussi: ['bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200', CheckCircle2],
    rejete: ['bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200', XCircle],
    echoue: ['bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200', XCircle],
    expire: ['bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300', XCircle],
  };
  const [classes, Icone] = styles[statut] || styles.en_attente;

  return (
    <div className={`animer flex items-start gap-3 rounded-lg p-3 text-sm ${classes}`} role="status">
      <Icone className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {statut === 'en_attente' && (
          <p>
            {epuise
              ? 'Wave n’a pas encore confirmé ce paiement. Si vous avez été débité, il apparaîtra sous peu ; sinon, contactez le secrétariat.'
              : 'Paiement en cours de confirmation par Wave…'}
          </p>
        )}
        {statut === 'a_verifier' && <p>Paiement déclaré, en cours de vérification par l’établissement.</p>}
        {statut === 'reussi' && (
          <>
            <p className="font-medium">Paiement de {fcfa(pel.montant)} reçu. Merci !</p>
            {pel.recus?.length > 0 && (
              <p className="mt-0.5">
                {pel.recus.map((r) => `${r.numero_recu} (${libelleMois(r.mois)})`).join(' · ')}
              </p>
            )}
          </>
        )}
        {(statut === 'echoue' || statut === 'rejete') && (
          <p>Le paiement n’a pas abouti. Aucun montant n’a été enregistré.</p>
        )}
        {statut === 'expire' && <p>La session de paiement a expiré sans règlement.</p>}
      </div>
      <button type="button" onClick={onFermer} className="text-xs underline">Fermer</button>
    </div>
  );
}

/**
 * Tous les recus de l enfant, guichet et Wave confondus, chacun imprimable.
 * Un paiement Wave n a de recu qu apres sa confirmation par la caisse.
 */
export function ListeRecus() {
  const [recus, setRecus] = useState(null);

  useEffect(() => {
    get('/finances/recus').then(setRecus).catch(() => setRecus([]));
  }, []);

  if (!recus) return <Chargement />;
  if (!recus.length) return null;

  return (
    <div className="carte overflow-hidden">
      <h3 className="border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold">
        Mes reçus de paiement
      </h3>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {recus.map((r) => {
          const mois = r.mois ? r.mois.split(',').filter(Boolean) : [];
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-mono text-xs text-slate-500">{r.numero_recu}</span>
              <span className="min-w-0 flex-1">
                {r.frais || 'Versement'}
                {mois.length > 0 && (
                  <span className="capitalize text-slate-500">
                    {' '}— {mois.length > 1
                      ? `${libelleMois(mois[0])} à ${libelleMois(mois.at(-1))}`
                      : libelleMois(mois[0])}
                  </span>
                )}
                <span className="block text-xs text-slate-500">{dateFr(r.date_paiement)}</span>
              </span>
              <span className="tabular-nums font-medium">{fcfa(r.montant)}</span>
              <a href={`/recu/${r.id}`} target="_blank" rel="noopener noreferrer"
                 className="bouton-secondaire px-3 py-1.5">
                <Printer className="h-4 w-4" /> Reçu
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
