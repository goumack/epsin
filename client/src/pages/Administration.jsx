import { useEffect, useState, useCallback } from 'react';
import { Plus, BookOpen, Bus as BusIcon, Power, KeyRound } from 'lucide-react';
import { get, post, patch, put, dateFr } from '../lib/api';
import {
  Chargement, Vide, Modale, Puce, Onglets, Recherche, useToast,
} from '../components/ui';

// ============ Bibliothèque ============
export function Bibliotheque() {
  const [onglet, setOnglet] = useState('livres');
  return (
    <div className="animer space-y-4">
      <Onglets
        onglets={[
          { cle: 'livres', libelle: 'Catalogue' },
          { cle: 'emprunts', libelle: 'Emprunts' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'livres' && <Livres />}
      {onglet === 'emprunts' && <Emprunts />}
    </div>
  );
}

function Livres() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ titre: '', auteur: '', categorie: '', exemplaires: 1 });

  const charger = useCallback(() => {
    get(`/livres?recherche=${encodeURIComponent(recherche)}`).then(setListe).catch(() => setListe([]));
  }, [recherche]);

  useEffect(() => {
    const t = setTimeout(charger, recherche ? 300 : 0);
    return () => clearTimeout(t);
  }, [charger, recherche]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/livres', { ...f, exemplaires: Number(f.exemplaires) });
      setOuvert(false);
      setF({ titre: '', auteur: '', categorie: '', exemplaires: 1 });
      succes('Livre ajouté');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 sm:max-w-xs">
          <Recherche valeur={recherche} onChange={setRecherche} placeholder="Titre, auteur, ISBN…" />
        </div>
        <button onClick={() => setOuvert(true)} className="bouton-primaire sm:ml-auto">
          <Plus className="h-4 w-4" /> Ajouter un livre
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? (
          <Vide titre="Catalogue vide" texte="Ajoutez des ouvrages au catalogue." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Titre</th>
                  <th className="hidden sm:table-cell">Auteur</th>
                  <th className="hidden md:table-cell">Catégorie</th>
                  <th className="text-center">Disponibles</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((l) => (
                  <tr key={l.id}>
                    <td className="font-medium">{l.titre}</td>
                    <td className="hidden sm:table-cell text-slate-500">{l.auteur || '—'}</td>
                    <td className="hidden md:table-cell"><Puce>{l.categorie || 'Non classé'}</Puce></td>
                    <td className="text-center">
                      <Puce ton={l.disponibles > 0 ? 'succes' : 'danger'}>
                        {l.disponibles}/{l.exemplaires}
                      </Puce>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Ajouter un livre" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Titre *</label>
            <input className="champ" value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} required />
          </div>
          <div>
            <label className="etiquette">Auteur</label>
            <input className="champ" value={f.auteur} onChange={(e) => setF({ ...f, auteur: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Catégorie</label>
              <input className="champ" value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })} placeholder="Roman" />
            </div>
            <div>
              <label className="etiquette">Exemplaires</label>
              <input type="number" min="1" className="champ" value={f.exemplaires} onChange={(e) => setF({ ...f, exemplaires: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Ajouter</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

function Emprunts() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);

  const charger = useCallback(() => {
    get('/emprunts').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const retourner = async (id) => {
    try {
      await patch(`/emprunts/${id}/retour`);
      succes('Retour enregistré');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucun emprunt" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Livre</th>
                  <th>Élève</th>
                  <th className="hidden sm:table-cell">Emprunté le</th>
                  <th>Retour prévu</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.titre}</td>
                    <td>{e.prenom} {e.nom}</td>
                    <td className="hidden sm:table-cell text-slate-500">{dateFr(e.date_emprunt)}</td>
                    <td>
                      {e.date_retour_reel ? (
                        <Puce ton="succes">Rendu le {dateFr(e.date_retour_reel)}</Puce>
                      ) : e.en_retard ? (
                        <Puce ton="danger">En retard ({dateFr(e.date_retour_prevu)})</Puce>
                      ) : (
                        <Puce>{dateFr(e.date_retour_prevu)}</Puce>
                      )}
                    </td>
                    <td className="text-right">
                      {!e.date_retour_reel && (
                        <button onClick={() => retourner(e.id)} className="bouton-secondaire px-2.5 py-1.5 text-xs">
                          Retour
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

// ============ Transport ============
export function Transport() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ immatriculation: '', chauffeur: '', telephone: '', capacite: 30, itineraire: '' });

  const charger = useCallback(() => {
    get('/bus').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/bus', { ...f, capacite: Number(f.capacite) });
      setOuvert(false);
      setF({ immatriculation: '', chauffeur: '', telephone: '', capacite: 30, itineraire: '' });
      succes('Bus ajouté');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="animer space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Ajouter un bus
        </button>
      </div>

      {!liste ? <Chargement /> : liste.length === 0 ? (
        <div className="carte"><Vide titre="Aucun bus" texte="Ajoutez les véhicules de ramassage." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liste.map((b) => (
            <div key={b.id} className="carte p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="rounded-xl bg-marine-50 dark:bg-marine-950 p-2.5 text-marine-600 dark:text-marine-400">
                  <BusIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.immatriculation}</p>
                  <p className="truncate text-xs text-slate-500">{b.chauffeur || 'Chauffeur non assigné'}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm text-slate-500">
                {b.itineraire && <p className="truncate">{b.itineraire}</p>}
                {b.telephone && <p>{b.telephone}</p>}
              </div>
              <div className="mt-3">
                <Puce ton={b.inscrits >= b.capacite ? 'danger' : 'succes'}>
                  {b.inscrits}/{b.capacite} places
                </Puce>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Ajouter un bus" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Immatriculation *</label>
            <input className="champ" value={f.immatriculation} onChange={(e) => setF({ ...f, immatriculation: e.target.value })} placeholder="DK-1234-AB" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Chauffeur</label>
              <input className="champ" value={f.chauffeur} onChange={(e) => setF({ ...f, chauffeur: e.target.value })} />
            </div>
            <div>
              <label className="etiquette">Téléphone</label>
              <input className="champ" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Capacité</label>
              <input type="number" min="1" className="champ" value={f.capacite} onChange={(e) => setF({ ...f, capacite: e.target.value })} />
            </div>
            <div>
              <label className="etiquette">Itinéraire</label>
              <input className="champ" value={f.itineraire} onChange={(e) => setF({ ...f, itineraire: e.target.value })} placeholder="Yoff - École" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Ajouter</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

// ============ Utilisateurs ============
export function Utilisateurs() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ prenom: '', nom: '', email: '', telephone: '', role: 'enseignant', mot_de_passe: '', specialite: '' });

  const charger = useCallback(() => {
    get('/utilisateurs').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/utilisateurs', f);
      setOuvert(false);
      setF({ prenom: '', nom: '', email: '', telephone: '', role: 'enseignant', mot_de_passe: '', specialite: '' });
      succes('Compte créé');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  const basculer = async (u) => {
    try {
      await patch(`/utilisateurs/${u.id}/actif`);
      succes(u.actif ? 'Compte désactivé' : 'Compte activé');
      charger();
    } catch (e) { toastErreur(e.message); }
  };

  const reinitialiser = async (u) => {
    const mdp = window.prompt(`Nouveau mot de passe pour ${u.prenom} ${u.nom} (8 caractères minimum) :`);
    if (!mdp) return;
    try {
      await post(`/utilisateurs/${u.id}/reinitialiser`, { mot_de_passe: mdp });
      succes('Mot de passe réinitialisé');
    } catch (e) { toastErreur(e.message); }
  };

  return (
    <div className="animer space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Nouveau compte
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucun utilisateur" /> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th className="hidden sm:table-cell">Identifiant</th>
                  <th>Rôle</th>
                  <th className="hidden md:table-cell">Dernière connexion</th>
                  <th>État</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.prenom} {u.nom}</td>
                    <td className="hidden sm:table-cell text-slate-500">{u.email || u.telephone}</td>
                    <td><Puce ton={u.role === 'admin' ? 'info' : 'neutre'}>{u.role}</Puce></td>
                    <td className="hidden md:table-cell text-slate-500">
                      {u.derniere_connexion ? dateFr(u.derniere_connexion) : 'Jamais'}
                    </td>
                    <td>
                      {u.actif ? <Puce ton="succes">Actif</Puce> : <Puce ton="danger">Désactivé</Puce>}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => reinitialiser(u)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-marine-600 dark:hover:bg-slate-800"
                          aria-label="Réinitialiser le mot de passe"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => basculer(u)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                          aria-label={u.actif ? 'Désactiver' : 'Activer'}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouveau compte" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Prénom *</label>
              <input className="champ" value={f.prenom} onChange={(e) => setF({ ...f, prenom: e.target.value })} required />
            </div>
            <div>
              <label className="etiquette">Nom *</label>
              <input className="champ" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="etiquette">Rôle *</label>
            <select className="champ" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {['admin', 'censeur', 'comptable', 'enseignant', 'eleve', 'parent'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {f.role === 'enseignant' && (
            <div>
              <label className="etiquette">Spécialité</label>
              <input className="champ" value={f.specialite} onChange={(e) => setF({ ...f, specialite: e.target.value })} placeholder="Mathématiques" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Email</label>
              <input type="email" className="champ" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
            <div>
              <label className="etiquette">Téléphone</label>
              <input className="champ" value={f.telephone} onChange={(e) => setF({ ...f, telephone: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-slate-400">Renseignez au moins un email ou un téléphone.</p>
          <div>
            <label className="etiquette">Mot de passe *</label>
            <input type="text" className="champ" value={f.mot_de_passe} onChange={(e) => setF({ ...f, mot_de_passe: e.target.value })} minLength={8} required />
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

// ============ Paramètres ============
export function Parametres() {
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [onglet, setOnglet] = useState('etablissement');
  return (
    <div className="animer space-y-4">
      <Toast />
      <Onglets
        onglets={[
          { cle: 'etablissement', libelle: 'Établissement' },
          { cle: 'annees', libelle: 'Années scolaires' },
          { cle: 'audit', libelle: "Journal d'audit" },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'etablissement' && <Etablissement succes={succes} erreur={toastErreur} />}
      {onglet === 'annees' && <Annees succes={succes} erreur={toastErreur} />}
      {onglet === 'audit' && <Audit />}
    </div>
  );
}

function Etablissement({ succes, erreur }) {
  const [f, setF] = useState(null);

  useEffect(() => {
    get('/etablissement').then((d) => setF(d || {
      nom: '', sigle: '', adresse: '', telephone: '', email: '', devise: 'FCFA', bareme: 20,
    })).catch(() => {});
  }, []);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await put('/etablissement', f);
      succes('Paramètres enregistrés');
    } catch (err) { erreur(err.message); }
  };

  if (!f) return <Chargement />;

  const maj = (c) => (e) => setF({ ...f, [c]: e.target.value });

  return (
    <form onSubmit={soumettre} className="carte max-w-2xl space-y-3 p-5">
      <div>
        <label className="etiquette">Nom de l'établissement *</label>
        <input className="champ" value={f.nom || ''} onChange={maj('nom')} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiquette">Sigle</label>
          <input className="champ" value={f.sigle || ''} onChange={maj('sigle')} />
        </div>
        <div>
          <label className="etiquette">Téléphone</label>
          <input className="champ" value={f.telephone || ''} onChange={maj('telephone')} />
        </div>
        <div>
          <label className="etiquette">Email</label>
          <input type="email" className="champ" value={f.email || ''} onChange={maj('email')} />
        </div>
        <div>
          <label className="etiquette">Devise</label>
          <input className="champ" value={f.devise || 'FCFA'} onChange={maj('devise')} />
        </div>
      </div>
      <div>
        <label className="etiquette">Adresse</label>
        <input className="champ" value={f.adresse || ''} onChange={maj('adresse')} />
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" className="bouton-primaire">Enregistrer</button>
      </div>
    </form>
  );
}

function Annees({ succes, erreur }) {
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ libelle: '', date_debut: '', date_fin: '', nb_periodes: 3 });

  const charger = useCallback(() => {
    get('/scolarite/annees').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/scolarite/annees', { ...f, nb_periodes: Number(f.nb_periodes) });
      setOuvert(false);
      setF({ libelle: '', date_debut: '', date_fin: '', nb_periodes: 3 });
      succes('Année créée avec ses périodes');
      charger();
    } catch (err) { erreur(err.message); }
  };

  const activer = async (id) => {
    try {
      await patch(`/scolarite/annees/${id}/activer`);
      succes('Année activée');
      charger();
    } catch (e) { erreur(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Plus className="h-4 w-4" /> Nouvelle année
        </button>
      </div>

      <div className="carte overflow-hidden">
        {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Aucune année scolaire" /> : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Année</th>
                <th className="hidden sm:table-cell">Période</th>
                <th>État</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.libelle}</td>
                  <td className="hidden sm:table-cell text-slate-500">
                    {dateFr(a.date_debut)} — {dateFr(a.date_fin)}
                  </td>
                  <td>{a.active ? <Puce ton="succes">Active</Puce> : <Puce>Archivée</Puce>}</td>
                  <td className="text-right">
                    {!a.active && (
                      <button onClick={() => activer(a.id)} className="bouton-secondaire px-2.5 py-1.5 text-xs">
                        Activer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouvelle année scolaire" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Libellé *</label>
            <input className="champ" value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} placeholder="2026-2027" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiquette">Début *</label>
              <input type="date" className="champ" value={f.date_debut} onChange={(e) => setF({ ...f, date_debut: e.target.value })} required />
            </div>
            <div>
              <label className="etiquette">Fin *</label>
              <input type="date" className="champ" value={f.date_fin} onChange={(e) => setF({ ...f, date_fin: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="etiquette">Découpage</label>
            <select className="champ" value={f.nb_periodes} onChange={(e) => setF({ ...f, nb_periodes: e.target.value })}>
              <option value="3">3 trimestres</option>
              <option value="2">2 semestres</option>
            </select>
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

function Audit() {
  const [liste, setListe] = useState(null);
  useEffect(() => { get('/audit').then(setListe).catch(() => setListe([])); }, []);

  return (
    <div className="carte overflow-hidden">
      {!liste ? <Chargement /> : liste.length === 0 ? <Vide titre="Journal vide" /> : (
        <div className="overflow-x-auto">
          <table className="tableau">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Action</th>
                <th className="hidden sm:table-cell">Entité</th>
                <th className="hidden md:table-cell">Date</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((j) => (
                <tr key={j.id}>
                  <td className="font-medium">
                    {j.prenom ? `${j.prenom} ${j.nom}` : 'Système'}
                  </td>
                  <td><Puce>{j.action}</Puce></td>
                  <td className="hidden sm:table-cell text-slate-500">{j.entite || '—'}</td>
                  <td className="hidden md:table-cell text-slate-500">
                    {new Date(j.cree_le).toLocaleString('fr-FR')}
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
