import { useEffect, useState, useCallback } from 'react';
import { Plus, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { get, post, dateFr } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import DossierEleve from '../components/DossierEleve';
import FicheAcces from '../components/FicheAcces';
import {
  Chargement, Erreur, Vide, Recherche, Modale, Puce, useToast,
} from '../components/ui';

export default function Eleves() {
  const { aRole } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();

  const [liste, setListe] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [classeId, setClasseId] = useState('');
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState([]);
  const [erreur, setErreur] = useState('');
  const [formOuvert, setFormOuvert] = useState(false);
  const [fiche, setFiche] = useState(null);
  // Eleve tout juste inscrit : sa fiche d acces parent est a remettre
  const [nouvelInscrit, setNouvelInscrit] = useState(null);

  const TAILLE = 20;

  const charger = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, taille: TAILLE });
      if (recherche.trim()) params.set('recherche', recherche.trim());
      if (classeId) params.set('classe_id', classeId);
      setListe(await get(`/eleves?${params}`));
    } catch (e) {
      setErreur(e.message);
    }
  }, [page, recherche, classeId]);

  useEffect(() => {
    get('/scolarite/classes').then(setClasses).catch(() => {});
  }, []);

  // Recherche differee pour ne pas appeler l API a chaque frappe
  useEffect(() => {
    const t = setTimeout(charger, recherche ? 350 : 0);
    return () => clearTimeout(t);
  }, [charger, recherche]);

  // Toute modification de filtre ramene a la premiere page
  useEffect(() => { setPage(1); }, [recherche, classeId]);

  const pages = liste ? Math.max(Math.ceil(liste.total / TAILLE), 1) : 1;

  return (
    <div className="animer space-y-4">
      <Toast />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 sm:max-w-xs">
          <Recherche
            valeur={recherche}
            onChange={setRecherche}
            placeholder="Nom, prénom ou matricule…"
          />
        </div>
        <select
          className="champ sm:w-52"
          value={classeId}
          onChange={(e) => setClasseId(e.target.value)}
        >
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.libelle}</option>
          ))}
        </select>
        {aRole('admin', 'censeur', 'directeur', 'proviseur') && (
          <button onClick={() => setFormOuvert(true)} className="bouton-primaire sm:ml-auto">
            <Plus className="h-4 w-4" />
            Nouvel élève
          </button>
        )}
      </div>

      <Erreur message={erreur} />

      <div className="carte overflow-hidden">
        {!liste ? (
          <Chargement />
        ) : liste.donnees.length === 0 ? (
          <Vide
            titre="Aucun élève trouvé"
            texte={recherche || classeId ? 'Essayez de modifier les filtres.' : "Commencez par inscrire un élève."}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Matricule</th>
                    <th>Nom complet</th>
                    <th className="hidden sm:table-cell">Classe</th>
                    <th className="hidden md:table-cell">Sexe</th>
                    <th className="hidden lg:table-cell">Naissance</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.donnees.map((e) => (
                    <tr key={e.id}>
                      <td className="font-mono text-xs text-slate-500">{e.matricule}</td>
                      <td>
                        <span className="font-medium">{e.prenom} {e.nom}</span>
                        <span className="block text-xs text-slate-400 sm:hidden">{e.classe || '—'}</span>
                      </td>
                      <td className="hidden sm:table-cell">
                        {e.classe ? <Puce ton="info">{e.classe}</Puce> : <span className="text-slate-400">Non affecté</span>}
                      </td>
                      <td className="hidden md:table-cell">{e.sexe === 'F' ? 'Fille' : e.sexe === 'M' ? 'Garçon' : '—'}</td>
                      <td className="hidden lg:table-cell text-slate-500">{dateFr(e.date_naissance)}</td>
                      <td className="text-right">
                        <button
                          onClick={() => setFiche(e.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-marine-600 dark:hover:bg-slate-800"
                          aria-label="Voir la fiche"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 px-4 py-3">
              <p className="text-sm text-slate-500">
                {liste.total} élève{liste.total > 1 ? 's' : ''} · page {page}/{pages}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  className="bouton-secondaire px-2 py-1.5"
                  aria-label="Page précédente"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(p + 1, pages))}
                  disabled={page >= pages}
                  className="bouton-secondaire px-2 py-1.5"
                  aria-label="Page suivante"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <FormulaireEleve
        ouvert={formOuvert}
        classes={classes}
        onFermer={() => setFormOuvert(false)}
        onCree={(eleve) => {
          setFormOuvert(false);
          succes('Élève inscrit, compte parent créé');
          setNouvelInscrit(eleve);
          charger();
        }}
        onErreur={toastErreur}
      />

      <DossierEleve eleveId={fiche} onFermer={() => setFiche(null)} />

      <FicheAcces
        eleve={nouvelInscrit}
        compte={nouvelInscrit?.compte_parent}
        onFermer={() => setNouvelInscrit(null)}
      />
    </div>
  );
}

/** Formulaire d inscription avec tuteur principal. */
function FormulaireEleve({ ouvert, classes, onFermer, onCree, onErreur }) {
  const vide = {
    prenom: '', nom: '', sexe: 'M', date_naissance: '', lieu_naissance: '',
    nationalite: 'Sénégalaise', adresse: '', classe_id: '',
    tuteur_prenom: '', tuteur_nom: '', tuteur_telephone: '', tuteur_lien: 'père',
  };
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (ouvert) setF(vide); }, [ouvert]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      const tuteurs = f.tuteur_nom && f.tuteur_telephone
        ? [{
            prenom: f.tuteur_prenom || f.tuteur_nom,
            nom: f.tuteur_nom,
            telephone: f.tuteur_telephone,
            lien: f.tuteur_lien,
            principal: true,
          }]
        : [];
      const cree = await post('/eleves', {
        prenom: f.prenom,
        nom: f.nom,
        sexe: f.sexe,
        date_naissance: f.date_naissance || null,
        lieu_naissance: f.lieu_naissance || null,
        nationalite: f.nationalite || null,
        adresse: f.adresse || null,
        classe_id: f.classe_id ? Number(f.classe_id) : null,
        tuteurs,
      });
      onCree(cree);
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Inscrire un élève">
      <form onSubmit={soumettre} className="space-y-5">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-500">Identité de l'élève</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiquette">Prénom *</label>
              <input className="champ" value={f.prenom} onChange={maj('prenom')} required />
            </div>
            <div>
              <label className="etiquette">Nom *</label>
              <input className="champ" value={f.nom} onChange={maj('nom')} required />
            </div>
            <div>
              <label className="etiquette">Sexe</label>
              <select className="champ" value={f.sexe} onChange={maj('sexe')}>
                <option value="M">Garçon</option>
                <option value="F">Fille</option>
              </select>
            </div>
            <div>
              <label className="etiquette">Date de naissance</label>
              <input type="date" className="champ" value={f.date_naissance} onChange={maj('date_naissance')} />
            </div>
            <div>
              <label className="etiquette">Lieu de naissance</label>
              <input className="champ" value={f.lieu_naissance} onChange={maj('lieu_naissance')} />
            </div>
            <div>
              <label className="etiquette">Nationalité</label>
              <input className="champ" value={f.nationalite} onChange={maj('nationalite')} />
            </div>
            <div className="sm:col-span-2">
              <label className="etiquette">Adresse</label>
              <input className="champ" value={f.adresse} onChange={maj('adresse')} />
            </div>
            <div className="sm:col-span-2">
              <label className="etiquette">Classe</label>
              <select className="champ" value={f.classe_id} onChange={maj('classe_id')}>
                <option value="">À affecter plus tard</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.libelle} ({c.effectif}/{c.capacite})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-500">Tuteur principal</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiquette">Prénom</label>
              <input className="champ" value={f.tuteur_prenom} onChange={maj('tuteur_prenom')} />
            </div>
            <div>
              <label className="etiquette">Nom</label>
              <input className="champ" value={f.tuteur_nom} onChange={maj('tuteur_nom')} />
            </div>
            <div>
              <label className="etiquette">Téléphone</label>
              <input className="champ" value={f.tuteur_telephone} onChange={maj('tuteur_telephone')} placeholder="+221 77 000 00 00" />
            </div>
            <div>
              <label className="etiquette">Lien</label>
              <select className="champ" value={f.tuteur_lien} onChange={maj('tuteur_lien')}>
                <option value="père">Père</option>
                <option value="mère">Mère</option>
                <option value="tuteur">Tuteur</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-4">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Enregistrement…' : 'Inscrire'}
          </button>
        </div>
      </form>
    </Modale>
  );
}
