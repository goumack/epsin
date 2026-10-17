import { useEffect, useState } from 'react';
import { MessageCircle, Pencil, Printer } from 'lucide-react';
import { get, patch, fcfa, dateFr } from '../lib/api';
import { lienWhatsApp } from '../lib/whatsapp';
import { messageRecu } from '../pages/RecuPaiement';
import { libelleMois } from './PaiementWave';
import { Chargement, Erreur, Modale, Puce } from './ui';

/** Detail d un recu en une ligne : « Droit d'inscription, Blouse, Mensualité (juin 2027) ». */
function resume(r) {
  const parFrais = new Map();
  const valides = (r.details || []).filter((d) => !d.annule);
  for (const d of valides.length ? valides : r.details || []) {
    const nom = d.frais || 'Contribution volontaire';
    if (!parFrais.has(nom)) parFrais.set(nom, []);
    if (d.mois) parFrais.get(nom).push(d.mois);
  }
  return [...parFrais].map(([nom, mois]) => {
    if (!mois.length) return nom;
    const periode = mois.length > 1
      ? `${libelleMois(mois[0])} à ${libelleMois(mois.at(-1))}`
      : libelleMois(mois[0]);
    return `${nom} (${periode})`;
  }).join(', ');
}

/**
 * Historique des recus d un eleve : TOUS ses paiements, guichet et Wave,
 * inscription et mensualites, du plus recent au plus ancien. Chaque recu
 * se reimprime et se renvoie par WhatsApp a tout moment : une famille peut
 * redemander un recu des mois apres.
 *
 * `eleveId` : pour le personnel (le parent voit son enfant sans le donner).
 * `personnel` : affiche les recus annules et l envoi WhatsApp.
 */
/**
 * Correction d un recu : on annule les lignes encaissees par erreur (un
 * mois en trop, un mauvais frais), avec un motif. Rien n est efface : les
 * lignes sont barrees sur le recu. On re-encaisse ensuite le bon montant,
 * qui donne un nouveau recu.
 */
function CorrectionRecu({ recuId, onFermer, onCorrige }) {
  const [recu, setRecu] = useState(null);
  const [choix, setChoix] = useState(new Set());
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!recuId) return;
    setRecu(null); setMotif(''); setErreur('');
    get(`/finances/recus/${recuId}`).then((r) => {
      setRecu(r);
      // Une seule ligne : elle est cochee d office
      const actives = r.lignes.filter((l) => !l.annule);
      setChoix(new Set(actives.length === 1 ? [actives[0].id] : []));
    }).catch((e) => setErreur(e.message));
  }, [recuId]);

  const basculer = (id) => setChoix((avant) => {
    const apres = new Set(avant);
    if (apres.has(id)) apres.delete(id); else apres.add(id);
    return apres;
  });
  const total = (recu?.lignes || []).filter((l) => choix.has(l.id)).reduce((t, l) => t + l.montant, 0);

  const annuler = async (reencaisser) => {
    setEnvoi(true);
    setErreur('');
    try {
      await patch(`/finances/paiements/${recuId}/annuler`, { ids: [...choix], motif });
      onCorrige(reencaisser);
    } catch (e) { setErreur(e.message); } finally { setEnvoi(false); }
  };

  return (
    <Modale ouverte={Boolean(recuId)} onFermer={onFermer} titre="Corriger un reçu" taille="sm">
      {!recu ? (erreur ? <Erreur message={erreur} /> : <Chargement />) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-500">
            Reçu <span className="font-mono">{recu.numeros[0]}</span> du {dateFr(recu.date_paiement)}.
            Cochez les lignes encaissées par erreur : elles seront annulées (barrées sur le reçu, jamais effacées).
          </p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {recu.lignes.map((l) => (
              <li key={l.id} className={`flex items-center gap-2 px-3 py-2 ${l.annule ? 'text-slate-400 line-through' : ''}`}>
                <input type="checkbox" disabled={l.annule} checked={choix.has(l.id)} onChange={() => basculer(l.id)}
                       aria-label={`Annuler ${l.frais || 'la contribution'}`} />
                <span className="flex-1">
                  {l.frais || 'Contribution volontaire'}
                  {l.mois && <span className="capitalize text-slate-500"> — {libelleMois(l.mois)}</span>}
                </span>
                <span className="tabular-nums">{fcfa(l.montant)}</span>
              </li>
            ))}
          </ul>
          <div>
            <label className="etiquette" htmlFor="motif-annulation">Motif *</label>
            <input id="motif-annulation" className="champ" value={motif} onChange={(e) => setMotif(e.target.value)}
                   placeholder="Ex. : mois encaissé par erreur, mauvais élève, montant erroné…" />
          </div>
          {recu.mode === 'wave' && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Paiement reçu par Wave : si l'argent n'est pas dû, pensez à rembourser le parent.
            </p>
          )}
          <Erreur message={erreur} />
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <button type="button" className="bouton-secondaire" onClick={onFermer}>Fermer</button>
            <button type="button" className="bouton-secondaire" disabled={envoi || !choix.size || !motif.trim()}
                    onClick={() => annuler(false)}>
              Annuler seulement
            </button>
            <button type="button" className="bouton-primaire" disabled={envoi || !choix.size || !motif.trim()}
                    onClick={() => annuler(true)}>
              {envoi ? 'Annulation…' : `Annuler ${fcfa(total)} et ré-encaisser`}
            </button>
          </div>
        </div>
      )}
    </Modale>
  );
}

export default function HistoriqueRecus({
  eleveId = null, personnel = false, titre = 'Historique des paiements', onReencaisser = null,
}) {
  const [recus, setRecus] = useState(null);
  const [envoi, setEnvoi] = useState(null);
  const [aCorriger, setACorriger] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    get(eleveId ? `/finances/recus?eleve_id=${eleveId}` : '/finances/recus')
      .then(setRecus).catch(() => setRecus([]));
  }, [eleveId, version]);

  /**
   * WhatsApp au tuteur, message pret. La fenetre s ouvre tout de suite (sinon
   * le navigateur la bloquerait), puis recoit le lien une fois le recu lu.
   * Sans numero de tuteur : la page du recu, ou l on saisit le numero.
   */
  const envoyer = async (r) => {
    const fenetre = window.open('', '_blank');
    setEnvoi(r.id);
    try {
      const recu = await get(`/finances/recus/${r.id}`);
      const numero = recu.numeros.length > 1 ? `${recu.numeros[0]} à ${recu.numeros.at(-1)}` : recu.numeros[0];
      const lien = lienWhatsApp(recu.eleve?.tuteur_telephone, messageRecu(recu, numero));
      if (fenetre) fenetre.location.href = lien || `/recu/${r.id}`;
    } catch {
      fenetre?.close();
    } finally {
      setEnvoi(null);
    }
  };

  if (!recus) return <Chargement />;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <h3 className="border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 text-sm font-semibold">
        {titre} <span className="font-normal text-slate-500">· {recus.length} reçu{recus.length > 1 ? 's' : ''}</span>
      </h3>
      {recus.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">Aucun paiement enregistré pour le moment.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {recus.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm ${r.annule ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className={r.annule ? 'line-through' : 'font-medium'}>{resume(r)}</span>
                <span className="block text-xs text-slate-500">
                  {dateFr(r.date_paiement)} · <span className="font-mono">{r.numero_recu}</span>
                  {r.lignes > 1 && ` (${r.lignes} lignes)`}
                </span>
              </span>
              {r.annule && <Puce ton="danger">Annulé</Puce>}
              {r.annule_en_partie && <Puce ton="alerte">Corrigé</Puce>}
              {personnel && r.autres_recettes && <Puce ton="alerte">Autres recettes</Puce>}
              <span className="tabular-nums font-semibold">{fcfa(r.montant)}</span>
              <span className="flex gap-1.5">
                <a href={`/recu/${r.id}`} target="_blank" rel="noopener noreferrer"
                   className="bouton-secondaire px-2.5 py-1.5" title="Voir et imprimer le reçu">
                  <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Imprimer</span>
                </a>
                {personnel && !r.annule && (
                  <button type="button" onClick={() => setACorriger(r.id)}
                          className="bouton-secondaire px-2.5 py-1.5" title="Annuler une ligne encaissée par erreur">
                    <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Corriger</span>
                  </button>
                )}
                {personnel && !r.annule && (
                  <button type="button" onClick={() => envoyer(r)} disabled={envoi === r.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          title="Envoyer le reçu au tuteur par WhatsApp">
                    <MessageCircle className="h-4 w-4" /> <span className="hidden sm:inline">WhatsApp</span>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {personnel && (
        <CorrectionRecu recuId={aCorriger} onFermer={() => setACorriger(null)}
                        onCorrige={(reencaisser) => {
                          setACorriger(null);
                          setVersion((v) => v + 1);
                          onReencaisser?.(reencaisser);
                        }} />
      )}
    </div>
  );
}
