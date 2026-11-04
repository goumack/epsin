import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Printer, Wallet } from 'lucide-react';
import { get, post, put, supprimer, fcfa, dateFr } from '../lib/api';
import { Chargement, Erreur, Modale, Puce, Statistique, Vide } from './ui';

const MODES = { especes: 'Espèces', wave: 'Wave', om: 'Orange Money', virement: 'Virement', cheque: 'Chèque' };
const FONCTIONS = ['Maître', 'Professeur', 'Surveillant', 'Secrétaire', 'Gardien', 'Autre'];

const moisCourant = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const moisLong = (m) => {
  const [a, n] = m.split('-').map(Number);
  return new Date(a, n - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Ajout ou modification d un membre du personnel paye. */
function FormulaireSalarie({ salarie, ouvert, onFermer, onEnregistre }) {
  const vide = { prenom: '', nom: '', fonction: 'Maître', telephone: '', salaire_mensuel: '', actif: true };
  const [f, setF] = useState(vide);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setErreur('');
    setF(salarie ? { ...salarie, telephone: salarie.telephone || '', salaire_mensuel: String(Math.round(salarie.salaire_mensuel)) } : vide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, salarie]);

  const maj = (champ) => (e) => setF({ ...f, [champ]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    try {
      const corps = { ...f, salaire_mensuel: Number(f.salaire_mensuel) || 0 };
      if (salarie) await put(`/salaires/salaries/${salarie.id}`, corps);
      else await post('/salaires/salaries', corps);
      onEnregistre();
    } catch (err) { setErreur(err.message); } finally { setEnvoi(false); }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre={salarie ? 'Modifier' : 'Ajouter au personnel payé'} taille="sm">
      <form onSubmit={enregistrer} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette" htmlFor="s-prenom">Prénom *</label>
            <input id="s-prenom" className="champ" required value={f.prenom} onChange={maj('prenom')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="s-nom">Nom *</label>
            <input id="s-nom" className="champ" required value={f.nom} onChange={maj('nom')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette" htmlFor="s-fonction">Fonction</label>
            <select id="s-fonction" className="champ" value={f.fonction} onChange={maj('fonction')}>
              {[...new Set([...FONCTIONS, f.fonction])].map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className="etiquette" htmlFor="s-tel">Téléphone</label>
            <input id="s-tel" className="champ" inputMode="tel" value={f.telephone} onChange={maj('telephone')} />
          </div>
        </div>
        <div>
          <label className="etiquette" htmlFor="s-salaire">Salaire mensuel (FCFA) *</label>
          <input id="s-salaire" className="champ tabular-nums" type="number" min="0" required
                 value={f.salaire_mensuel} onChange={maj('salaire_mensuel')} />
        </div>
        {salarie && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(f.actif)} onChange={maj('actif')} />
            En poste (décochez s'il a quitté l'école : il ne sera plus mis dans la paie)
          </label>
        )}
        <Erreur message={erreur} />
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>{envoi ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modale>
  );
}

/** Paiement d un salaire : mode et date. */
function FormulairePaiementSalaire({ ligne, onFermer, onPaye }) {
  const [mode, setMode] = useState('especes');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { if (ligne) { setErreur(''); setMode('especes'); } }, [ligne]);

  const payer = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post(`/salaires/paie/${ligne.id}/payer`, { mode, date });
      onPaye();
    } catch (err) { setErreur(err.message); } finally { setEnvoi(false); }
  };

  return (
    <Modale ouverte={Boolean(ligne)} onFermer={onFermer} titre="Payer le salaire" taille="sm">
      {ligne && (
        <form onSubmit={payer} className="space-y-3">
          <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
            <strong>{ligne.prenom} {ligne.nom}</strong> ({ligne.fonction}) — {moisLong(ligne.mois)}
            <span className="mt-1 block text-2xl font-semibold tabular-nums">{fcfa(ligne.montant)}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette" htmlFor="p-mode">Mode</label>
              <select id="p-mode" className="champ" value={mode} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="etiquette" htmlFor="p-date">Date</label>
              <input id="p-date" className="champ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-slate-500">Le paiement est enregistré en dépense « Salaires ».</p>
          <Erreur message={erreur} />
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
            <button type="submit" className="bouton-primaire" disabled={envoi}>{envoi ? 'Paiement…' : 'Confirmer le paiement'}</button>
          </div>
        </form>
      )}
    </Modale>
  );
}

/**
 * Salaires des maitres et professeurs : personnel paye, paie du mois
 * (preparer, ajuster, payer) ; chaque paiement devient une depense « Salaires ».
 */
export default function Salaires() {
  const [mois, setMois] = useState(moisCourant());
  const [paie, setPaie] = useState(null);
  const [salaries, setSalaries] = useState(null);
  const [message, setMessage] = useState('');
  const [aModifier, setAModifier] = useState(undefined);   // undefined : ferme ; null : ajout
  const [aPayer, setAPayer] = useState(null);
  const [montants, setMontants] = useState({});

  const charger = useCallback(() => {
    get(`/salaires/paie?mois=${mois}`).then((p) => {
      setPaie(p);
      setMontants(Object.fromEntries(p.lignes.map((l) => [l.id, String(Math.round(l.montant))])));
    }).catch((e) => setMessage(e.message));
    get('/salaires/salaries').then(setSalaries).catch(() => setSalaries([]));
  }, [mois]);
  useEffect(() => { setPaie(null); charger(); }, [charger]);

  const action = async (fn) => {
    setMessage('');
    try { await fn(); charger(); } catch (e) { setMessage(e.message); }
  };
  const ajuster = (l) => {
    const valeur = Math.round(Number(montants[l.id]));
    if (valeur === Math.round(Number(l.montant))) return;
    const note = window.prompt('Motif de l\'ajustement (absence, avance, prime…) :', l.note || '');
    if (note === null) { setMontants({ ...montants, [l.id]: String(Math.round(l.montant)) }); return; }
    action(() => put(`/salaires/paie/${l.id}`, { montant: valeur, note }));
  };
  const annuler = (l) => {
    const motif = window.prompt(`Annuler le paiement de ${l.prenom} ${l.nom} ? La dépense sera retirée. Motif :`);
    if (motif && motif.trim()) action(() => post(`/salaires/paie/${l.id}/annuler`, { motif }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="etiquette" htmlFor="paie-mois">Mois de paie</label>
          <input id="paie-mois" type="month" className="champ w-auto" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} />
        </div>
        {paie?.a_preparer?.length > 0 && (
          <button type="button" className="bouton-primaire"
                  onClick={() => action(() => post('/salaires/paie/preparer', { mois }))}>
            <Wallet className="h-4 w-4" /> Préparer la paie de {moisLong(mois)} ({paie.a_preparer.length})
          </button>
        )}
        <button type="button" className="bouton-secondaire ml-auto" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer l'état de paie
        </button>
      </div>
      {message && <Erreur message={message} />}

      {!paie ? <Chargement /> : (
        <>
          <h2 className="hidden text-lg font-semibold print:block">État de paie — {paie.libelle}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Statistique titre={`Paie de ${paie.libelle}`} valeur={fcfa(paie.total)} icone={Wallet} ton="info" />
            <Statistique titre="Déjà payé" valeur={fcfa(paie.paye)} icone={Wallet} ton="succes" />
            <Statistique titre="Reste à payer" valeur={fcfa(paie.reste)} icone={Wallet} ton={paie.reste > 0 ? 'alerte' : 'succes'} />
          </div>

          <div className="carte overflow-hidden">
            {paie.lignes.length === 0 ? (
              <Vide titre={`Aucune paie pour ${paie.libelle}`}
                    texte={salaries?.some((s) => s.actif)
                      ? 'Cliquez sur « Préparer la paie » pour créer une ligne par membre du personnel.'
                      : 'Ajoutez d\'abord le personnel payé ci-dessous, avec son salaire mensuel.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th className="hidden sm:table-cell">Fonction</th>
                      <th className="text-right">Montant</th>
                      <th>État</th>
                      <th className="text-right print:hidden">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paie.lignes.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <span className="font-medium">{l.prenom} {l.nom}</span>
                          {l.note && <span className="block text-xs text-slate-500">{l.note}</span>}
                        </td>
                        <td className="hidden sm:table-cell">{l.fonction}</td>
                        <td className="text-right">
                          {l.statut === 'a_payer' ? (
                            <input type="number" min="0" aria-label={`Montant — ${l.prenom} ${l.nom}`}
                                   className="champ w-28 py-1 text-right tabular-nums print:border-0"
                                   value={montants[l.id] ?? ''} onChange={(e) => setMontants({ ...montants, [l.id]: e.target.value })}
                                   onBlur={() => ajuster(l)} />
                          ) : <span className="font-semibold tabular-nums">{fcfa(l.montant)}</span>}
                          {Number(l.montant) !== Number(l.salaire_mensuel) && (
                            <span className="block text-xs text-slate-400">habituel : {fcfa(l.salaire_mensuel)}</span>
                          )}
                        </td>
                        <td>
                          {l.statut === 'paye' ? (
                            <>
                              <Puce ton="succes">Payé</Puce>
                              <span className="block text-xs text-slate-500">{dateFr(l.paye_le)} · {MODES[l.mode] || l.mode}</span>
                            </>
                          ) : <Puce ton="alerte">À payer</Puce>}
                        </td>
                        <td className="whitespace-nowrap text-right print:hidden">
                          {l.statut === 'a_payer' ? (
                            <>
                              <button type="button" className="bouton-primaire px-3 py-1.5" onClick={() => setAPayer(l)}>Payer</button>
                              <button type="button" className="ml-2 text-xs text-slate-500 underline"
                                      onClick={() => window.confirm(`Retirer ${l.prenom} ${l.nom} de la paie de ${paie.libelle} ?`)
                                        && action(() => supprimer(`/salaires/paie/${l.id}`))}>
                                Retirer
                              </button>
                            </>
                          ) : (
                            <button type="button" className="text-xs text-red-600 underline" onClick={() => annuler(l)}>
                              Annuler le paiement
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Personnel paye */}
      <div className="carte overflow-hidden print:hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h3 className="font-semibold">Personnel payé</h3>
          <button type="button" className="bouton-secondaire px-3 py-1.5" onClick={() => setAModifier(null)}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
        {!salaries ? <Chargement /> : salaries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">Aucun membre du personnel. Ajoutez les maîtres et professeurs avec leur salaire mensuel.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {salaries.map((s) => (
              <li key={s.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${s.actif ? '' : 'opacity-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.prenom} {s.nom}</span>
                  <span className="text-slate-500"> · {s.fonction}{s.telephone ? ` · ${s.telephone}` : ''}</span>
                </span>
                {!s.actif && <Puce>Parti</Puce>}
                <span className="tabular-nums">{fcfa(s.salaire_mensuel)} / mois</span>
                <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        aria-label={`Modifier ${s.prenom} ${s.nom}`} onClick={() => setAModifier(s)}>
                  <Pencil className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FormulaireSalarie salarie={aModifier || null} ouvert={aModifier !== undefined}
                         onFermer={() => setAModifier(undefined)}
                         onEnregistre={() => { setAModifier(undefined); charger(); }} />
      <FormulairePaiementSalaire ligne={aPayer} onFermer={() => setAPayer(null)}
                                 onPaye={() => { setAPayer(null); charger(); }} />
    </div>
  );
}
