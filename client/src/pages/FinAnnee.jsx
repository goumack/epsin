import { useEffect, useState, useCallback } from 'react';
import { ArrowRight, Save, AlertTriangle } from 'lucide-react';
import { get, post, patch } from '../lib/api';
import {
  Chargement, Vide, Modale, Puce, useToast,
} from '../components/ui';

/**
 * Fin d annee scolaire : on tranche pour chaque eleve, puis on cree les
 * inscriptions de l annee suivante en lot.
 *
 * Les decisions sont proposees d apres la moyenne annuelle (>= 10 : passe),
 * et restent modifiables avant enregistrement.
 */

const DECISIONS = [
  ['passe', 'Passe'],
  ['redouble', 'Redouble'],
  ['parti', 'Transféré'],
  ['abandon', 'Abandon'],
  ['exclu', 'Exclu'],
];

export default function FinAnnee() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [feuille, setFeuille] = useState(null);
  const [brouillon, setBrouillon] = useState({});
  const [envoi, setEnvoi] = useState(false);
  const [passageOuvert, setPassageOuvert] = useState(false);

  useEffect(() => {
    get('/scolarite/classes').then((c) => {
      setClasses(c);
      if (c[0]) setClasseId(String(c[0].id));
    }).catch(() => {});
  }, []);

  // toastErreur est recree a chaque rendu : le mettre en dependance
  // relancerait le chargement en boucle. On s en tient a classeId.
  const charger = useCallback(() => {
    if (!classeId) return;
    setFeuille(null);
    setBrouillon({});
    get(`/parcours/fin-annee/${classeId}`)
      .then(setFeuille)
      .catch(() => setFeuille({ eleves: [], synthese: {} }));
  }, [classeId]);

  useEffect(() => { charger(); }, [charger]);

  const valeur = (e, champ) => brouillon[e.inscription_id]?.[champ] ?? e[champ] ?? '';

  const modifier = (id, champ, val) => {
    setBrouillon((b) => ({ ...b, [id]: { ...b[id], [champ]: val } }));
  };

  /** Enregistre les decisions de tous les eleves affiches. */
  const enregistrer = async () => {
    if (!feuille?.eleves?.length) return;
    setEnvoi(true);
    let ok = 0;
    let echecs = 0;
    for (const e of feuille.eleves) {
      const decision = valeur(e, 'decision');
      if (!decision) continue;
      try {
        await patch(`/parcours/decision/${e.inscription_id}`, {
          decision,
          motif_sortie: valeur(e, 'motif_sortie') || null,
        });
        ok++;
      } catch { echecs++; }
    }
    setEnvoi(false);
    if (echecs) toastErreur(`${ok} enregistrée(s), ${echecs} en échec`);
    else succes(`${ok} décision(s) enregistrée(s)`);
    charger();
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

        <div className="flex gap-2 sm:ml-auto">
          <button onClick={enregistrer} className="bouton-secondaire"
                  disabled={envoi || !feuille?.eleves?.length}>
            <Save className="h-4 w-4" />
            {envoi ? 'Enregistrement…' : 'Enregistrer les décisions'}
          </button>
          <button onClick={() => setPassageOuvert(true)} className="bouton-primaire"
                  disabled={!feuille?.synthese?.tranches}>
            <ArrowRight className="h-4 w-4" /> Passer à l'année suivante
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
              ['Passent', feuille.synthese.passent],
              ['Redoublent', feuille.synthese.redoublent],
              ['Déjà tranchés', `${feuille.synthese.tranches}/${feuille.synthese.effectif}`],
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
                    <th>Élève</th>
                    <th className="text-center">Moyenne annuelle</th>
                    <th>Décision</th>
                    <th>Motif (si sortie)</th>
                    <th className="text-center">État</th>
                  </tr>
                </thead>
                <tbody>
                  {feuille.eleves.map((e) => {
                    const dec = valeur(e, 'decision');
                    const sortie = ['parti', 'abandon', 'exclu'].includes(dec);
                    return (
                      <tr key={e.inscription_id}>
                        <td>
                          <span className="font-medium">{e.prenom} {e.nom}</span>
                          <span className="block font-mono text-xs text-slate-400">{e.matricule}</span>
                        </td>
                        <td className={`text-center font-semibold tabular-nums ${couleur(e.moyenne)}`}>
                          {e.moyenne ?? '—'}
                        </td>
                        <td>
                          <select
                            className="champ py-1 text-sm"
                            value={dec}
                            onChange={(ev) => modifier(e.inscription_id, 'decision', ev.target.value)}
                          >
                            <option value="">—</option>
                            {DECISIONS.map(([cle, lib]) => (
                              <option key={cle} value={cle}>{lib}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {sortie && (
                            <input
                              className="champ py-1 text-sm"
                              value={valeur(e, 'motif_sortie')}
                              onChange={(ev) => modifier(e.inscription_id, 'motif_sortie', ev.target.value)}
                              placeholder="Déménagement, transfert…"
                            />
                          )}
                        </td>
                        <td className="text-center">
                          {e.propose
                            ? <Puce ton="alerte">Proposé</Puce>
                            : <Puce ton="succes">Arrêté</Puce>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-sm text-slate-500">
            Les décisions sont proposées d'après la moyenne annuelle (≥ 10 :
            passe). Enregistrez-les, puis créez les inscriptions de l'année
            suivante.
          </p>
        </>
      )}

      <ModalePassage
        ouvert={passageOuvert}
        feuille={feuille}
        classes={classes}
        onFermer={() => setPassageOuvert(false)}
        onFait={(msg) => { setPassageOuvert(false); succes(msg); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Creation des inscriptions de l annee suivante. */
function ModalePassage({ ouvert, feuille, classes, onFermer, onFait, onErreur }) {
  const [annees, setAnnees] = useState([]);
  const [f, setF] = useState({ annee_cible_id: '', classe_cible_id: '', classe_redoublement_id: '' });
  const [envoi, setEnvoi] = useState(false);

  // On depend de l id de la classe, pas de l objet `feuille` entier :
  // celui-ci change de reference a chaque rechargement.
  const classeCourante = feuille?.classe?.id;

  useEffect(() => {
    if (!ouvert) return;
    get('/scolarite/annees').then((a) => {
      setAnnees(a);
      // Propose l annee suivant celle en cours
      const active = a.find((x) => x.active);
      const suivante = a.find((x) => new Date(x.date_debut) > new Date(active?.date_debut || 0));
      setF((v) => ({
        ...v,
        annee_cible_id: suivante ? String(suivante.id) : '',
        classe_redoublement_id: classeCourante ? String(classeCourante) : '',
      }));
    }).catch(() => {});
  }, [ouvert, classeCourante]);

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await post('/parcours/passage', {
        classe_id: feuille.classe.id,
        annee_cible_id: Number(f.annee_cible_id),
        classe_cible_id: f.classe_cible_id ? Number(f.classe_cible_id) : null,
        classe_redoublement_id: f.classe_redoublement_id ? Number(f.classe_redoublement_id) : null,
      });
      onFait(r.message);
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Passer à l'année suivante" taille="sm">
      {feuille?.classe && (
        <form onSubmit={soumettre} className="space-y-3">
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            <strong>{feuille.classe.libelle}</strong> — {feuille.synthese.passent} passage(s),
            {' '}{feuille.synthese.redoublent} redoublement(s).
            {feuille.niveau_suivant && (
              <span className="block text-slate-500">
                Niveau suivant : {feuille.niveau_suivant.libelle}
              </span>
            )}
          </p>

          <div>
            <label className="etiquette">Année scolaire cible *</label>
            <select className="champ" value={f.annee_cible_id} required
                    onChange={(e) => setF({ ...f, annee_cible_id: e.target.value })}>
              <option value="">Choisir…</option>
              {annees.map((a) => (
                <option key={a.id} value={a.id}>{a.libelle}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="etiquette">Classe d'accueil (élèves qui passent)</label>
            <select className="champ" value={f.classe_cible_id}
                    onChange={(e) => setF({ ...f, classe_cible_id: e.target.value })}>
              <option value="">Choisir…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </div>

          <div>
            <label className="etiquette">Classe des redoublants</label>
            <select className="champ" value={f.classe_redoublement_id}
                    onChange={(e) => setF({ ...f, classe_redoublement_id: e.target.value })}>
              <option value="">Choisir…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Seuls les élèves dont la décision est <em>passe</em> ou <em>redouble</em>
            {' '}sont inscrits. Les transferts, abandons et exclusions sont ignorés.
          </p>

          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire" disabled={envoi}>
              {envoi ? 'Création…' : 'Créer les inscriptions'}
            </button>
          </div>
        </form>
      )}
    </Modale>
  );
}

function couleur(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n >= 14) return 'text-emerald-600 dark:text-emerald-400';
  if (n >= 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
