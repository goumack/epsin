import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Plus, TrendingUp, TrendingDown, Wallet, AlertTriangle, Ban } from 'lucide-react';
import { get, post, patch, fcfa, dateFr } from '../lib/api';
import {
  Chargement, Erreur, Vide, Modale, Puce, Onglets, Statistique, Recherche, useToast,
} from '../components/ui';

const MODES = {
  especes: 'Espèces', wave: 'Wave', om: 'Orange Money',
  cheque: 'Chèque', virement: 'Virement',
};

export default function Finances() {
  const [onglet, setOnglet] = useState('synthese');

  return (
    <div className="animer space-y-4">
      <Onglets
        onglets={[
          { cle: 'synthese', libelle: 'Synthèse' },
          { cle: 'paiements', libelle: 'Paiements' },
          { cle: 'impayes', libelle: 'Impayés' },
          { cle: 'depenses', libelle: 'Dépenses' },
          { cle: 'frais', libelle: 'Barème des frais' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'synthese' && <Synthese />}
      {onglet === 'paiements' && <Paiements />}
      {onglet === 'impayes' && <Impayes />}
      {onglet === 'depenses' && <Depenses />}
      {onglet === 'frais' && <Frais />}
    </div>
  );
}

function Synthese() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    get('/finances/synthese').then(setD).catch((e) => setErreur(e.message));
  }, []);

  if (erreur) return <Erreur message={erreur} />;
  if (!d) return <Chargement />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Statistique titre="Recettes" valeur={fcfa(d.recettes)} icone={TrendingUp} ton="succes" />
        <Statistique titre="Dépenses" valeur={fcfa(d.depenses)} icone={TrendingDown} ton="danger" />
        <Statistique
          titre="Solde"
          valeur={fcfa(d.solde)}
          icone={Wallet}
          ton={d.solde >= 0 ? 'succes' : 'danger'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="carte p-5 lg:col-span-2">
          <h3 className="mb-4 font-semibold">Encaissements par mois</h3>
          {d.par_mois.length === 0 ? <Vide titre="Aucun encaissement" /> : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.par_mois} margin={{ top: 5, right: 5, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="mois" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                  formatter={(v) => [fcfa(v), 'Encaissé']}
                />
                <Bar dataKey="montant" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="carte p-5">
          <h3 className="mb-4 font-semibold">Par mode de paiement</h3>
          <ul className="space-y-3">
            {d.par_mode.map((m) => {
              const part = d.recettes ? (Number(m.montant) / Number(d.recettes)) * 100 : 0;
              return (
                <li key={m.mode}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{MODES[m.mode] || m.mode}</span>
                    <span className="tabular-nums text-slate-500">{fcfa(m.montant)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-marine-500" style={{ width: `${part}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Paiements() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [formOuvert, setFormOuvert] = useState(false);

  const charger = useCallback(async () => {
    try { setListe(await get('/finances/paiements?taille=50')); } catch { setListe({ donnees: [] }); }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const annuler = async (id) => {
    if (!window.confirm('Annuler ce paiement ? L\'écriture sera conservée mais marquée annulée.')) return;
    try {
      await patch(`/finances/paiements/${id}/annuler`);
      succes('Paiement annulé');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {liste ? `${liste.total} paiement(s) · ${fcfa(liste.total_montant)}` : '…'}
        </p>
        <button onClick={() => setFormOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Encaisser
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.donnees.length === 0 ? (
          <Vide titre="Aucun paiement" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Reçu</th>
                  <th>Élève</th>
                  <th className="hidden md:table-cell">Frais</th>
                  <th className="text-right">Montant</th>
                  <th className="hidden sm:table-cell">Mode</th>
                  <th className="hidden lg:table-cell">Date</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.donnees.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs text-slate-500">{p.numero_recu}</td>
                    <td>
                      <span className="font-medium">{p.prenom} {p.nom}</span>
                      <span className="block font-mono text-xs text-slate-400">{p.matricule}</span>
                    </td>
                    <td className="hidden md:table-cell text-slate-500">{p.frais || '—'}</td>
                    <td className="text-right font-semibold tabular-nums">{fcfa(p.montant)}</td>
                    <td className="hidden sm:table-cell"><Puce>{MODES[p.mode] || p.mode}</Puce></td>
                    <td className="hidden lg:table-cell text-slate-500">{dateFr(p.date_paiement)}</td>
                    <td className="text-right">
                      <button
                        onClick={() => annuler(p.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
                        aria-label="Annuler"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormulairePaiement
        ouvert={formOuvert}
        onFermer={() => setFormOuvert(false)}
        onCree={() => { setFormOuvert(false); succes('Paiement enregistré'); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

function FormulairePaiement({ ouvert, onFermer, onCree, onErreur }) {
  const [recherche, setRecherche] = useState('');
  const [eleves, setEleves] = useState([]);
  const [eleve, setEleve] = useState(null);
  const [situation, setSituation] = useState(null);
  const [frais, setFrais] = useState([]);
  const [f, setF] = useState({ frais_id: '', montant: '', mode: 'especes', reference: '', mois_couvert: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (ouvert) {
      setRecherche(''); setEleve(null); setSituation(null);
      setF({ frais_id: '', montant: '', mode: 'especes', reference: '', mois_couvert: '' });
      get('/finances/frais').then(setFrais).catch(() => {});
    }
  }, [ouvert]);

  useEffect(() => {
    if (!recherche.trim() || eleve) { setEleves([]); return; }
    const t = setTimeout(() => {
      get(`/eleves?recherche=${encodeURIComponent(recherche)}&taille=6`)
        .then((d) => setEleves(d.donnees)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [recherche, eleve]);

  const choisir = async (e) => {
    setEleve(e);
    setEleves([]);
    try { setSituation(await get(`/finances/situation/${e.id}`)); } catch { /* optionnel */ }
  };

  const soumettre = async (ev) => {
    ev.preventDefault();
    if (!eleve) return onErreur('Sélectionnez un élève');
    setEnvoi(true);
    try {
      await post('/finances/paiements', {
        eleve_id: eleve.id,
        frais_id: f.frais_id ? Number(f.frais_id) : null,
        montant: Number(f.montant),
        mode: f.mode,
        reference: f.reference || null,
        mois_couvert: f.mois_couvert || null,
      });
      onCree();
    } catch (err) { onErreur(err.message); } finally { setEnvoi(false); }
  };

  const maj = (c) => (e) => setF((v) => ({ ...v, [c]: e.target.value }));

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Encaisser un paiement" taille="sm">
      <form onSubmit={soumettre} className="space-y-4">
        <div>
          <label className="etiquette">Élève *</label>
          {eleve ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2">
              <span className="text-sm">
                <strong>{eleve.prenom} {eleve.nom}</strong>
                <span className="ml-2 font-mono text-xs text-slate-400">{eleve.matricule}</span>
              </span>
              <button
                type="button"
                onClick={() => { setEleve(null); setSituation(null); setRecherche(''); }}
                className="text-xs text-marine-600 hover:underline"
              >
                Changer
              </button>
            </div>
          ) : (
            <>
              <Recherche valeur={recherche} onChange={setRecherche} placeholder="Nom ou matricule…" />
              {eleves.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  {eleves.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => choisir(e)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {e.prenom} {e.nom}
                        <span className="ml-2 font-mono text-xs text-slate-400">{e.matricule}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {situation && situation.reste > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Reste à payer : <strong>{fcfa(situation.reste)}</strong>
          </div>
        )}

        <div>
          <label className="etiquette">Type de frais</label>
          <select className="champ" value={f.frais_id} onChange={maj('frais_id')}>
            <option value="">Non précisé</option>
            {frais.map((fr) => (
              <option key={fr.id} value={fr.id}>{fr.libelle} — {fcfa(fr.montant)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette">Montant *</label>
            <input type="number" min="1" className="champ" value={f.montant} onChange={maj('montant')} required />
          </div>
          <div>
            <label className="etiquette">Mode</label>
            <select className="champ" value={f.mode} onChange={maj('mode')}>
              {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="etiquette">Mois couvert</label>
            <input type="month" className="champ" value={f.mois_couvert} onChange={maj('mois_couvert')} />
          </div>
          <div>
            <label className="etiquette">Référence</label>
            <input className="champ" value={f.reference} onChange={maj('reference')} placeholder="N° transaction" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Encaisser'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

function Impayes() {
  const [liste, setListe] = useState(null);

  useEffect(() => {
    get('/finances/impayes').then(setListe).catch(() => setListe([]));
  }, []);

  const total = liste?.reduce((s, e) => s + Number(e.reste), 0) ?? 0;

  return (
    <div className="space-y-4">
      {liste && liste.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Statistique titre="Élèves concernés" valeur={liste.length} icone={AlertTriangle} ton="alerte" />
          <Statistique titre="Total impayé" valeur={fcfa(total)} icone={TrendingDown} ton="danger" />
        </div>
      )}

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? (
          <Vide titre="Aucun impayé" texte="Tous les élèves sont à jour." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th className="hidden sm:table-cell">Classe</th>
                  <th className="text-right">Dû</th>
                  <th className="text-right">Payé</th>
                  <th className="text-right">Reste</th>
                  <th className="hidden md:table-cell">Contact</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="font-medium">{e.prenom} {e.nom}</span>
                      <span className="block font-mono text-xs text-slate-400">{e.matricule}</span>
                    </td>
                    <td className="hidden sm:table-cell">{e.classe}</td>
                    <td className="text-right tabular-nums text-slate-500">{fcfa(e.total_du)}</td>
                    <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fcfa(e.total_paye)}</td>
                    <td className="text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{fcfa(e.reste)}</td>
                    <td className="hidden md:table-cell text-slate-500">{e.contact || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Depenses() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ categorie: 'Fournitures', libelle: '', montant: '', date_depense: '' });

  const charger = useCallback(() => {
    get('/finances/depenses').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/finances/depenses', { ...f, montant: Number(f.montant) });
      setOuvert(false);
      setF({ categorie: 'Fournitures', libelle: '', montant: '', date_depense: '' });
      succes('Dépense enregistrée');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Nouvelle dépense
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucune dépense" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th className="hidden sm:table-cell">Catégorie</th>
                  <th className="text-right">Montant</th>
                  <th className="hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.libelle}</td>
                    <td className="hidden sm:table-cell"><Puce>{d.categorie}</Puce></td>
                    <td className="text-right font-semibold tabular-nums">{fcfa(d.montant)}</td>
                    <td className="hidden md:table-cell text-slate-500">{dateFr(d.date_depense)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouvelle dépense" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Catégorie</label>
            <select className="champ" value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
              {['Salaires', 'Fournitures', 'Entretien', 'Transport', 'Électricité', 'Eau', 'Autre'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiquette">Libellé *</label>
            <input className="champ" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Montant *</label>
              <input type="number" min="1" className="champ" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} required />
            </div>
            <div>
              <label className="etiquette">Date</label>
              <input type="date" className="champ" value={f.date_depense} onChange={(e) => setF({ ...f, date_depense: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Enregistrer</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

function Frais() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [niveaux, setNiveaux] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ libelle: '', montant: '', niveau_id: '', recurrent: false, obligatoire: true });

  const charger = useCallback(() => {
    get('/finances/frais').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => {
    charger();
    get('/scolarite/niveaux').then(setNiveaux).catch(() => {});
  }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/finances/frais', {
        ...f,
        montant: Number(f.montant),
        niveau_id: f.niveau_id ? Number(f.niveau_id) : null,
      });
      setOuvert(false);
      setF({ libelle: '', montant: '', niveau_id: '', recurrent: false, obligatoire: true });
      succes('Frais ajouté');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Nouveau frais
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucun frais défini" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th className="hidden sm:table-cell">Niveau</th>
                  <th className="text-right">Montant</th>
                  <th className="text-center">Périodicité</th>
                  <th className="hidden md:table-cell text-center">Obligatoire</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((fr) => (
                  <tr key={fr.id}>
                    <td className="font-medium">{fr.libelle}</td>
                    <td className="hidden sm:table-cell text-slate-500">{fr.niveau || 'Tous'}</td>
                    <td className="text-right font-semibold tabular-nums">{fcfa(fr.montant)}</td>
                    <td className="text-center">
                      <Puce ton={fr.recurrent ? 'info' : 'neutre'}>
                        {fr.recurrent ? 'Mensuel' : 'Unique'}
                      </Puce>
                    </td>
                    <td className="hidden md:table-cell text-center">
                      {fr.obligatoire ? <Puce ton="succes">Oui</Puce> : <Puce>Non</Puce>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouveau frais" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Libellé *</label>
            <input className="champ" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} placeholder="Mensualité" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Montant *</label>
              <input type="number" min="0" className="champ" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} required />
            </div>
            <div>
              <label className="etiquette">Niveau</label>
              <select className="champ" value={f.niveau_id} onChange={(e) => setF({ ...f, niveau_id: e.target.value })}>
                <option value="">Tous les niveaux</option>
                {niveaux.map((n) => <option key={n.id} value={n.id}>{n.libelle}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.recurrent} onChange={(e) => setF({ ...f, recurrent: e.target.checked })} />
              Frais mensuel (dû chaque mois)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.obligatoire} onChange={(e) => setF({ ...f, obligatoire: e.target.checked })} />
              Obligatoire (compté dans les impayés)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Enregistrer</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}
