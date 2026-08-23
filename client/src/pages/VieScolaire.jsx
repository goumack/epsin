import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, UserX, Clock, Stethoscope } from 'lucide-react';
import { get, post, patch, dateFr } from '../lib/api';
import {
  Chargement, Vide, Modale, Puce, Onglets, useToast,
} from '../components/ui';

export default function VieScolaire() {
  const [onglet, setOnglet] = useState('appel');
  return (
    <div className="animer space-y-4">
      <Onglets
        onglets={[
          { cle: 'appel', libelle: "Faire l'appel" },
          { cle: 'absences', libelle: 'Absences' },
          { cle: 'sanctions', libelle: 'Sanctions' },
          { cle: 'infirmerie', libelle: 'Infirmerie' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'appel' && <Appel />}
      {onglet === 'absences' && <Absences />}
      {onglet === 'sanctions' && <Sanctions />}
      {onglet === 'infirmerie' && <Infirmerie />}
    </div>
  );
}

/** Appel : on coche les absents, le reste est presume present. */
function Appel() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eleves, setEleves] = useState(null);
  const [absents, setAbsents] = useState({});
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    get('/scolarite/classes').then((c) => {
      setClasses(c);
      if (c[0]) setClasseId(String(c[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!classeId) return;
    setEleves(null);
    setAbsents({});
    get(`/scolarite/classes/${classeId}/eleves`).then(setEleves).catch(() => setEleves([]));
  }, [classeId]);

  const basculer = (id, type) => {
    setAbsents((a) => {
      const copie = { ...a };
      if (copie[id] === type) delete copie[id];
      else copie[id] = type;
      return copie;
    });
  };

  const enregistrer = async () => {
    const liste = Object.entries(absents).map(([eleve_id, type]) => ({
      eleve_id: Number(eleve_id), type,
    }));
    if (liste.length === 0) return toastErreur('Aucun absent sélectionné');
    setEnvoi(true);
    try {
      await post('/vie-scolaire/appel', { date_abs: date, absents: liste });
      succes(`${liste.length} absence(s) enregistrée(s)`);
      setAbsents({});
    } catch (e) { toastErreur(e.message); } finally { setEnvoi(false); }
  };

  const nbAbsents = Object.keys(absents).length;

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select className="champ sm:w-52" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
        <input type="date" className="champ sm:w-44" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={enregistrer} className="bouton-primaire sm:ml-auto" disabled={envoi || nbAbsents === 0}>
          <Check className="h-4 w-4" />
          {envoi ? 'Enregistrement…' : `Valider l'appel (${nbAbsents})`}
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!eleves ? <Chargement /> : eleves.length === 0 ? (
          <Vide titre="Aucun élève" texte="Cette classe n'a pas encore d'élèves inscrits." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {eleves.map((e) => {
              const etat = absents[e.id];
              return (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.prenom} {e.nom}</p>
                    <p className="font-mono text-xs text-slate-400">{e.matricule}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => basculer(e.id, 'absence')}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        etat === 'absence'
                          ? 'bg-red-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <UserX className="mr-1 inline h-3.5 w-3.5" />
                      Absent
                    </button>
                    <button
                      onClick={() => basculer(e.id, 'retard')}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        etat === 'retard'
                          ? 'bg-amber-500 text-white'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Clock className="mr-1 inline h-3.5 w-3.5" />
                      Retard
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Absences() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [filtre, setFiltre] = useState('');

  const charger = useCallback(() => {
    const q = filtre === 'non_justifiees' ? '?justifiee=false' : '';
    get(`/vie-scolaire/absences${q}`).then(setListe).catch(() => setListe([]));
  }, [filtre]);

  useEffect(() => { charger(); }, [charger]);

  const justifier = async (id) => {
    try {
      await patch(`/vie-scolaire/absences/${id}/justifier`, { motif: 'Justifiée par le tuteur' });
      succes('Absence justifiée');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <select className="champ sm:w-56" value={filtre} onChange={(e) => setFiltre(e.target.value)}>
        <option value="">Toutes les absences</option>
        <option value="non_justifiees">Non justifiées uniquement</option>
      </select>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucune absence" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th className="hidden sm:table-cell">Classe</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>État</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.prenom} {a.nom}</td>
                    <td className="hidden sm:table-cell text-slate-500">{a.classe || '—'}</td>
                    <td className="text-slate-500">{dateFr(a.date_abs)}</td>
                    <td>
                      <Puce ton={a.type === 'retard' ? 'alerte' : 'danger'}>
                        {a.type === 'retard' ? 'Retard' : 'Absence'}
                      </Puce>
                    </td>
                    <td>
                      {a.justifiee
                        ? <Puce ton="succes">Justifiée</Puce>
                        : <Puce ton="neutre">Non justifiée</Puce>}
                    </td>
                    <td className="text-right">
                      {!a.justifiee && (
                        <button onClick={() => justifier(a.id)} className="bouton-secondaire px-2.5 py-1.5 text-xs">
                          Justifier
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
    </div>
  );
}

function Sanctions() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [eleves, setEleves] = useState([]);
  const [f, setF] = useState({ eleve_id: '', type: 'avertissement', motif: '' });

  const charger = useCallback(() => {
    get('/vie-scolaire/sanctions').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!recherche.trim()) { setEleves([]); return; }
    const t = setTimeout(() => {
      get(`/eleves?recherche=${encodeURIComponent(recherche)}&taille=6`)
        .then((d) => setEleves(d.donnees)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [recherche]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/vie-scolaire/sanctions', { ...f, eleve_id: Number(f.eleve_id) });
      setOuvert(false);
      setF({ eleve_id: '', type: 'avertissement', motif: '' });
      setRecherche('');
      succes('Sanction enregistrée');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Nouvelle sanction
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucune sanction" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th className="hidden sm:table-cell">Classe</th>
                  <th>Type</th>
                  <th>Motif</th>
                  <th className="hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.prenom} {s.nom}</td>
                    <td className="hidden sm:table-cell text-slate-500">{s.classe || '—'}</td>
                    <td><Puce ton={s.type === 'exclusion' ? 'danger' : 'alerte'}>{s.type}</Puce></td>
                    <td className="max-w-xs truncate text-slate-500">{s.motif}</td>
                    <td className="hidden md:table-cell text-slate-500">{dateFr(s.date_debut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouvelle sanction" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Élève *</label>
            <input
              className="champ"
              value={recherche}
              onChange={(e) => { setRecherche(e.target.value); setF({ ...f, eleve_id: '' }); }}
              placeholder="Rechercher un élève…"
            />
            {eleves.length > 0 && !f.eleve_id && (
              <ul className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                {eleves.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => { setF({ ...f, eleve_id: String(e.id) }); setRecherche(`${e.prenom} ${e.nom}`); setEleves([]); }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      {e.prenom} {e.nom}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="etiquette">Type</label>
            <select className="champ" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="avertissement">Avertissement</option>
              <option value="blame">Blâme</option>
              <option value="exclusion">Exclusion temporaire</option>
            </select>
          </div>
          <div>
            <label className="etiquette">Motif *</label>
            <textarea className="champ" rows="3" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire" disabled={!f.eleve_id}>Enregistrer</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

function Infirmerie() {
  const [liste, setListe] = useState(null);
  useEffect(() => {
    get('/vie-scolaire/infirmerie').then(setListe).catch(() => setListe([]));
  }, []);

  return (
    <div className="carte overflow-hidden">
      {!liste ? <Chargement /> : liste.length === 0 ? (
        <Vide titre="Aucune visite" texte="Les passages à l'infirmerie apparaîtront ici." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tableau">
            <thead>
              <tr>
                <th>Élève</th>
                <th>Motif</th>
                <th className="hidden sm:table-cell">Traitement</th>
                <th className="hidden md:table-cell">Date</th>
                <th className="text-center">Parent prévenu</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((v) => (
                <tr key={v.id}>
                  <td className="font-medium">{v.prenom} {v.nom}</td>
                  <td>{v.motif}</td>
                  <td className="hidden sm:table-cell text-slate-500">{v.traitement || '—'}</td>
                  <td className="hidden md:table-cell text-slate-500">{dateFr(v.date_visite)}</td>
                  <td className="text-center">
                    {v.parent_prevenu ? <Puce ton="succes">Oui</Puce> : <Puce>Non</Puce>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
