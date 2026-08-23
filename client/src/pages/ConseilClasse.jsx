import { useEffect, useState, useCallback } from 'react';
import { Check, Save, RotateCcw } from 'lucide-react';
import { get, put, patch } from '../lib/api';
import {
  Chargement, Vide, Puce, useToast,
} from '../components/ui';

/**
 * Feuille de conseil de classe.
 *
 * Le conseil parcourt la liste des eleves, ajuste les decisions pre-cochees
 * d apres la moyenne, puis enregistre. Chaque ligne porte les deux grilles
 * du bulletin officiel : appreciation generale et distinction.
 */

const APPRECIATIONS = [
  ['satisfaisant', 'Satisfaisant'],
  ['peut_mieux_faire', 'Peut Mieux Faire'],
  ['insuffisant', 'Insuffisant'],
  ['risque_redoubler', 'Risque de Redoubler'],
  ['risque_exclusion', "Risque l'exclusion"],
];

const DISTINCTIONS = [
  ['felicitations', 'Félicitations'],
  ['encouragement', 'Encouragement'],
  ['tableau_honneur', "Tableau d'honneur"],
  ['avertissement', 'Avertissement'],
  ['blame', 'Blâme'],
];

export default function ConseilClasse() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [classes, setClasses] = useState([]);
  const [periodes, setPeriodes] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [periodeId, setPeriodeId] = useState('');
  const [feuille, setFeuille] = useState(null);
  const [brouillon, setBrouillon] = useState({});   // eleve_id -> modifications
  const [envoi, setEnvoi] = useState(false);

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

  const charger = useCallback(() => {
    if (!classeId || !periodeId) return;
    setFeuille(null);
    setBrouillon({});
    get(`/notes/conseil/${classeId}/${periodeId}`)
      .then(setFeuille)
      .catch(() => setFeuille({ eleves: [], synthese: {} }));
  }, [classeId, periodeId]);

  useEffect(() => { charger(); }, [charger]);

  /** Valeur courante d un champ : le brouillon prime sur les donnees chargees. */
  const valeur = (e, champ) => brouillon[e.eleve_id]?.[champ] ?? e[champ] ?? '';

  const modifier = (eleveId, champ, val) => {
    setBrouillon((b) => ({ ...b, [eleveId]: { ...b[eleveId], [champ]: val } }));
  };

  /** Enregistre les decisions de tous les eleves affiches. */
  const enregistrer = async () => {
    if (!feuille?.eleves?.length) return;
    setEnvoi(true);
    let ok = 0;
    let echecs = 0;
    for (const e of feuille.eleves) {
      try {
        await put(`/notes/conseil/${e.eleve_id}/${periodeId}`, {
          appreciation: valeur(e, 'appreciation') || null,
          distinction: valeur(e, 'distinction') || null,
          observations: valeur(e, 'observations') || null,
        });
        ok++;
      } catch { echecs++; }
    }
    setEnvoi(false);
    if (echecs) toastErreur(`${ok} enregistré(s), ${echecs} en échec`);
    else succes(`Conseil arrêté pour ${ok} élève(s)`);
    charger();
  };

  /** Bascule le statut redoublant d un eleve. */
  const basculerRedoublant = async (e) => {
    try {
      await patch(`/eleves/${e.eleve_id}/redoublant`, { redoublant: !e.redoublant });
      succes(e.redoublant ? 'Redoublement retiré' : 'Marqué redoublant');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  const modifie = Object.keys(brouillon).length > 0;

  return (
    <div className="animer space-y-4">
      <Toast />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select className="champ sm:w-52" value={classeId}
                onChange={(e) => setClasseId(e.target.value)}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
        <select className="champ sm:w-44" value={periodeId}
                onChange={(e) => setPeriodeId(e.target.value)}>
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </select>

        <div className="flex gap-2 sm:ml-auto">
          {modifie && (
            <button onClick={charger} className="bouton-secondaire" disabled={envoi}>
              <RotateCcw className="h-4 w-4" /> Annuler
            </button>
          )}
          <button onClick={enregistrer} className="bouton-primaire" disabled={envoi || !feuille?.eleves?.length}>
            <Save className="h-4 w-4" />
            {envoi ? 'Enregistrement…' : 'Arrêter le conseil'}
          </button>
        </div>
      </div>

      {!feuille ? <Chargement /> : !feuille.eleves?.length ? (
        <div className="carte">
          <Vide titre="Aucun élève" texte="Cette classe n'a pas d'élève inscrit." />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Effectif', feuille.synthese.effectif],
              ['Moyenne de classe', feuille.synthese.moyenne_classe ?? '—'],
              ['Moyennes ≥ 10', `${feuille.synthese.admis}/${feuille.synthese.notes}`],
              ['Déjà arrêtés', `${feuille.synthese.arretes}/${feuille.synthese.effectif}`],
            ].map(([libelle, val]) => (
              <div key={libelle} className="carte p-3 text-center">
                <p className="text-xs text-slate-500">{libelle}</p>
                <p className="text-lg font-semibold tabular-nums">{val}</p>
              </div>
            ))}
          </div>

          <div className="carte overflow-hidden">
            <div className="overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th className="text-center">Rang</th>
                    <th>Élève</th>
                    <th className="text-center">Moy.</th>
                    <th className="text-center">Abs.</th>
                    <th>Appréciation</th>
                    <th>Distinction</th>
                    <th className="text-center">Redoublant</th>
                    <th className="text-center">État</th>
                  </tr>
                </thead>
                <tbody>
                  {feuille.eleves.map((e) => (
                    <tr key={e.eleve_id}>
                      <td className="text-center tabular-nums text-slate-500">
                        {e.moyenne != null ? e.rang : '—'}
                      </td>
                      <td>
                        <span className="font-medium">{e.prenom} {e.nom}</span>
                        <span className="block font-mono text-xs text-slate-400">{e.matricule}</span>
                      </td>
                      <td className={`text-center font-semibold tabular-nums ${couleur(e.moyenne)}`}>
                        {e.moyenne ?? '—'}
                      </td>
                      <td className="text-center tabular-nums text-slate-500">{e.absences}</td>
                      <td>
                        <select
                          className="champ py-1 text-sm"
                          value={valeur(e, 'appreciation')}
                          onChange={(ev) => modifier(e.eleve_id, 'appreciation', ev.target.value)}
                        >
                          <option value="">—</option>
                          {APPRECIATIONS.map(([cle, lib]) => (
                            <option key={cle} value={cle}>{lib}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="champ py-1 text-sm"
                          value={valeur(e, 'distinction')}
                          onChange={(ev) => modifier(e.eleve_id, 'distinction', ev.target.value)}
                        >
                          <option value="">—</option>
                          {DISTINCTIONS.map(([cle, lib]) => (
                            <option key={cle} value={cle}>{lib}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={Boolean(e.redoublant)}
                          onChange={() => basculerRedoublant(e)}
                          className="h-4 w-4 cursor-pointer accent-marine-600"
                          aria-label={`Redoublant : ${e.prenom} ${e.nom}`}
                        />
                      </td>
                      <td className="text-center">
                        {e.moyenne == null ? (
                          <Puce>Sans note</Puce>
                        ) : e.arrete ? (
                          <Puce ton="succes"><Check className="mr-0.5 inline h-3 w-3" />Arrêté</Puce>
                        ) : (
                          <Puce ton="alerte">Proposé</Puce>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-sm text-slate-500">
            Les décisions non arrêtées sont pré-remplies d'après la moyenne.
            Ajustez-les si besoin, puis enregistrez : elles apparaîtront sur
            les bulletins.
          </p>
        </>
      )}
    </div>
  );
}

function couleur(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n >= 14) return 'text-emerald-600 dark:text-emerald-400';
  if (n >= 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
