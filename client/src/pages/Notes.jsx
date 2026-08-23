import { useEffect, useState, useCallback } from 'react';
import { Plus, Save, Printer, Trophy, FileText } from 'lucide-react';
import { get, post, couleurNote } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Chargement, Erreur, Vide, Modale, Puce, Onglets, useToast,
} from '../components/ui';
import ConseilClasse from './ConseilClasse';

export default function Notes() {
  const { aRole } = useAuth();
  const [onglet, setOnglet] = useState('evaluations');

  // Le conseil de classe arrete les decisions du bulletin : reserve a
  // l encadrement, comme cote serveur.
  const tientConseil = aRole('admin', 'censeur', 'directeur', 'proviseur');

  const onglets = [
    { cle: 'evaluations', libelle: 'Évaluations' },
    { cle: 'bulletins', libelle: 'Bulletins' },
    { cle: 'classement', libelle: 'Classement' },
    ...(tientConseil ? [{ cle: 'conseil', libelle: 'Conseil de classe' }] : []),
  ];

  return (
    <div className="animer space-y-4">
      <Onglets onglets={onglets} actif={onglet} onChange={setOnglet} />
      {onglet === 'evaluations' && <Evaluations peutSaisir={aRole('admin', 'censeur', 'enseignant')} />}
      {onglet === 'bulletins' && <Bulletins />}
      {onglet === 'classement' && <Classement />}
      {onglet === 'conseil' && tientConseil && <ConseilClasse />}
    </div>
  );
}

/** Selecteurs classe + periode, reutilises par les trois onglets. */
function useContexteScolaire() {
  const [classes, setClasses] = useState([]);
  const [periodes, setPeriodes] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [periodeId, setPeriodeId] = useState('');

  useEffect(() => {
    get('/scolarite/classes').then((c) => {
      setClasses(c);
      if (c[0]) setClasseId(String(c[0].id));
    }).catch(() => {});
    get('/scolarite/periodes').then((p) => {
      setPeriodes(p);
      if (p[0]) setPeriodeId(String(p[0].id));
    }).catch(() => {});
  }, []);

  return { classes, periodes, classeId, setClasseId, periodeId, setPeriodeId };
}

function Selecteurs({ ctx, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <select className="champ sm:w-52" value={ctx.classeId} onChange={(e) => ctx.setClasseId(e.target.value)}>
        {ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </select>
      <select className="champ sm:w-52" value={ctx.periodeId} onChange={(e) => ctx.setPeriodeId(e.target.value)}>
        {ctx.periodes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
      </select>
      {children}
    </div>
  );
}

// ---------- Onglet Évaluations ----------
function Evaluations({ peutSaisir }) {
  const ctx = useContexteScolaire();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [evaluations, setEvaluations] = useState(null);
  const [matieres, setMatieres] = useState([]);
  const [formOuvert, setFormOuvert] = useState(false);
  const [saisie, setSaisie] = useState(null);

  const charger = useCallback(async () => {
    if (!ctx.classeId || !ctx.periodeId) return;
    try {
      setEvaluations(await get(`/notes/evaluations?classe_id=${ctx.classeId}&periode_id=${ctx.periodeId}`));
    } catch { setEvaluations([]); }
  }, [ctx.classeId, ctx.periodeId]);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { get('/scolarite/matieres').then(setMatieres).catch(() => {}); }, []);

  return (
    <div className="space-y-4">
      <Toast />
      <Selecteurs ctx={ctx}>
        {peutSaisir && (
          <button onClick={() => setFormOuvert(true)} className="bouton-primaire sm:ml-auto">
            <Plus className="h-4 w-4" /> Nouvelle évaluation
          </button>
        )}
      </Selecteurs>

      <div className="carte overflow-hidden">
        {!evaluations ? <Chargement /> : evaluations.length === 0 ? (
          <Vide titre="Aucune évaluation" texte="Créez une évaluation pour saisir des notes." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th className="hidden sm:table-cell">Matière</th>
                  <th className="hidden md:table-cell">Type</th>
                  <th>Coef.</th>
                  <th>Saisies</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="font-medium">{e.libelle}</span>
                      <span className="block text-xs text-slate-400 sm:hidden">{e.matiere}</span>
                    </td>
                    <td className="hidden sm:table-cell">{e.matiere}</td>
                    <td className="hidden md:table-cell capitalize text-slate-500">{e.type}</td>
                    <td className="tabular-nums">{e.coefficient}</td>
                    <td>
                      <Puce ton={e.nb_notes > 0 ? 'succes' : 'neutre'}>{e.nb_notes} note(s)</Puce>
                    </td>
                    <td className="text-right">
                      {peutSaisir && (
                        <button onClick={() => setSaisie(e.id)} className="bouton-secondaire px-2.5 py-1.5 text-xs">
                          Saisir
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

      <FormulaireEvaluation
        ouvert={formOuvert}
        matieres={matieres}
        classeId={ctx.classeId}
        periodeId={ctx.periodeId}
        onFermer={() => setFormOuvert(false)}
        onCree={() => { setFormOuvert(false); succes('Évaluation créée'); charger(); }}
        onErreur={toastErreur}
      />

      <FeuilleSaisie
        evaluationId={saisie}
        onFermer={() => setSaisie(null)}
        onEnregistre={() => { setSaisie(null); succes('Notes enregistrées'); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

function FormulaireEvaluation({ ouvert, matieres, classeId, periodeId, onFermer, onCree, onErreur }) {
  const [f, setF] = useState({ matiere_id: '', type: 'devoir', libelle: '', coefficient: 1, bareme: 20, date_eval: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (ouvert) setF({ matiere_id: matieres[0]?.id || '', type: 'devoir', libelle: '', coefficient: 1, bareme: 20, date_eval: '' });
  }, [ouvert, matieres]);

  const maj = (c) => (e) => setF((v) => ({ ...v, [c]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post('/notes/evaluations', {
        classe_id: Number(classeId),
        periode_id: Number(periodeId),
        matiere_id: Number(f.matiere_id),
        type: f.type,
        libelle: f.libelle,
        coefficient: Number(f.coefficient),
        bareme: Number(f.bareme),
        date_eval: f.date_eval || null,
      });
      onCree();
    } catch (err) { onErreur(err.message); } finally { setEnvoi(false); }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Nouvelle évaluation" taille="sm">
      <form onSubmit={soumettre} className="space-y-3">
        <div>
          <label className="etiquette">Matière *</label>
          <select className="champ" value={f.matiere_id} onChange={maj('matiere_id')} required>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}
          </select>
        </div>
        <div>
          <label className="etiquette">Libellé *</label>
          <input className="champ" value={f.libelle} onChange={maj('libelle')} placeholder="Devoir n°1" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette">Type</label>
            <select className="champ" value={f.type} onChange={maj('type')}>
              <option value="devoir">Devoir</option>
              <option value="composition">Composition</option>
              <option value="interrogation">Interrogation</option>
            </select>
          </div>
          <div>
            <label className="etiquette">Date</label>
            <input type="date" className="champ" value={f.date_eval} onChange={maj('date_eval')} />
          </div>
          <div>
            <label className="etiquette">Coefficient</label>
            <input type="number" step="0.5" min="0.5" className="champ" value={f.coefficient} onChange={maj('coefficient')} />
          </div>
          <div>
            <label className="etiquette">Barème</label>
            <input type="number" min="1" className="champ" value={f.bareme} onChange={maj('bareme')} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

/** Saisie des notes en tableau, avec navigation au clavier. */
function FeuilleSaisie({ evaluationId, onFermer, onEnregistre, onErreur }) {
  const [feuille, setFeuille] = useState(null);
  const [valeurs, setValeurs] = useState({});
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!evaluationId) { setFeuille(null); setValeurs({}); return; }
    get(`/notes/evaluations/${evaluationId}/feuille`).then((d) => {
      setFeuille(d);
      const init = {};
      d.eleves.forEach((e) => { init[e.eleve_id] = e.valeur ?? ''; });
      setValeurs(init);
    }).catch((e) => onErreur(e.message));
  }, [evaluationId, onErreur]);

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const notes = Object.entries(valeurs).map(([eleve_id, v]) => ({
        eleve_id: Number(eleve_id),
        valeur: v === '' ? null : Number(v),
      }));
      await post(`/notes/evaluations/${evaluationId}/notes`, { notes });
      onEnregistre();
    } catch (err) { onErreur(err.message); } finally { setEnvoi(false); }
  };

  const bareme = feuille?.evaluation?.bareme ?? 20;

  return (
    <Modale
      ouverte={!!evaluationId}
      onFermer={onFermer}
      titre={feuille ? `${feuille.evaluation.libelle} — ${feuille.evaluation.matiere}` : 'Saisie des notes'}
      taille="md"
    >
      {!feuille ? <Chargement /> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {feuille.evaluation.classe} · barème sur {bareme} · laissez vide si l'élève était absent
          </p>

          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="tableau">
              <thead className="sticky top-0">
                <tr>
                  <th>Élève</th>
                  <th className="w-28 text-right">Note</th>
                </tr>
              </thead>
              <tbody>
                {feuille.eleves.map((e, i) => (
                  <tr key={e.eleve_id}>
                    <td>
                      <span className="font-medium">{e.prenom} {e.nom}</span>
                      <span className="block font-mono text-xs text-slate-400">{e.matricule}</span>
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max={bareme}
                        className="champ w-24 text-right tabular-nums"
                        value={valeurs[e.eleve_id] ?? ''}
                        onChange={(ev) => setValeurs((v) => ({ ...v, [e.eleve_id]: ev.target.value }))}
                        onKeyDown={(ev) => {
                          // Entree passe a la ligne suivante
                          if (ev.key === 'Enter') {
                            ev.preventDefault();
                            const inputs = ev.target.closest('tbody').querySelectorAll('input');
                            inputs[i + 1]?.focus();
                          }
                        }}
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onFermer} className="bouton-secondaire">Annuler</button>
            <button onClick={enregistrer} className="bouton-primaire" disabled={envoi}>
              <Save className="h-4 w-4" />
              {envoi ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </Modale>
  );
}

// ---------- Onglet Bulletins ----------
function Bulletins() {
  const ctx = useContexteScolaire();
  const [eleves, setEleves] = useState([]);
  const [eleveId, setEleveId] = useState('');
  const [bulletin, setBulletin] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!ctx.classeId) return;
    get(`/scolarite/classes/${ctx.classeId}/eleves`).then((e) => {
      setEleves(e);
      setEleveId(e[0] ? String(e[0].id) : '');
    }).catch(() => {});
  }, [ctx.classeId]);

  useEffect(() => {
    if (!eleveId || !ctx.periodeId) { setBulletin(null); return; }
    setErreur('');
    get(`/notes/bulletin/${eleveId}/${ctx.periodeId}`)
      .then(setBulletin)
      .catch((e) => { setErreur(e.message); setBulletin(null); });
  }, [eleveId, ctx.periodeId]);

  return (
    <div className="space-y-4">
      <Selecteurs ctx={ctx}>
        <select className="champ sm:w-60" value={eleveId} onChange={(e) => setEleveId(e.target.value)}>
          {eleves.map((e) => <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>)}
        </select>
        {bulletin && (
          <button onClick={() => window.print()} className="bouton-secondaire sm:ml-auto print:hidden">
            <Printer className="h-4 w-4" /> Imprimer
          </button>
        )}
      </Selecteurs>

      <Erreur message={erreur} />

      {!bulletin ? (
        <div className="carte"><Vide titre="Aucun bulletin" texte="Sélectionnez un élève ayant des notes." /></div>
      ) : (
        <div className="carte p-6 print:border-0 print:shadow-none">
          <div className="mb-6 text-center">
            <h2 className="text-lg font-bold">BULLETIN DE NOTES</h2>
            <p className="text-sm text-slate-500">
              {bulletin.eleve.periode} — Année {bulletin.eleve.annee}
            </p>
            {/* Rappel de l examen national prepare cette annee */}
            {bulletin.eleve.examen && (
              <p className="mt-2 text-xs font-medium text-marine-600 dark:text-marine-400">
                Classe d'examen — {bulletin.eleve.examen}
              </p>
            )}
          </div>

          <div className="mb-5 grid gap-2 text-sm sm:grid-cols-2">
            <p><span className="text-slate-500">Élève :</span> <strong>{bulletin.eleve.prenom} {bulletin.eleve.nom}</strong></p>
            <p><span className="text-slate-500">Matricule :</span> <span className="font-mono">{bulletin.eleve.matricule}</span></p>
            <p><span className="text-slate-500">Classe :</span> {bulletin.eleve.classe}</p>
            <p><span className="text-slate-500">Effectif :</span> {bulletin.synthese.effectif}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="tableau border border-slate-200 dark:border-slate-800">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th className="text-center">Coef.</th>
                  <th className="text-center">Moyenne /20</th>
                  <th className="text-center">Points</th>
                </tr>
              </thead>
              <tbody>
                {bulletin.matieres.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.matiere}</td>
                    <td className="text-center tabular-nums">{m.coefficient}</td>
                    <td className={`text-center font-semibold tabular-nums ${couleurNote(Number(m.moyenne))}`}>
                      {m.moyenne}
                    </td>
                    <td className="text-center tabular-nums text-slate-500">
                      {(Number(m.moyenne) * Number(m.coefficient)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/50 font-semibold">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3 text-center tabular-nums">{bulletin.synthese.total_coefficients}</td>
                  <td className={`px-4 py-3 text-center tabular-nums ${couleurNote(bulletin.synthese.moyenne)}`}>
                    {bulletin.synthese.moyenne}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              ['Moyenne générale', bulletin.synthese.moyenne, couleurNote(bulletin.synthese.moyenne)],
              ['Rang', `${bulletin.synthese.rang}${bulletin.synthese.rang === 1 ? 'er' : 'ème'}`, ''],
              ['Moyenne de classe', bulletin.synthese.moyenne_classe, ''],
              ['Mention', bulletin.synthese.mention, ''],
            ].map(([cle, val, classe]) => (
              <div key={cle} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
                <p className="text-xs text-slate-400">{cle}</p>
                <p className={`mt-0.5 font-semibold ${classe}`}>{val ?? '—'}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
            <span>Absences : <strong>{bulletin.synthese.absences}</strong></span>
            <span>Retards : <strong>{bulletin.synthese.retards}</strong></span>
            <span>Non justifiées : <strong>{bulletin.synthese.non_justifiees}</strong></span>
            <span className="ml-auto">
              Extrêmes : {bulletin.synthese.plus_faible} — {bulletin.synthese.plus_forte}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Onglet Classement ----------
function Classement() {
  const ctx = useContexteScolaire();
  const [classement, setClassement] = useState(null);

  useEffect(() => {
    if (!ctx.classeId || !ctx.periodeId) return;
    setClassement(null);
    get(`/notes/classement/${ctx.classeId}/${ctx.periodeId}`)
      .then(setClassement)
      .catch(() => setClassement([]));
  }, [ctx.classeId, ctx.periodeId]);

  return (
    <div className="space-y-4">
      <Selecteurs ctx={ctx} />
      <div className="carte overflow-hidden">
        {!classement ? <Chargement /> : classement.length === 0 ? (
          <Vide titre="Aucun classement" texte="Aucune note saisie pour cette période." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th className="w-16">Rang</th>
                  <th>Élève</th>
                  <th className="text-center">Moyenne</th>
                  <th className="hidden sm:table-cell text-center">Mention</th>
                </tr>
              </thead>
              <tbody>
                {classement.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.rang <= 3 ? (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Trophy className={`h-4 w-4 ${
                            r.rang === 1 ? 'text-amber-500' : r.rang === 2 ? 'text-slate-400' : 'text-orange-700'
                          }`} />
                          {r.rang}
                        </span>
                      ) : (
                        <span className="text-slate-500 tabular-nums">{r.rang}</span>
                      )}
                    </td>
                    <td>
                      <span className="font-medium">{r.prenom} {r.nom}</span>
                      <span className="block font-mono text-xs text-slate-400">{r.matricule}</span>
                    </td>
                    <td className={`text-center font-semibold tabular-nums ${couleurNote(Number(r.moyenne))}`}>
                      {r.moyenne}
                    </td>
                    <td className="hidden sm:table-cell text-center text-slate-500">{r.mention}</td>
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
