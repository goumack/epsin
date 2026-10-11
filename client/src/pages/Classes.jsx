import { useEffect, useState, useCallback } from 'react';
import { Plus, Users, MapPin, Pencil, Trash2 } from 'lucide-react';
import { get, post, patch, supprimer } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Chargement, Vide, Modale, Puce, Onglets, useToast,
} from '../components/ui';
import DossierClasse from '../components/DossierClasse';
import FicheAcces from '../components/FicheAcces';
import FinAnnee from './FinAnnee';

export default function Classes() {
  const { aRole } = useAuth();
  const [onglet, setOnglet] = useState('classes');

  // La fin d annee engage le parcours des eleves : reserve a la direction
  const clotureAnnee = aRole('admin', 'censeur', 'directeur', 'proviseur');

  return (
    <div className="animer space-y-4">
      <Onglets
        onglets={[
          { cle: 'classes', libelle: 'Classes' },
          { cle: 'matieres', libelle: 'Matières' },
          { cle: 'enseignants', libelle: 'Enseignants' },
          ...(clotureAnnee ? [{ cle: 'fin-annee', libelle: "Fin d'année" }] : []),
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'classes' && <ListeClasses />}
      {onglet === 'matieres' && <Matieres />}
      {onglet === 'enseignants' && <Enseignants />}
      {onglet === 'fin-annee' && clotureAnnee && <FinAnnee />}
    </div>
  );
}

/** Libelles des deux entites de l etablissement. */
const ENTITES = [
  { cle: 'scolaire', libelle: 'Scolaire' },
  { cle: 'secondaire', libelle: 'Moyen et secondaire' },
];

function ListeClasses() {
  const { aRole } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [classes, setClasses] = useState(null);
  const [niveaux, setNiveaux] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [dossier, setDossier] = useState(null);   // classe dont le dossier est ouvert
  const [entite, setEntite] = useState(null);     // onglet d entite affiche
  const [f, setF] = useState({ niveau_id: '', libelle: '', capacite: 45, salle: '' });

  const charger = useCallback(() => {
    get('/scolarite/classes').then(setClasses).catch(() => setClasses([]));
  }, []);

  useEffect(() => {
    charger();
    get('/scolarite/niveaux').then((n) => {
      setNiveaux(n);
      if (n[0]) setF((v) => ({ ...v, niveau_id: String(n[0].id) }));
    }).catch(() => {});
  }, [charger]);

  // Repartition des classes entre les deux entites
  const groupes = ENTITES.map((e) => ({
    ...e,
    classes: (classes || []).filter((c) => c.entite === e.cle),
  }));
  const groupesRemplis = groupes.filter((g) => g.classes.length > 0);

  // Cle stable des entites disponibles : evite de relancer l effet
  // a chaque rendu (groupesRemplis est un tableau recree a chaque fois).
  const clesDisponibles = groupesRemplis.map((g) => g.cle).join(',');

  // Selectionne le premier onglet non vide. Un directeur ne voit que
  // « Scolaire », un principal que « Moyen et secondaire » : dans ce cas
  // la barre d onglets est inutile et reste masquee.
  useEffect(() => {
    if (!clesDisponibles) return;
    const dispo = clesDisponibles.split(',');
    setEntite((actuelle) => (dispo.includes(actuelle) ? actuelle : dispo[0]));
  }, [clesDisponibles]);

  const affichees = groupes.find((g) => g.cle === entite)?.classes ?? [];

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/scolarite/classes', {
        ...f, niveau_id: Number(f.niveau_id), capacite: Number(f.capacite),
      });
      setOuvert(false);
      setF((v) => ({ ...v, libelle: '', salle: '' }));
      succes('Classe créée');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      {aRole('admin', 'censeur', 'directeur', 'proviseur', 'comptable') && (
        <div className="flex justify-end">
          <button onClick={() => setOuvert(true)} className="bouton-primaire">
            <Plus className="h-4 w-4" /> Nouvelle classe
          </button>
        </div>
      )}

      {/* Onglets d entite : masques si une seule entite est accessible */}
      {groupesRemplis.length > 1 && (
        <Onglets
          onglets={groupesRemplis.map((g) => ({
            cle: g.cle,
            libelle: `${g.libelle} · ${g.classes.length}`,
          }))}
          actif={entite}
          onChange={setEntite}
        />
      )}

      {!classes ? <Chargement /> : classes.length === 0 ? (
        <div className="carte"><Vide titre="Aucune classe" texte="Créez votre première classe." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {affichees.map((c) => {
            const taux = c.capacite ? (c.effectif / c.capacite) * 100 : 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDossier(c.id)}
                className="carte p-5 text-left transition-transform hover:-translate-y-0.5
                           focus:outline-none focus:ring-2 focus:ring-marine-500 focus:ring-offset-2
                           dark:focus:ring-offset-slate-950"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{c.libelle}</h3>
                    <p className="text-xs text-slate-500">{c.niveau} · {c.cycle}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Puce ton={taux >= 95 ? 'danger' : taux >= 80 ? 'alerte' : 'succes'}>
                      {c.effectif}/{c.capacite}
                    </Puce>
                    {/* Niveau sanctionne par un examen national */}
                    {c.examen && <Puce ton="info">{c.examen}</Puce>}
                  </div>
                </div>

                <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      taux >= 95 ? 'bg-red-500' : taux >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(taux, 100)}%` }}
                  />
                </div>

                <div className="space-y-1 text-sm text-slate-500">
                  <p className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {c.pp_nom ? `${c.pp_prenom} ${c.pp_nom}` : 'Pas de professeur principal'}
                  </p>
                  {c.salle && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {c.salle}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DossierClasse classeId={dossier} onFermer={() => setDossier(null)} />

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouvelle classe" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Niveau *</label>
            <select className="champ" value={f.niveau_id} onChange={(e) => setF({ ...f, niveau_id: e.target.value })} required>
              {niveaux.map((n) => <option key={n.id} value={n.id}>{n.libelle}</option>)}
            </select>
          </div>
          <div>
            <label className="etiquette">Libellé *</label>
            <input className="champ" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} placeholder="6ème A" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Capacité</label>
              <input type="number" min="1" className="champ" value={f.capacite} onChange={(e) => setF({ ...f, capacite: e.target.value })} />
            </div>
            <div>
              <label className="etiquette">Salle</label>
              <input className="champ" value={f.salle} onChange={(e) => setF({ ...f, salle: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Créer</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

function Matieres() {
  const { aRole } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [niveaux, setNiveaux] = useState([]);
  const [edition, setEdition] = useState(null);   // matiere en cours d edition
  const [creation, setCreation] = useState(false);

  // Le coefficient est fixe par le programme et engage toutes les classes
  // du niveau : seule la direction y touche.
  const peutEditer = aRole('admin', 'directeur', 'proviseur');

  const charger = useCallback(() => {
    get('/scolarite/matieres').then(setListe).catch(() => setListe([]));
  }, []);

  useEffect(() => {
    charger();
    get('/scolarite/niveaux').then(setNiveaux).catch(() => {});
  }, [charger]);

  const retirer = async (m) => {
    // La suppression est definitive : le serveur la refuse deja si des
    // evaluations existent, mais on confirme quand meme cote client.
    if (!window.confirm(`Supprimer définitivement la matière « ${m.libelle} » ?`)) return;
    try {
      await supprimer(`/scolarite/matieres/${m.id}`);
      succes('Matière supprimée');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  /** Coefficients lisibles : « 4 » si identique partout, sinon « CI 5 · CP 4 ». */
  const resumeCoef = (m) => {
    const coefs = m.coefficients || [];
    if (!coefs.length) return '—';
    const valeurs = [...new Set(coefs.map((c) => Number(c.coefficient)))];
    if (valeurs.length === 1) return valeurs[0];
    return coefs
      .map((c) => `${niveaux.find((n) => n.id === c.niveau_id)?.libelle ?? '?'} ${Number(c.coefficient)}`)
      .join(' · ');
  };

  return (
    <div className="space-y-3">
      <Toast />

      {peutEditer && (
        <div className="flex justify-end">
          <button onClick={() => setCreation(true)} className="bouton-primaire">
            <Plus className="h-4 w-4" /> Nouvelle matière
          </button>
        </div>
      )}

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucune matière" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th className="hidden sm:table-cell">Code</th>
                  <th className="text-center">Coefficient</th>
                  {peutEditer && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {liste.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: m.couleur }} />
                        <span className="font-medium">{m.libelle}</span>
                      </span>
                    </td>
                    <td className="hidden sm:table-cell font-mono text-xs text-slate-500">{m.code || '—'}</td>
                    <td className="text-center tabular-nums text-sm">{resumeCoef(m)}</td>
                    {peutEditer && (
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEdition(m)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-marine-600 dark:hover:bg-slate-800"
                            aria-label="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => retirer(m)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                            aria-label="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormulaireMatiere
        matiere={edition}
        ouvert={creation || Boolean(edition)}
        niveaux={niveaux}
        onFermer={() => { setEdition(null); setCreation(false); }}
        onEnregistre={(msg) => {
          setEdition(null); setCreation(false); succes(msg); charger();
        }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Creation ou modification d une matiere, avec ses coefficients par niveau. */
function FormulaireMatiere({ matiere, ouvert, niveaux, onFermer, onEnregistre, onErreur }) {
  const [f, setF] = useState({ libelle: '', code: '', couleur: '#3b82f6' });
  const [coefs, setCoefs] = useState({});      // niveau_id -> coefficient
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    if (matiere) {
      setF({ libelle: matiere.libelle, code: matiere.code || '', couleur: matiere.couleur || '#3b82f6' });
      setCoefs(Object.fromEntries(
        (matiere.coefficients || []).map((c) => [c.niveau_id, Number(c.coefficient)])
      ));
    } else {
      setF({ libelle: '', code: '', couleur: '#3b82f6' });
      setCoefs({});
    }
  }, [ouvert, matiere]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const coefficients = Object.entries(coefs)
        .filter(([, v]) => v !== '' && v != null)
        .map(([niveau_id, coefficient]) => ({
          niveau_id: Number(niveau_id), coefficient: Number(coefficient),
        }));
      if (matiere) {
        await patch(`/scolarite/matieres/${matiere.id}`, { ...f, coefficients });
        onEnregistre('Matière modifiée');
      } else {
        await post('/scolarite/matieres', { ...f, coefficients });
        onEnregistre('Matière créée');
      }
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale
      ouverte={ouvert}
      onFermer={onFermer}
      titre={matiere ? 'Modifier la matière' : 'Nouvelle matière'}
      taille="sm"
    >
      <form onSubmit={soumettre} className="space-y-3">
        <div>
          <label className="etiquette">Libellé *</label>
          <input className="champ" value={f.libelle} onChange={maj('libelle')} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiquette">Code</label>
            <input className="champ" value={f.code} onChange={maj('code')} placeholder="MATH" />
          </div>
          <div>
            <label className="etiquette">Couleur</label>
            <input type="color" className="champ h-10 p-1" value={f.couleur} onChange={maj('couleur')} />
          </div>
        </div>

        <div>
          <label className="etiquette">Coefficient par niveau</label>
          <p className="mb-2 text-xs text-slate-500">
            Laissez vide un niveau où la matière n'est pas enseignée.
          </p>
          <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
            {niveaux.map((n) => (
              <div key={n.id} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm text-slate-500">{n.libelle}</span>
                <input
                  type="number" min="0" step="0.5" className="champ"
                  value={coefs[n.id] ?? ''}
                  onChange={(e) => setCoefs((v) => ({ ...v, [n.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

function Enseignants() {
  const { aRole, utilisateur } = useAuth();
  const { Toast, succes, erreur } = useToast();
  const [liste, setListe] = useState(null);
  const [formOuvert, setFormOuvert] = useState(false);
  // Fiche d acces a remettre : { personne, compte }
  const [fiche, setFiche] = useState(null);
  // La direction cree et gere les comptes de ses enseignants
  const direction = aRole('admin', 'directeur', 'proviseur');

  const charger = useCallback(() => {
    get('/scolarite/enseignants').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const nouvelleFiche = async (e) => {
    if (!window.confirm(`Générer une nouvelle fiche d'accès pour ${e.prenom} ${e.nom} ? `
      + 'Son mot de passe actuel cessera de fonctionner.')) return;
    try {
      const compte = await post(`/scolarite/enseignants/${e.id}/acces`, {});
      setFiche({ personne: e, compte });
    } catch (err) { erreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      {direction && (
        <div className="flex justify-end">
          <button type="button" className="bouton-primaire" onClick={() => setFormOuvert(true)}>
            <Plus className="h-4 w-4" /> Ajouter un enseignant
          </button>
        </div>
      )}

      {!liste ? <Chargement /> : liste.length === 0 ? (
        <div className="carte">
          <Vide titre="Aucun enseignant"
                texte={direction ? 'Ajoutez vos maîtres et professeurs, puis affectez-les dans le dossier de chaque classe.' : undefined} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liste.map((e) => (
            <div key={e.id} className="carte p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 font-semibold text-marine-700 dark:text-marine-300">
                  {e.prenom?.[0]}{e.nom?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.prenom} {e.nom}</p>
                  <p className="truncate text-xs text-slate-500">{e.specialite || 'Non précisé'}</p>
                  <p className="truncate text-xs text-slate-400">{e.email || e.telephone}</p>
                </div>
              </div>
              {e.affectations?.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {e.affectations.slice(0, 4).map((a, i) => (
                    <Puce key={i}>{a.classe} · {a.matiere}</Puce>
                  ))}
                  {e.affectations.length > 4 && (
                    <Puce ton="info">+{e.affectations.length - 4}</Puce>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Aucune classe : affectez-le depuis le dossier d'une classe (onglet Équipe pédagogique).
                </p>
              )}
              {direction && (
                <button type="button" onClick={() => nouvelleFiche(e)}
                        className="mt-3 text-xs text-slate-500 underline">
                  Nouvelle fiche d'accès
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <FormulaireEnseignant
        ouvert={formOuvert}
        // Seul l administrateur choisit l entite : les autres creent dans la leur
        choixEntite={utilisateur?.role === 'admin'}
        onFermer={() => setFormOuvert(false)}
        onCree={(e) => {
          setFormOuvert(false);
          succes(`${e.prenom} ${e.nom} ajouté`);
          setFiche({ personne: e, compte: e.compte });
          charger();
        }}
        onErreur={erreur}
      />
      <FicheAcces
        destinataire="enseignant"
        eleve={fiche?.personne}
        compte={fiche?.compte}
        onFermer={() => setFiche(null)}
      />
    </div>
  );
}

function FormulaireEnseignant({ ouvert, choixEntite, onFermer, onCree, onErreur }) {
  const vide = { prenom: '', nom: '', telephone: '', email: '', specialite: '', entite: 'scolaire' };
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (ouvert) setF(vide); }, [ouvert]);
  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      onCree(await post('/scolarite/enseignants', {
        ...f,
        entite: choixEntite ? f.entite : undefined,
      }));
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Ajouter un enseignant" taille="sm">
      <form onSubmit={soumettre} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiquette" htmlFor="ens-prenom">Prénom *</label>
            <input id="ens-prenom" className="champ" required autoFocus value={f.prenom} onChange={maj('prenom')} />
          </div>
          <div>
            <label className="etiquette" htmlFor="ens-nom">Nom *</label>
            <input id="ens-nom" className="champ" required value={f.nom} onChange={maj('nom')} />
          </div>
        </div>
        <div>
          <label className="etiquette" htmlFor="ens-tel">Téléphone</label>
          <input id="ens-tel" className="champ" inputMode="tel" placeholder="77 123 45 67"
                 value={f.telephone} onChange={maj('telephone')} />
        </div>
        <div>
          <label className="etiquette" htmlFor="ens-email">Email</label>
          <input id="ens-email" className="champ" type="email" placeholder="prenom.nom@epsin.sn"
                 value={f.email} onChange={maj('email')} />
          <p className="mt-1 text-xs text-slate-500">
            Téléphone ou email : l'un des deux sert d'identifiant de connexion (l'email s'il est renseigné).
          </p>
        </div>
        <div>
          <label className="etiquette" htmlFor="ens-specialite">Spécialité</label>
          <input id="ens-specialite" className="champ" placeholder="Mathématiques, Maître polyvalent…"
                 value={f.specialite} onChange={maj('specialite')} />
        </div>
        {choixEntite && (
          <div>
            <label className="etiquette" htmlFor="ens-entite">Entité *</label>
            <select id="ens-entite" className="champ" value={f.entite} onChange={maj('entite')}>
              <option value="scolaire">Scolaire (élémentaire) — maître</option>
              <option value="secondaire">Moyen et secondaire — professeur</option>
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <button type="button" className="bouton-secondaire" onClick={onFermer}>Annuler</button>
          <button type="submit" className="bouton-primaire"
                  disabled={envoi || (!f.telephone.trim() && !f.email.trim())}>
            {envoi ? 'Création…' : 'Créer le compte'}
          </button>
        </div>
      </form>
    </Modale>
  );
}
