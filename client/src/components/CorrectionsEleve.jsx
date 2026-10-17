import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { put, supprimer } from '../lib/api';
import { Modale, Erreur } from './ui';

const LIENS = ['père', 'mère', 'tuteur', 'tutrice', 'oncle', 'tante', 'grand-parent', 'frère', 'sœur'];

/** Date ISO -> valeur d un champ date (AAAA-MM-JJ). */
const versChampDate = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * Correction d une inscription : identite de l eleve et tuteurs. Sert aux
 * erreurs de saisie (nom mal orthographie, date de naissance, telephone du
 * parent...). Le matricule, lui, ne change pas : il sert d identifiant au
 * compte parent.
 */
export function ModifierEleve({ eleve, ouvert, onFermer, onModifie }) {
  const [f, setF] = useState({});
  const [tuteurs, setTuteurs] = useState([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!ouvert || !eleve) return;
    setErreur('');
    setF({
      prenom: eleve.prenom || '', nom: eleve.nom || '', sexe: eleve.sexe || '',
      date_naissance: versChampDate(eleve.date_naissance), lieu_naissance: eleve.lieu_naissance || '',
      nationalite: eleve.nationalite || '', adresse: eleve.adresse || '',
    });
    setTuteurs((eleve.tuteurs || []).map((t) => ({
      id: t.id, prenom: t.prenom || '', nom: t.nom || '', telephone: t.telephone || '',
      lien: t.lien || 'tuteur', principal: Boolean(t.principal),
    })));
  }, [ouvert, eleve]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));
  const majTuteur = (i, champ, valeur) => setTuteurs((ts) => ts.map((t, j) => (j === i ? { ...t, [champ]: valeur } : t)));

  const enregistrer = async (e) => {
    e.preventDefault();
    setErreur('');
    if (tuteurs.some((t) => !t.nom.trim() || !t.telephone.trim())) {
      setErreur('Chaque tuteur doit avoir un nom et un téléphone (ou retirez la ligne).');
      return;
    }
    setEnvoi(true);
    try {
      await put(`/eleves/${eleve.id}`, {
        ...f,
        sexe: f.sexe || null,
        date_naissance: f.date_naissance || null,
      });
      await put(`/eleves/${eleve.id}/tuteurs`, { tuteurs });
      onModifie();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Modifier l'élève" taille="md">
      <form onSubmit={enregistrer} className="space-y-4">
        <p className="text-xs text-slate-500">
          Matricule <span className="font-mono">{eleve?.matricule}</span> — il ne change pas : il sert
          d'identifiant au compte du parent.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiquette" htmlFor="m-prenom">Prénom *</label>
            <input id="m-prenom" className="champ" required value={f.prenom || ''} onChange={maj('prenom')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="m-nom">Nom *</label>
            <input id="m-nom" className="champ" required value={f.nom || ''} onChange={maj('nom')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="m-sexe">Sexe</label>
            <select id="m-sexe" className="champ" value={f.sexe || ''} onChange={maj('sexe')}>
              <option value="">—</option>
              <option value="M">Garçon</option>
              <option value="F">Fille</option>
            </select>
          </div>
          <div>
            <label className="etiquette" htmlFor="m-naissance">Date de naissance</label>
            <input id="m-naissance" type="date" className="champ" value={f.date_naissance || ''}
                   onChange={maj('date_naissance')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="m-lieu">Lieu de naissance</label>
            <input id="m-lieu" className="champ" value={f.lieu_naissance || ''} onChange={maj('lieu_naissance')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="m-nationalite">Nationalité</label>
            <input id="m-nationalite" className="champ" value={f.nationalite || ''} onChange={maj('nationalite')} />
          </div>
          <div className="sm:col-span-2">
            <label className="etiquette" htmlFor="m-adresse">Adresse</label>
            <input id="m-adresse" className="champ" value={f.adresse || ''} onChange={maj('adresse')} />
          </div>
        </div>

        <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <p className="etiquette mb-0">Tuteurs</p>
            <button type="button" className="text-sm text-marine-600 hover:underline"
                    onClick={() => setTuteurs((ts) => [...ts, {
                      prenom: '', nom: '', telephone: '', lien: 'tuteur', principal: ts.length === 0,
                    }])}>
              <Plus className="inline h-3.5 w-3.5" /> Ajouter un tuteur
            </button>
          </div>
          {tuteurs.length === 0 && <p className="text-sm text-slate-500">Aucun tuteur.</p>}
          {tuteurs.map((t, i) => (
            <div key={t.id || `n${i}`} className="grid gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2 sm:grid-cols-12">
              <input className="champ sm:col-span-3" placeholder="Prénom" aria-label="Prénom du tuteur"
                     value={t.prenom} onChange={(e) => majTuteur(i, 'prenom', e.target.value)} />
              <input className="champ sm:col-span-3" placeholder="Nom *" aria-label="Nom du tuteur"
                     value={t.nom} onChange={(e) => majTuteur(i, 'nom', e.target.value)} />
              <input className="champ sm:col-span-3" placeholder="Téléphone *" inputMode="tel" aria-label="Téléphone du tuteur"
                     value={t.telephone} onChange={(e) => majTuteur(i, 'telephone', e.target.value)} />
              <select className="champ sm:col-span-2" aria-label="Lien" value={t.lien}
                      onChange={(e) => majTuteur(i, 'lien', e.target.value)}>
                {[...new Set([t.lien, ...LIENS])].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button type="button" aria-label="Retirer ce tuteur" className="justify-self-end rounded p-2 text-slate-400 hover:text-red-600 sm:col-span-1"
                      onClick={() => setTuteurs((ts) => ts.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-500 sm:col-span-12">
                <input type="radio" name="principal" checked={t.principal}
                       onChange={() => setTuteurs((ts) => ts.map((x, j) => ({ ...x, principal: j === i })))} />
                Tuteur principal (contacté en premier)
              </label>
            </div>
          ))}
        </div>

        <Erreur message={erreur} />
        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer les corrections'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

/**
 * Suppression d un eleve (administrateur) : retrait de l effectif, qui
 * conserve tout, ou suppression definitive d une inscription faite par
 * erreur. S il existe des paiements ou des notes, le serveur refuse, sauf
 * demande expresse : l administrateur retape alors le matricule.
 */
export function SupprimerEleve({ eleve, ouvert, onFermer, onArchive, onSupprime }) {
  const [envoi, setEnvoi] = useState(null);
  const [erreur, setErreur] = useState('');
  // Paiements et notes a effacer avec l eleve, apres un premier refus
  const [historique, setHistorique] = useState(null);
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (ouvert) { setErreur(''); setEnvoi(null); setHistorique(null); setConfirmation(''); }
  }, [ouvert]);

  const agir = async (mode) => {
    setEnvoi(mode);
    setErreur('');
    try {
      const suite = {
        archive: '',
        definitif: '?definitif=1',
        historique: `?definitif=1&historique=1&confirmation=${encodeURIComponent(confirmation)}`,
      }[mode];
      await supprimer(`/eleves/${eleve.id}${suite}`);
      if (mode === 'archive') onArchive(); else onSupprime();
    } catch (err) {
      if (err.donnees?.code === 'ELEVE_AVEC_HISTORIQUE') {
        setHistorique({ paiements: err.donnees.paiements, notes: err.donnees.notes });
      } else {
        setErreur(err.message);
      }
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Supprimer l'élève" taille="sm">
      {eleve && (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{eleve.prenom} {eleve.nom}</strong> <span className="font-mono text-xs text-slate-500">{eleve.matricule}</span>
          </p>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <p className="font-medium">Retirer de l'effectif</p>
            <p className="mt-1 text-sm text-slate-500">
              L'élève a quitté l'école : il disparaît des listes, son compte parent est désactivé,
              mais son dossier, ses notes et ses paiements sont conservés. Réversible.
            </p>
            <button type="button" className="bouton-secondaire mt-2" disabled={Boolean(envoi)} onClick={() => agir('archive')}>
              {envoi === 'archive' ? 'Retrait…' : "Retirer de l'effectif"}
            </button>
          </div>

          <div className="rounded-lg border border-red-200 dark:border-red-900 p-3">
            <p className="font-medium text-red-700 dark:text-red-400">Supprimer définitivement</p>
            <p className="mt-1 text-sm text-slate-500">
              Uniquement pour une inscription faite par erreur (doublon, mauvais élève). L'élève disparaît
              du système comme s'il n'avait jamais existé : dossier, compte parent, historique et notifications.
              S'il a déjà des paiements ou des notes, il faudra confirmer avec son matricule.
            </p>
            <button type="button" className="bouton-danger mt-2" disabled={Boolean(envoi)}
                    onClick={() => window.confirm(`Supprimer définitivement ${eleve.prenom} ${eleve.nom} ? Cette action est irréversible.`) && agir('definitif')}>
              {envoi === 'definitif' ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>

          {historique && (
            <div className="space-y-2 rounded-lg border-2 border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Cet élève a {historique.paiements} paiement(s) et {historique.notes} note(s).
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                S'il s'agit d'un essai ou d'une erreur, vous pouvez tout effacer : l'élève, ses paiements
                et leurs reçus, ses notes, son compte parent, son historique. Les totaux de la caisse seront
                recalculés sans eux.
                Irréversible. Pour confirmer, tapez le matricule <strong className="font-mono">{eleve.matricule}</strong> :
              </p>
              <input className="champ font-mono" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                     placeholder={eleve.matricule} aria-label="Matricule de l'élève" autoComplete="off" />
              <button type="button" className="bouton-danger"
                      disabled={Boolean(envoi) || confirmation.trim().toUpperCase() !== eleve.matricule.toUpperCase()}
                      onClick={() => agir('historique')}>
                {envoi === 'historique' ? 'Suppression…' : 'Tout supprimer définitivement'}
              </button>
            </div>
          )}

          <Erreur message={erreur} />
        </div>
      )}
    </Modale>
  );
}
