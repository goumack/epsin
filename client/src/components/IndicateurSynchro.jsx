import { useEffect, useState, useCallback } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { get, post } from '../lib/api';

/** « il y a 2 min » */
function depuis(iso) {
  if (!iso) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

/**
 * Etat de la synchronisation, affiche seulement sur le poste de l ecole
 * (programme Windows). Ailleurs, la route n existe pas et rien ne s affiche.
 *
 * Hors ligne, le travail continue normalement : les modifications attendent
 * et partent d elles-memes au retour de la connexion.
 */
export default function IndicateurSynchro() {
  const [statut, setStatut] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState('');

  const lire = useCallback(() => {
    get('/synchro/statut').then(setStatut).catch(() => setStatut(null));
  }, []);

  useEffect(() => {
    lire();
    const t = setInterval(lire, 15000);
    return () => clearInterval(t);
  }, [lire]);

  if (!statut) return null;

  const synchroniser = async () => {
    setEnvoi(true);
    setMessage('');
    try {
      setStatut(await post('/synchro/maintenant', {}));
    } catch (e) {
      setMessage(e.message);
      lire();
    } finally {
      setEnvoi(false);
    }
  };

  const horsLigne = statut.en_ligne === false;
  const attente = statut.en_attente || 0;
  const titre = horsLigne
    ? `Hors ligne — le travail continue. ${attente} modification(s) partiront au retour de la connexion.`
    : `Synchronisé ${depuis(statut.derniere_synchro)}${attente ? ` — ${attente} en attente` : ''}`;

  return (
    <div className="flex items-center gap-1" title={message || statut.derniere_erreur || titre}>
      <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
        horsLigne
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`}>
        {horsLigne ? <CloudOff className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
        {horsLigne
          ? `Hors ligne${attente ? ` · ${attente} en attente` : ''}`
          : `Synchronisé ${depuis(statut.derniere_synchro)}${attente ? ` · ${attente} en attente` : ''}`}
      </span>
      <button type="button" onClick={synchroniser} disabled={envoi || statut.en_cours}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              aria-label="Synchroniser maintenant">
        <RefreshCw className={`h-5 w-5 ${envoi || statut.en_cours ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
