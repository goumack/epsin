import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Plus, TrendingUp, TrendingDown, Wallet, AlertTriangle, Ban, Printer, CheckCircle2,
} from 'lucide-react';
import { get, post, patch, fcfa, dateFr } from '../lib/api';
import {
  Chargement, Erreur, Vide, Modale, Puce, Onglets, Statistique, Recherche, useToast,
} from '../components/ui';
import { STATUTS_PAIEMENT } from '../components/PaiementWave';

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
          { cle: 'wave', libelle: 'Wave à vérifier' },
          { cle: 'impayes', libelle: 'Impayés' },
          { cle: 'depenses', libelle: 'Dépenses' },
          { cle: 'frais', libelle: 'Barème des frais' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'synthese' && <Synthese />}
      {onglet === 'paiements' && <Paiements />}
      {onglet === 'wave' && <VerificationWave />}
      {onglet === 'impayes' && <Impayes />}
      {onglet === 'depenses' && <Depenses />}
      {onglet === 'frais' && <Frais />}
    </div>
  );
}

/**
 * Bandeau affiche juste apres un encaissement ou une confirmation Wave :
 * le recu s ouvre dans un nouvel onglet, pret a imprimer.
 */
export function BandeauRecu({ recu, onFermer }) {
  if (!recu?.id) return null;
  return (
    <div className="animer flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 p-3 text-sm text-emerald-800 dark:text-emerald-200" role="status">
      <CheckCircle2 className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1">
        {recu.texte} — reçu <span className="font-mono">{recu.numero}</span>
      </p>
      <a href={`/recu/${recu.id}`} target="_blank" rel="noopener noreferrer" className="bouton-primaire px-3 py-1.5">
        <Printer className="h-4 w-4" /> Imprimer le reçu
      </a>
      <button type="button" onClick={onFermer} className="text-xs underline">Fermer</button>
    </div>
  );
}

/** Lien discret vers le recu d une ecriture, dans les listes. */
function LienRecu({ id }) {
  if (!id) return null;
  return (
    <a href={`/recu/${id}`} target="_blank" rel="noopener noreferrer"
       className="inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
       aria-label="Imprimer le reçu" title="Imprimer le reçu">
      <Printer className="h-4 w-4" />
    </a>
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
  const [dernierRecu, setDernierRecu] = useState(null);

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

      <BandeauRecu recu={dernierRecu} onFermer={() => setDernierRecu(null)} />

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
                    <td className="text-right whitespace-nowrap">
                      <LienRecu id={p.id} />
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
        onCree={(p) => {
          setFormOuvert(false);
          succes('Paiement enregistré');
          setDernierRecu({ id: p.id, numero: p.numero_recu, texte: `${fcfa(p.montant)} encaissés` });
          charger();
        }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Frais d inscription : ponctuel, obligatoire, et nomme comme tel. */
const estInscription = (fr) => !fr.recurrent && /inscri/i.test(fr.libelle);

/**
 * Encaissement au guichet. `eleveInitial` ouvre le formulaire sur un eleve
 * deja choisi (depuis son dossier, ou juste apres son inscription) ;
 * `preselection="inscription"` y place en plus ses frais d inscription.
 */
export function FormulairePaiement({ ouvert, onFermer, onCree, onErreur, eleveInitial = null, preselection = null }) {
  const [recherche, setRecherche] = useState('');
  const [eleves, setEleves] = useState([]);
  const [eleve, setEleve] = useState(null);
  const [situation, setSituation] = useState(null);
  const [frais, setFrais] = useState([]);
  const [f, setF] = useState({ frais_id: '', montant: '', mode: 'especes', reference: '', mois_couvert: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setRecherche(''); setEleve(eleveInitial); setSituation(null);
    setF({ frais_id: '', montant: '', mode: 'especes', reference: '', mois_couvert: '' });
    (async () => {
      const [bareme, sit] = await Promise.all([
        get('/finances/frais').catch(() => []),
        eleveInitial ? get(`/finances/situation/${eleveInitial.id}`).catch(() => null) : null,
      ]);
      setFrais(bareme);
      setSituation(sit);
      if (preselection === 'inscription') {
        // Les frais d inscription applicables a l eleve (son niveau ou tous)
        const ligne = sit?.lignes?.find(estInscription) || bareme.find(estInscription);
        if (ligne) {
          setF((v) => ({ ...v, frais_id: String(ligne.id), montant: String(Math.round(ligne.reste ?? ligne.montant)) }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const cree = await post('/finances/paiements', {
        eleve_id: eleve.id,
        frais_id: f.frais_id ? Number(f.frais_id) : null,
        montant: Number(f.montant),
        mode: f.mode,
        reference: f.reference || null,
        mois_couvert: f.mois_couvert || null,
      });
      onCree(cree);
    } catch (err) { onErreur(err.message); } finally { setEnvoi(false); }
  };

  const maj = (c) => (e) => setF((v) => ({ ...v, [c]: e.target.value }));

  // Choisir un frais propose ce qui reste a payer dessus (sinon son montant)
  const choisirFrais = (e) => {
    const id = e.target.value;
    const ligne = situation?.lignes?.find((l) => String(l.id) === id);
    const bareme = frais.find((fr) => String(fr.id) === id);
    const propose = ligne ? (ligne.recurrent ? ligne.montant : ligne.reste) : bareme?.montant;
    setF((v) => ({ ...v, frais_id: id, montant: propose ? String(Math.round(propose)) : v.montant }));
  };

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
          <select className="champ" value={f.frais_id} onChange={choisirFrais}>
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

/**
 * Paiements Wave declares par les tuteurs via le lien marchand : la caisse
 * retrouve chaque transaction dans son espace Wave Business, puis valide
 * (les recus sont alors crees) ou rejette.
 */
function VerificationWave() {
  const [statut, setStatut] = useState('a_verifier');
  const [liste, setListe] = useState(null);
  const [aValider, setAValider] = useState(null);
  const [aRejeter, setARejeter] = useState(null);
  const { Toast, succes, erreur } = useToast();

  const charger = useCallback(() => {
    setListe(null);
    get(`/paiements-en-ligne${statut ? `?statut=${statut}` : ''}`)
      .then(setListe).catch(() => setListe([]));
  }, [statut]);

  useEffect(() => { charger(); }, [charger]);

  const total = liste?.reduce((s, p) => s + Number(p.montant), 0) ?? 0;

  // Confirmation en un clic : le montant attendu a bien ete recu sur Wave
  const [enCours, setEnCours] = useState(null);
  const [dernierRecu, setDernierRecu] = useState(null);
  const recuDe = (r) => setDernierRecu({
    id: r.recus?.[0]?.id,
    numero: r.recus?.map((x) => x.numero_recu).join(', '),
    texte: `${r.prenom} ${r.nom} : ${fcfa(r.recus?.reduce((s, x) => s + Number(x.montant), 0))} confirmés`,
  });
  const confirmer = async (p) => {
    setEnCours(p.id);
    try {
      recuDe(await post(`/paiements-en-ligne/${p.id}/valider`, {}));
      charger();
    } catch (err) {
      erreur(err.message);
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <BandeauRecu recu={dernierRecu} onFermer={() => setDernierRecu(null)} />
      <div className="flex flex-wrap items-center gap-3">
        <select className="champ w-auto" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="a_verifier">À vérifier</option>
          <option value="reussi">Validés</option>
          <option value="rejete">Rejetés</option>
          <option value="en_attente">Non déclarés</option>
          <option value="">Tous</option>
        </select>
        {liste && liste.length > 0 && (
          <p className="text-sm text-slate-500">
            {liste.length} paiement(s) · {fcfa(total)}
          </p>
        )}
      </div>

      {statut === 'a_verifier' && (
        <p className="text-sm text-slate-500">
          Vérifiez dans Wave Business que le montant est bien arrivé (même heure, même numéro),
          puis cliquez sur <strong>Confirmer</strong> : le reçu est créé et le parent prévenu.
        </p>
      )}

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? (
          <Vide titre="Aucun paiement" texte={statut === 'a_verifier' ? 'Rien à vérifier pour le moment.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th className="text-right">Montant</th>
                  <th>Transaction Wave</th>
                  <th className="hidden md:table-cell">Déclaré le</th>
                  <th>Statut</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="font-medium">{p.prenom} {p.nom}</span>
                      <span className="block text-xs text-slate-400">
                        <span className="font-mono">{p.matricule}</span>{p.classe && ` · ${p.classe}`}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">
                      {fcfa(p.montant)}
                      <span className="block text-xs text-slate-400">{p.nb_mois} mois</span>
                    </td>
                    <td>
                      <span className="font-mono text-sm">{p.transaction_id || '—'}</span>
                      {p.telephone_payeur && (
                        <span className="block text-xs text-slate-400">{p.telephone_payeur}</span>
                      )}
                    </td>
                    {/* L heure aide a retrouver le paiement dans Wave Business */}
                    <td className="hidden md:table-cell text-slate-500">
                      {dateFr(p.declare_le || p.cree_le)}
                      <span className="block text-xs">
                        {new Date(p.declare_le || p.cree_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td>
                      <Puce ton={STATUTS_PAIEMENT[p.statut]?.ton}>{STATUTS_PAIEMENT[p.statut]?.texte}</Puce>
                      {p.erreur && <span className="block text-xs text-slate-400">{p.erreur}</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {p.statut === 'reussi' && <LienRecu id={p.paiement_id} />}
                      {['a_verifier', 'en_attente'].includes(p.statut) && (
                        <span className="inline-flex flex-col items-end gap-1">
                          <span className="inline-flex gap-2">
                            <button type="button" className="bouton-primaire px-3 py-1.5"
                                    disabled={enCours === p.id} onClick={() => confirmer(p)}>
                              {enCours === p.id ? '…' : 'Confirmer'}
                            </button>
                            <button type="button" className="bouton-secondaire px-3 py-1.5" onClick={() => setARejeter(p)}>
                              Rejeter
                            </button>
                          </span>
                          <button type="button" className="text-xs text-slate-500 underline" onClick={() => setAValider(p)}>
                            Montant différent ?
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ModaleValidationWave
        paiement={aValider}
        onFermer={() => setAValider(null)}
        onFait={(r) => { setAValider(null); recuDe(r); charger(); }}
        onErreur={erreur}
      />
      <ModaleRejetWave
        paiement={aRejeter}
        onFermer={() => setARejeter(null)}
        onFait={() => { setARejeter(null); succes('Paiement rejeté, le tuteur est prévenu'); charger(); }}
        onErreur={erreur}
      />
    </div>
  );
}

function ModaleValidationWave({ paiement, onFermer, onFait, onErreur }) {
  const [f, setF] = useState({ transaction_id: '', montant_recu: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (paiement) {
      setF({ transaction_id: paiement.transaction_id || '', montant_recu: String(Math.round(paiement.montant)) });
    }
  }, [paiement]);

  const valider = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      onFait(await post(`/paiements-en-ligne/${paiement.id}/valider`, {
        transaction_id: f.transaction_id.trim(),
        montant_recu: Number(f.montant_recu),
      }));
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={Boolean(paiement)} onFermer={onFermer} titre="Valider le paiement Wave" taille="sm">
      {paiement && (
        <form onSubmit={valider} className="space-y-3">
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            <strong>{paiement.prenom} {paiement.nom}</strong> — {paiement.frais}, {paiement.nb_mois} mois,
            {' '}{fcfa(paiement.montant)} attendus.
          </p>
          <div>
            <label className="etiquette" htmlFor="v-transaction">Référence Wave (facultatif)</label>
            <input id="v-transaction" className="champ font-mono" value={f.transaction_id}
                   onChange={(e) => setF({ ...f, transaction_id: e.target.value })} />
          </div>
          <div>
            <label className="etiquette" htmlFor="v-montant">Montant reçu sur Wave (FCFA) *</label>
            <input id="v-montant" className="champ" type="number" min="1" required value={f.montant_recu}
                   onChange={(e) => setF({ ...f, montant_recu: e.target.value })} />
            {Number(f.montant_recu) !== Math.round(paiement.montant) && (
              <p className="mt-1 text-xs text-amber-600">
                Différent du montant attendu : c'est le montant reçu qui sera imputé, mois par mois.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
            <button type="submit" className="bouton-primaire" disabled={envoi}>
              {envoi ? 'Validation…' : 'Valider et créer les reçus'}
            </button>
          </div>
        </form>
      )}
    </Modale>
  );
}

function ModaleRejetWave({ paiement, onFermer, onFait, onErreur }) {
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (paiement) setMotif(''); }, [paiement]);

  const rejeter = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post(`/paiements-en-ligne/${paiement.id}/rejeter`, { motif: motif.trim() });
      onFait();
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={Boolean(paiement)} onFermer={onFermer} titre="Rejeter la déclaration" taille="sm">
      {paiement && (
        <form onSubmit={rejeter} className="space-y-3">
          <p className="text-sm text-slate-500">
            Le tuteur de <strong>{paiement.prenom} {paiement.nom}</strong> sera prévenu avec ce motif.
          </p>
          <div>
            <label className="etiquette" htmlFor="r-motif">Motif *</label>
            <input id="r-motif" className="champ" required value={motif}
                   placeholder="Transaction introuvable dans Wave Business"
                   onChange={(e) => setMotif(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
            <button type="submit" className="bouton-danger" disabled={envoi || !motif.trim()}>
              {envoi ? 'Rejet…' : 'Rejeter'}
            </button>
          </div>
        </form>
      )}
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
