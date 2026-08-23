import { useEffect, useRef, useState } from 'react';
import { X, Search, Loader2, Inbox, AlertCircle } from 'lucide-react';

/** Indicateur de chargement centre. */
export function Chargement({ texte = 'Chargement…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Loader2 className="h-7 w-7 animate-spin" />
      <p className="text-sm">{texte}</p>
    </div>
  );
}

/** Etat vide, affiche quand une liste ne renvoie rien. */
export function Vide({ titre = 'Aucune donnée', texte, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4">
        <Inbox className="h-7 w-7 text-slate-400" />
      </div>
      <div>
        <p className="font-medium text-slate-700 dark:text-slate-300">{titre}</p>
        {texte && <p className="mt-1 text-sm text-slate-500">{texte}</p>}
      </div>
      {action}
    </div>
  );
}

/** Message d erreur non bloquant. */
export function Erreur({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** Badge colore selon une intention. */
export function Puce({ children, ton = 'neutre' }) {
  const tons = {
    neutre: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    succes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    alerte: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    danger: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    info: 'bg-marine-100 text-marine-700 dark:bg-marine-950 dark:text-marine-300',
  };
  return <span className={`puce ${tons[ton] || tons.neutre}`}>{children}</span>;
}

/** Champ de recherche avec effacement rapide. */
export function Recherche({ valeur, onChange, placeholder = 'Rechercher…' }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        className="champ pl-9 pr-8"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {valeur && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Effacer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Fenetre modale accessible : fermeture par Echap et clic exterieur. */
export function Modale({ ouverte, onFermer, titre, children, taille = 'md' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ouverte) return;
    const auClavier = (e) => { if (e.key === 'Escape') onFermer(); };
    document.addEventListener('keydown', auClavier);
    // Empeche le defilement de l arriere-plan
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', auClavier);
      document.body.style.overflow = overflow;
    };
  }, [ouverte, onFermer]);

  if (!ouverte) return null;
  const tailles = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === ref.current) onFermer(); }}
      ref={ref}
      role="dialog"
      aria-modal="true"
    >
      <div className={`animer w-full ${tailles[taille]} max-h-[92vh] overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-xl flex flex-col`}>
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4 shrink-0">
          <h2 className="font-semibold text-lg">{titre}</h2>
          <button
            onClick={onFermer}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** Tuile de statistique du tableau de bord. */
export function Statistique({ titre, valeur, icone: Icone, ton = 'info', detail }) {
  const tons = {
    info: 'bg-marine-50 text-marine-600 dark:bg-marine-950 dark:text-marine-400',
    succes: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    alerte: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    danger: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  };
  // Les montants en FCFA sont longs : on reduit la taille au-dela d un
  // certain nombre de caracteres pour eviter la troncature.
  const texte = String(valeur ?? '');
  const taille = texte.length > 15 ? 'text-lg' : texte.length > 11 ? 'text-xl' : 'text-2xl';

  return (
    <div className="carte p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500 truncate">{titre}</p>
          <p className={`mt-1.5 font-semibold tabular-nums leading-tight ${taille}`}>{valeur}</p>
          {detail && <p className="mt-1 text-xs text-slate-400 truncate">{detail}</p>}
        </div>
        {Icone && (
          <div className={`rounded-xl p-2.5 shrink-0 ${tons[ton]}`}>
            <Icone className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Onglets simples, pilotes par l appelant. */
export function Onglets({ onglets, actif, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {onglets.map((o) => (
        <button
          key={o.cle}
          onClick={() => onChange(o.cle)}
          className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            actif === o.cle
              ? 'border-marine-600 text-marine-600 dark:text-marine-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

/** Notification ephemere. */
export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const Toast = () => toast ? (
    <div className={`animer fixed bottom-4 right-4 z-[60] rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
      toast.type === 'erreur' ? 'bg-red-600' : 'bg-slate-800 dark:bg-slate-700'
    }`}>
      {toast.message}
    </div>
  ) : null;

  return {
    Toast,
    succes: (message) => setToast({ message, type: 'succes' }),
    erreur: (message) => setToast({ message, type: 'erreur' }),
  };
}
