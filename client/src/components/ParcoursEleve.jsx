import { useEffect, useState } from 'react';
import {
  GraduationCap, RotateCcw, LogOut, Ban, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { get, fcfa } from '../lib/api';
import { Chargement, Vide, Puce } from './ui';

/**
 * Parcours scolaire pluriannuel d un eleve.
 *
 * Une carte par annee, de la plus recente a la plus ancienne : classe,
 * moyennes trimestrielles, assiduite, paiements et decision de fin d annee.
 */

const DECISIONS = {
  passe: { libelle: 'Admis en classe supérieure', ton: 'succes', Icone: GraduationCap },
  redouble: { libelle: 'Redouble', ton: 'alerte', Icone: RotateCcw },
  parti: { libelle: 'Transféré', ton: 'neutre', Icone: LogOut },
  abandon: { libelle: 'A quitté l’école', ton: 'danger', Icone: Ban },
  exclu: { libelle: 'Exclu', ton: 'danger', Icone: Ban },
};

export default function ParcoursEleve({ eleveId }) {
  const [parcours, setParcours] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!eleveId) return;
    setParcours(null); setErreur('');
    get(`/parcours/eleve/${eleveId}`)
      .then(setParcours)
      .catch((e) => setErreur(e.message));
  }, [eleveId]);

  if (erreur) return <Vide titre="Parcours indisponible" texte={erreur} />;
  if (!parcours) return <Chargement />;
  if (!parcours.annees?.length) {
    return <Vide titre="Aucun historique" texte="Cet élève n'a pas d'année scolaire enregistrée." />;
  }

  return (
    <div className="space-y-3">
      {parcours.annees.map((a, i) => {
        // Evolution par rapport a l annee suivante dans la liste (= l annee
        // precedente dans le temps, puisque le tri est du plus recent au plus ancien)
        const precedente = parcours.annees[i + 1];
        const ecart = (a.moyenne_annuelle != null && precedente?.moyenne_annuelle != null)
          ? Number((a.moyenne_annuelle - precedente.moyenne_annuelle).toFixed(2))
          : null;
        const dec = a.decision ? DECISIONS[a.decision] : null;

        return (
          <div key={a.inscription_id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{a.annee}</span>
              <Puce ton="info">{a.classe}</Puce>
              <span className="text-sm text-slate-500">{a.niveau} · {a.cycle}</span>
              {a.redoublant && <Puce ton="alerte">Redoublant</Puce>}
              {a.active && <Puce ton="succes">Année en cours</Puce>}

              <div className="ml-auto flex items-center gap-2">
                {a.moyenne_annuelle != null && (
                  <>
                    <span className={`font-semibold tabular-nums ${couleur(a.moyenne_annuelle)}`}>
                      {a.moyenne_annuelle}/20
                    </span>
                    {ecart != null && (
                      <span className="flex items-center gap-0.5 text-xs">
                        {ecart > 0 ? (
                          <><TrendingUp className="h-3 w-3 text-emerald-600" />
                            <span className="text-emerald-600">+{ecart}</span></>
                        ) : ecart < 0 ? (
                          <><TrendingDown className="h-3 w-3 text-red-600" />
                            <span className="text-red-600">{ecart}</span></>
                        ) : (
                          <><Minus className="h-3 w-3 text-slate-400" />
                            <span className="text-slate-400">0</span></>
                        )}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Moyennes par trimestre */}
            {a.periodes?.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {a.periodes.map((p) => (
                  <span
                    key={p.periode_id}
                    className="rounded bg-slate-50 dark:bg-slate-800/50 px-2 py-1 text-xs"
                  >
                    {p.periode} :{' '}
                    <span className={`font-semibold tabular-nums ${couleur(p.moyenne)}`}>
                      {p.moyenne}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-3 border-t border-slate-100 dark:border-slate-800 pt-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-400">Assiduité</p>
                <p>
                  {a.assiduite.absences} absence{a.assiduite.absences > 1 ? 's' : ''}
                  {' · '}{a.assiduite.retards} retard{a.assiduite.retards > 1 ? 's' : ''}
                  {a.assiduite.non_justifiees > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {' '}({a.assiduite.non_justifiees} non justifiée{a.assiduite.non_justifiees > 1 ? 's' : ''})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Réglé cette année</p>
                <p className="tabular-nums">{fcfa(a.finances.paye)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Fin d'année</p>
                {dec ? (
                  <p className="flex items-center gap-1.5">
                    <dec.Icone className="h-3.5 w-3.5 shrink-0" />
                    <span>{dec.libelle}</span>
                  </p>
                ) : (
                  <p className="text-slate-400">En cours</p>
                )}
                {a.motif_sortie && (
                  <p className="text-xs text-slate-500">{a.motif_sortie}</p>
                )}
                {a.decideur_nom && (
                  <p className="text-xs text-slate-400">
                    par {a.decideur_prenom} {a.decideur_nom}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
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
