import { useEffect, useState, useCallback } from 'react';
import {
  CalendarPlus, GraduationCap, TrendingUp, TrendingDown, Minus, Clock,
} from 'lucide-react';
import { get, post, dateFr, fcfa } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Chargement, Vide, Modale, Puce, Onglets, useToast,
} from '../components/ui';
import BulletinOfficiel from '../components/BulletinOfficiel';
import { MensualitesWave, SuiviPaiement, ListeRecus } from '../components/PaiementWave';
import { useSearchParams } from 'react-router-dom';

/**
 * Portail du tuteur : le suivi de son enfant.
 *
 * Le compte est rattache a un eleve precis ; toutes les donnees affichees
 * viennent du serveur deja filtrees sur cet enfant.
 */
export default function MonEnfant() {
  const { utilisateur } = useAuth();
  // Au retour de Wave, l URL porte ?paiement=<id> : on ouvre les finances
  // pour suivre la confirmation.
  const [params, setParams] = useSearchParams();
  const paiementRetour = params.get('paiement');
  const [onglet, setOnglet] = useState(paiementRetour ? 'finances' : 'scolarite');
  const [eleve, setEleve] = useState(null);
  const [periodes, setPeriodes] = useState([]);
  const [periodeId, setPeriodeId] = useState('');

  const eleveId = utilisateur?.eleve_suivi_id;

  useEffect(() => {
    if (!eleveId) return;
    get(`/eleves/${eleveId}`).then(setEleve).catch(() => setEleve(null));
    get('/scolarite/periodes').then((p) => {
      setPeriodes(p);
      if (p[0]) setPeriodeId(String(p[0].id));
    }).catch(() => {});
  }, [eleveId]);

  if (!eleveId) {
    return (
      <div className="carte">
        <Vide titre="Aucun enfant rattaché" texte="Contactez l'établissement." />
      </div>
    );
  }
  if (!eleve) return <Chargement />;

  return (
    <div className="animer space-y-4">
      {/* En-tete : l enfant suivi */}
      <div className="carte flex flex-wrap items-center gap-3 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 font-semibold text-marine-700 dark:text-marine-300">
          {eleve.prenom?.[0]}{eleve.nom?.[0]}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{eleve.prenom} {eleve.nom}</h2>
          <p className="text-sm text-slate-500">
            <span className="font-mono text-xs">{eleve.matricule}</span>
            {eleve.classe && ` · ${eleve.classe}`}
          </p>
        </div>
        {eleve.classe && <Puce ton="info">{eleve.classe}</Puce>}
      </div>

      <Onglets
        onglets={[
          { cle: 'scolarite', libelle: 'Scolarité' },
          { cle: 'evolution', libelle: 'Évolution' },
          { cle: 'assiduite', libelle: 'Assiduité' },
          { cle: 'finances', libelle: 'Finances' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />

      {onglet === 'scolarite' && (
        <Scolarite
          eleveId={eleveId} periodes={periodes}
          periodeId={periodeId} setPeriodeId={setPeriodeId}
        />
      )}
      {onglet === 'evolution' && <Evolution eleveId={eleveId} periodes={periodes} />}
      {onglet === 'assiduite' && <Assiduite eleveId={eleveId} />}
      {onglet === 'finances' && (
        <Finances
          eleveId={eleveId}
          paiementRetour={paiementRetour}
          fermerRetour={() => setParams({}, { replace: true })}
        />
      )}
    </div>
  );
}

/** Bulletin de la periode choisie. */
function Scolarite({ eleveId, periodes, periodeId, setPeriodeId }) {
  const [bulletin, setBulletin] = useState(null);
  const [vide, setVide] = useState(false);

  useEffect(() => {
    if (!periodeId) return;
    setBulletin(null); setVide(false);
    get(`/notes/bulletin/${eleveId}/${periodeId}`)
      .then((b) => {
        if (!b.matieres?.length) setVide(true);
        setBulletin(b);
      })
      .catch(() => setVide(true));
  }, [eleveId, periodeId]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <select className="champ sm:w-52" value={periodeId}
                onChange={(e) => setPeriodeId(e.target.value)}>
          {periodes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </select>
      </div>

      {vide ? (
        <div className="carte">
          <Vide titre="Pas encore de notes" texte="Le bulletin sera disponible dès les premières évaluations." />
        </div>
      ) : !bulletin ? <Chargement /> : (
        <>
          <div className="flex justify-end print:hidden">
            <button onClick={() => window.print()} className="bouton-secondaire">
              Imprimer le bulletin
            </button>
          </div>
          <div className="carte overflow-x-auto p-0">
            <BulletinOfficiel bulletin={bulletin} />
          </div>
        </>
      )}
    </div>
  );
}

/** Evolution des moyennes d une periode a l autre. */
function Evolution({ eleveId, periodes }) {
  const [donnees, setDonnees] = useState(null);

  useEffect(() => {
    if (!periodes.length) return;
    Promise.all(
      periodes.map((p) =>
        get(`/notes/bulletin/${eleveId}/${p.id}`)
          .then((b) => ({
            periode: p.libelle,
            moyenne: b.synthese?.moyenne ?? null,
            rang: b.synthese?.rang ?? null,
            effectif: b.synthese?.effectif ?? null,
            matieres: b.matieres || [],
          }))
          .catch(() => ({ periode: p.libelle, moyenne: null, matieres: [] }))
      )
    ).then(setDonnees);
  }, [eleveId, periodes]);

  if (!donnees) return <Chargement />;

  const remplies = donnees.filter((d) => d.moyenne != null);
  if (!remplies.length) {
    return (
      <div className="carte">
        <Vide titre="Pas encore d'historique" texte="L'évolution apparaîtra après le premier bulletin." />
      </div>
    );
  }

  // Progression d une periode a la suivante
  const variation = (i) => {
    if (i === 0) return null;
    const avant = remplies[i - 1].moyenne;
    const apres = remplies[i].moyenne;
    if (avant == null || apres == null) return null;
    return Number((apres - avant).toFixed(2));
  };

  // Matieres de la derniere periode, triees pour reperer forces et fragilites.
  // Avec peu de matieres, les deux listes se chevaucheraient : on coupe donc
  // au milieu pour qu une meme matiere n apparaisse jamais des deux cotes.
  const derniere = remplies[remplies.length - 1];
  const triees = [...derniere.matieres].sort((a, b) => Number(b.moyenne) - Number(a.moyenne));
  const taille = Math.min(3, Math.floor(triees.length / 2)) || (triees.length ? 1 : 0);
  const forts = triees.slice(0, taille);
  const fragiles = taille ? triees.slice(-taille).reverse() : [];

  return (
    <div className="space-y-3">
      <div className="carte p-4">
        <h3 className="mb-3 font-medium">Moyenne par trimestre</h3>
        <div className="space-y-3">
          {remplies.map((d, i) => {
            const v = variation(i);
            return (
              <div key={d.periode} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-slate-500">{d.periode}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-marine-500"
                    style={{ width: `${Math.min((d.moyenne / 20) * 100, 100)}%` }}
                  />
                </div>
                <span className={`w-14 shrink-0 text-right font-semibold tabular-nums ${couleurNote(d.moyenne)}`}>
                  {d.moyenne}
                </span>
                <span className="flex w-16 shrink-0 items-center justify-end gap-1 text-xs">
                  {v == null ? (
                    <span className="text-slate-400">—</span>
                  ) : v > 0 ? (
                    <><TrendingUp className="h-3 w-3 text-emerald-600" />
                      <span className="text-emerald-600">+{v}</span></>
                  ) : v < 0 ? (
                    <><TrendingDown className="h-3 w-3 text-red-600" />
                      <span className="text-red-600">{v}</span></>
                  ) : (
                    <><Minus className="h-3 w-3 text-slate-400" />
                      <span className="text-slate-400">0</span></>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {remplies.length > 1 && (
          <p className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3 text-sm text-slate-500">
            {(() => {
              const total = Number((remplies[remplies.length - 1].moyenne - remplies[0].moyenne).toFixed(2));
              if (total > 0) return `Progression de +${total} point(s) depuis le premier trimestre.`;
              if (total < 0) return `Baisse de ${Math.abs(total)} point(s) depuis le premier trimestre.`;
              return 'Moyenne stable depuis le premier trimestre.';
            })()}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="carte p-4">
          <h3 className="mb-2 flex items-center gap-2 font-medium">
            <GraduationCap className="h-4 w-4 text-emerald-600" /> Points forts
          </h3>
          {forts.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-1 text-sm">
              <span className="truncate pr-2">{m.matiere}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${couleurNote(m.moyenne)}`}>{m.moyenne}</span>
            </div>
          ))}
        </div>
        <div className="carte p-4">
          <h3 className="mb-2 font-medium">À consolider</h3>
          {fragiles.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-1 text-sm">
              <span className="truncate pr-2">{m.matiere}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${couleurNote(m.moyenne)}`}>{m.moyenne}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Assiduite, avec signalement d absence par le tuteur. */
function Assiduite({ eleveId }) {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [absences, setAbsences] = useState(null);
  const [ouvert, setOuvert] = useState(false);

  const charger = useCallback(() => {
    get(`/vie-scolaire/absences?eleve_id=${eleveId}`)
      .then(setAbsences)
      .catch(() => setAbsences([]));
  }, [eleveId]);

  useEffect(() => { charger(); }, [charger]);

  if (!absences) return <Chargement />;

  const total = absences.filter((a) => a.type === 'absence').length;
  const retards = absences.filter((a) => a.type === 'retard').length;
  const attente = absences.filter((a) => a.confirmee === false).length;

  return (
    <div className="space-y-3">
      <Toast />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-3 gap-3">
          {[['Absences', total], ['Retards', retards], ['À confirmer', attente]].map(([l, v]) => (
            <div key={l} className="carte p-3 text-center">
              <p className="text-lg font-semibold tabular-nums">{v}</p>
              <p className="text-xs text-slate-500">{l}</p>
            </div>
          ))}
        </div>
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <CalendarPlus className="h-4 w-4" /> Signaler une absence
        </button>
      </div>

      <div className="carte overflow-hidden">
        {absences.length === 0 ? (
          <Vide titre="Aucune absence" texte="Votre enfant n'a manqué aucun cours." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th className="hidden sm:table-cell">Motif</th>
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.id}>
                    <td>{dateFr(a.date_abs)}</td>
                    <td>{a.type === 'retard' ? 'Retard' : 'Absence'}</td>
                    <td>
                      {a.confirmee === false ? (
                        <Puce ton="alerte">À confirmer</Puce>
                      ) : a.justifiee ? (
                        <Puce ton="succes">Justifiée</Puce>
                      ) : (
                        <Puce ton="danger">Non justifiée</Puce>
                      )}
                    </td>
                    <td className="hidden sm:table-cell text-sm text-slate-500">
                      {a.motif_tuteur || a.motif || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormulaireAbsence
        ouvert={ouvert}
        onFermer={() => setOuvert(false)}
        onSignale={(msg) => { setOuvert(false); succes(msg); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Signalement d une absence par le tuteur. */
function FormulaireAbsence({ ouvert, onFermer, onSignale, onErreur }) {
  const vide = { date_abs: '', date_fin: '', type: 'absence', motif: '' };
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (ouvert) setF(vide); }, [ouvert]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const r = await post('/vie-scolaire/absences/signaler', {
        ...f, date_fin: f.date_fin || f.date_abs,
      });
      onSignale(r.message || 'Absence signalée');
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Signaler une absence" taille="sm">
      <form onSubmit={soumettre} className="space-y-3">
        <div>
          <label className="etiquette">Type</label>
          <select className="champ" value={f.type} onChange={maj('type')}>
            <option value="absence">Absence</option>
            <option value="retard">Retard</option>
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiquette">Du *</label>
            <input type="date" className="champ" value={f.date_abs}
                   onChange={maj('date_abs')} required />
          </div>
          <div>
            <label className="etiquette">Au</label>
            <input type="date" className="champ" value={f.date_fin}
                   onChange={maj('date_fin')} min={f.date_abs}
                   placeholder="Même jour" />
          </div>
        </div>
        <div>
          <label className="etiquette">Motif *</label>
          <textarea className="champ" rows={3} value={f.motif} onChange={maj('motif')}
                    placeholder="Maladie, rendez-vous médical…" required />
        </div>
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Clock className="mt-0.5 h-3 w-3 shrink-0" />
          Votre signalement sera transmis à l'établissement, qui le confirmera.
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Envoi…' : 'Signaler'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

/** Situation financiere de l enfant, et paiement des mensualites par Wave. */
function Finances({ eleveId, paiementRetour, fermerRetour }) {
  const [situation, setSituation] = useState(null);
  // Change a chaque paiement confirme pour recharger les mensualites
  const [version, setVersion] = useState(0);
  const { Toast, succes, erreur } = useToast();

  const chargerSituation = useCallback(() => {
    get(`/finances/situation/${eleveId}`)
      .then(setSituation)
      .catch(() => setSituation(null));
  }, [eleveId]);

  useEffect(() => { chargerSituation(); }, [chargerSituation]);

  if (!situation) return <Chargement />;

  return (
    <div className="space-y-3">
      <Toast />
      {paiementRetour && (
        <SuiviPaiement
          id={paiementRetour}
          onTermine={(p) => {
            if (p.statut === 'reussi') { chargerSituation(); setVersion((v) => v + 1); }
          }}
          onFermer={fermerRetour}
        />
      )}

      <MensualitesWave
        key={version}
        onPaye={() => { chargerSituation(); succes('Paiement transmis'); }}
        onErreur={erreur}
      />
      <ListeRecus key={`recus-${version}`} />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Total dû', situation.total_du],
          ['Payé', situation.total_paye],
          ['Reste à payer', situation.reste],
        ].map(([libelle, montant], i) => (
          <div key={libelle} className="carte p-3 text-center">
            <p className="text-xs text-slate-500">{libelle}</p>
            <p className={`text-lg font-semibold tabular-nums ${
              i === 2 && Number(montant) > 0 ? 'text-red-600 dark:text-red-400' : ''
            }`}>
              {fcfa(montant)}
            </p>
          </div>
        ))}
      </div>

      {situation.lignes?.length > 0 && (
        <div className="carte overflow-hidden">
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Frais</th>
                  <th className="text-right">Dû</th>
                  <th className="text-right">Payé</th>
                  <th className="text-right">Reste</th>
                </tr>
              </thead>
              <tbody>
                {situation.lignes.map((l, i) => (
                  <tr key={i}>
                    <td>{l.libelle}</td>
                    <td className="text-right tabular-nums">{fcfa(l.du)}</td>
                    <td className="text-right tabular-nums">{fcfa(l.paye)}</td>
                    <td className={`text-right tabular-nums ${
                      Number(l.reste) > 0 ? 'text-red-600 dark:text-red-400' : ''
                    }`}>
                      {fcfa(l.reste)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function couleurNote(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n >= 14) return 'text-emerald-600 dark:text-emerald-400';
  if (n >= 10) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
