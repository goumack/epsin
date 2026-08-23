import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Printer, Pencil } from 'lucide-react';
import { get, post, patch, supprimer } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Chargement, Vide, Modale, useToast } from '../components/ui';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/** Convertit "08:00:00" en minutes depuis minuit, pour positionner les blocs. */
const enMinutes = (h) => {
  const [hh, mm] = String(h).split(':').map(Number);
  return hh * 60 + (mm || 0);
};

const DEBUT_JOURNEE = 7 * 60;   // 07:00
const FIN_JOURNEE = 19 * 60;    // 19:00
const HAUTEUR = 62;             // pixels par heure

export default function EmploiDuTemps() {
  const { aRole, utilisateur } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [creneaux, setCreneaux] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [edition, setEdition] = useState(null);   // creneau en cours de modification

  // Les chefs organisent l emploi du temps de leur entite ; un enseignant
  // gere ses propres heures (le serveur verifie que ce sont bien les siennes).
  const estChef = aRole('admin', 'censeur', 'directeur', 'proviseur');
  const estEnseignant = aRole('enseignant');
  const peutModifier = estChef || estEnseignant;

  /** Un enseignant ne touche qu a ses propres cours. */
  const peutToucher = (c) => estChef || (estEnseignant && c.ens_utilisateur_id === utilisateur?.id);

  const charger = useCallback(() => {
    if (!classeId) return;
    setCreneaux(null);
    get(`/scolarite/emploi-du-temps/${classeId}`).then(setCreneaux).catch(() => setCreneaux([]));
  }, [classeId]);

  useEffect(() => {
    get('/scolarite/classes').then((c) => {
      setClasses(c);
      if (c[0]) setClasseId(String(c[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const retirer = async (id) => {
    if (!window.confirm('Supprimer ce créneau ?')) return;
    try {
      await supprimer(`/scolarite/creneaux/${id}`);
      succes('Créneau supprimé');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  const heures = [];
  for (let m = DEBUT_JOURNEE; m <= FIN_JOURNEE; m += 60) heures.push(m);

  return (
    <div className="animer space-y-4">
      <Toast />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center print:hidden">
        <select className="champ sm:w-52" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
        </select>
        <div className="flex gap-2 sm:ml-auto">
          <button onClick={() => window.print()} className="bouton-secondaire">
            <Printer className="h-4 w-4" /> Imprimer
          </button>
          {peutModifier && (
            <button onClick={() => setOuvert(true)} className="bouton-primaire">
              <Plus className="h-4 w-4" /> Ajouter un cours
            </button>
          )}
        </div>
      </div>

      {!creneaux ? <Chargement /> : creneaux.length === 0 ? (
        <div className="carte"><Vide titre="Emploi du temps vide" texte="Ajoutez des créneaux pour cette classe." /></div>
      ) : (
        <div className="carte overflow-x-auto p-4">
          <div className="min-w-[720px]">
            {/* En-tete des jours */}
            <div className="grid" style={{ gridTemplateColumns: '56px repeat(6, 1fr)' }}>
              <div />
              {JOURS.map((j) => (
                <div key={j} className="pb-2 text-center text-sm font-semibold">{j}</div>
              ))}
            </div>

            {/* Grille horaire */}
            <div className="relative grid" style={{ gridTemplateColumns: '56px repeat(6, 1fr)' }}>
              {/* Colonne des heures */}
              <div className="relative" style={{ height: (FIN_JOURNEE - DEBUT_JOURNEE) / 60 * HAUTEUR }}>
                {heures.map((m) => (
                  <div
                    key={m}
                    className="absolute -translate-y-1/2 text-[11px] tabular-nums text-slate-400"
                    style={{ top: ((m - DEBUT_JOURNEE) / 60) * HAUTEUR }}
                  >
                    {String(Math.floor(m / 60)).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Une colonne par jour */}
              {JOURS.map((_, index) => {
                const jour = index + 1;
                const duJour = creneaux.filter((c) => c.jour === jour);
                return (
                  <div
                    key={jour}
                    className="relative border-l border-slate-100 dark:border-slate-800"
                    style={{ height: (FIN_JOURNEE - DEBUT_JOURNEE) / 60 * HAUTEUR }}
                  >
                    {/* Lignes d heures */}
                    {heures.map((m) => (
                      <div
                        key={m}
                        className="absolute w-full border-t border-slate-100 dark:border-slate-800"
                        style={{ top: ((m - DEBUT_JOURNEE) / 60) * HAUTEUR }}
                      />
                    ))}

                    {duJour.map((c) => {
                      const debut = enMinutes(c.heure_debut);
                      const fin = enMinutes(c.heure_fin);
                      return (
                        <div
                          key={c.id}
                          className="group absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1.5 text-white shadow-sm"
                          style={{
                            top: ((debut - DEBUT_JOURNEE) / 60) * HAUTEUR + 1,
                            height: ((fin - debut) / 60) * HAUTEUR - 3,
                            backgroundColor: c.couleur || '#3b82f6',
                          }}
                        >
                          <p className="truncate text-xs font-semibold leading-tight">{c.matiere}</p>
                          <p className="truncate text-[10px] opacity-90">
                            {String(c.heure_debut).slice(0, 5)}–{String(c.heure_fin).slice(0, 5)}
                          </p>
                          {c.ens_nom && (
                            <p className="truncate text-[10px] opacity-80">{c.ens_prenom} {c.ens_nom}</p>
                          )}
                          {c.salle && <p className="truncate text-[10px] opacity-75">{c.salle}</p>}
                          {peutToucher(c) && (
                            <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex print:hidden">
                              <button
                                onClick={() => setEdition(c)}
                                className="rounded bg-black/25 p-1"
                                aria-label="Modifier"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => retirer(c.id)}
                                className="rounded bg-black/25 p-1"
                                aria-label="Supprimer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <FormulaireCreneau
        ouvert={ouvert}
        classeId={classeId}
        onFermer={() => setOuvert(false)}
        onCree={() => { setOuvert(false); succes('Créneau ajouté'); charger(); }}
        onErreur={toastErreur}
      />

      <ModaleDeplacer
        creneau={edition}
        onFermer={() => setEdition(null)}
        onModifie={() => { setEdition(null); succes('Créneau modifié'); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Deplace un cours : jour, horaires et salle. La matiere ne change pas. */
function ModaleDeplacer({ creneau, onFermer, onModifie, onErreur }) {
  const [f, setF] = useState({ jour: 1, heure_debut: '', heure_fin: '', salle: '' });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (creneau) {
      setF({
        jour: creneau.jour,
        heure_debut: String(creneau.heure_debut).slice(0, 5),
        heure_fin: String(creneau.heure_fin).slice(0, 5),
        salle: creneau.salle || '',
      });
    }
  }, [creneau]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await patch(`/scolarite/creneaux/${creneau.id}`, { ...f, jour: Number(f.jour) });
      onModifie();
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={Boolean(creneau)} onFermer={onFermer} titre="Déplacer le cours" taille="sm">
      {creneau && (
        <form onSubmit={soumettre} className="space-y-3">
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
            <span className="font-medium">{creneau.matiere}</span>
            {creneau.ens_nom && (
              <span className="text-slate-500"> · {creneau.ens_prenom} {creneau.ens_nom}</span>
            )}
          </p>
          <div>
            <label className="etiquette">Jour</label>
            <select className="champ" value={f.jour} onChange={maj('jour')}>
              {JOURS.map((j, i) => (
                <option key={j} value={i + 1}>{j}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiquette">Début</label>
              <input type="time" className="champ" value={f.heure_debut}
                     onChange={maj('heure_debut')} required />
            </div>
            <div>
              <label className="etiquette">Fin</label>
              <input type="time" className="champ" value={f.heure_fin}
                     onChange={maj('heure_fin')} required />
            </div>
          </div>
          <div>
            <label className="etiquette">Salle</label>
            <input className="champ" value={f.salle} onChange={maj('salle')} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire" disabled={envoi}>
              {envoi ? 'Enregistrement…' : 'Déplacer'}
            </button>
          </div>
        </form>
      )}
    </Modale>
  );
}

function FormulaireCreneau({ ouvert, classeId, onFermer, onCree, onErreur }) {
  const [matieres, setMatieres] = useState([]);
  const [enseignants, setEnseignants] = useState([]);
  const [f, setF] = useState({
    matiere_id: '', enseignant_id: '', jour: 1,
    heure_debut: '08:00', heure_fin: '10:00', salle: '',
  });
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    get('/scolarite/matieres').then((m) => {
      setMatieres(m);
      setF((v) => ({ ...v, matiere_id: m[0]?.id || '' }));
    }).catch(() => {});
    get('/scolarite/enseignants').then(setEnseignants).catch(() => {});
  }, [ouvert]);

  const maj = (c) => (e) => setF((v) => ({ ...v, [c]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post('/scolarite/creneaux', {
        classe_id: Number(classeId),
        matiere_id: Number(f.matiere_id),
        enseignant_id: f.enseignant_id ? Number(f.enseignant_id) : null,
        jour: Number(f.jour),
        heure_debut: f.heure_debut,
        heure_fin: f.heure_fin,
        salle: f.salle || null,
      });
      onCree();
    } catch (err) { onErreur(err.message); } finally { setEnvoi(false); }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Ajouter un cours" taille="sm">
      <form onSubmit={soumettre} className="space-y-3">
        <div>
          <label className="etiquette">Matière *</label>
          <select className="champ" value={f.matiere_id} onChange={maj('matiere_id')} required>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}
          </select>
        </div>
        <div>
          <label className="etiquette">Enseignant</label>
          <select className="champ" value={f.enseignant_id} onChange={maj('enseignant_id')}>
            <option value="">Non assigné</option>
            {enseignants.map((e) => (
              <option key={e.id} value={e.id}>{e.prenom} {e.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiquette">Jour</label>
          <select className="champ" value={f.jour} onChange={maj('jour')}>
            {JOURS.map((j, i) => <option key={j} value={i + 1}>{j}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette">Début</label>
            <input type="time" className="champ" value={f.heure_debut} onChange={maj('heure_debut')} required />
          </div>
          <div>
            <label className="etiquette">Fin</label>
            <input type="time" className="champ" value={f.heure_fin} onChange={maj('heure_fin')} required />
          </div>
        </div>
        <div>
          <label className="etiquette">Salle</label>
          <input className="champ" value={f.salle} onChange={maj('salle')} placeholder="Salle 3" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </form>
    </Modale>
  );
}
