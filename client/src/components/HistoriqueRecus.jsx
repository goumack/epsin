import { useEffect, useState } from 'react';
import { MessageCircle, Printer } from 'lucide-react';
import { get, fcfa, dateFr } from '../lib/api';
import { lienWhatsApp } from '../lib/whatsapp';
import { messageRecu } from '../pages/RecuPaiement';
import { libelleMois } from './PaiementWave';
import { Chargement, Puce } from './ui';

/** Detail d un recu en une ligne : « Droit d'inscription, Blouse, Mensualité (juin 2027) ». */
function resume(r) {
  const parFrais = new Map();
  for (const d of r.details || []) {
    const nom = d.frais || 'Versement';
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
export default function HistoriqueRecus({ eleveId = null, personnel = false, titre = 'Historique des paiements' }) {
  const [recus, setRecus] = useState(null);
  const [envoi, setEnvoi] = useState(null);

  useEffect(() => {
    get(eleveId ? `/finances/recus?eleve_id=${eleveId}` : '/finances/recus')
      .then(setRecus).catch(() => setRecus([]));
  }, [eleveId]);

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
              <span className="tabular-nums font-semibold">{fcfa(r.montant)}</span>
              <span className="flex gap-1.5">
                <a href={`/recu/${r.id}`} target="_blank" rel="noopener noreferrer"
                   className="bouton-secondaire px-2.5 py-1.5" title="Voir et imprimer le reçu">
                  <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Imprimer</span>
                </a>
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
    </div>
  );
}
