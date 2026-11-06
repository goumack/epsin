import { useEffect, useState } from 'react';
import { get, post, patch, put, supprimer } from '../lib/api';
import { Modale } from './ui';

/**
 * Modifier un enseignant : sa fiche (nom, specialite, telephone) et ses
 * classes. Au moyen/secondaire, une affectation par classe et par matiere ;
 * a l elementaire, le maitre titulaire de la classe (tous les domaines).
 */
export default function GestionEnseignant({ enseignant: e, direction, onFermer, onChange, onSucces, onErreur }) {
  const [fiche, setFiche] = useState(null);
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [programme, setProgramme] = useState([]);   // matieres de la classe choisie
  const [matiereId, setMatiereId] = useState('');
  const [enCours, setEnCours] = useState(false);
  const maitre = e?.entite === 'scolaire';

  const chargerClasses = () => get('/scolarite/classes')
    .then((l) => setClasses(l.filter((c) => !e?.entite || c.entite === e.entite)))
    .catch(() => setClasses([]));

  useEffect(() => {
    if (!e) return;
    setFiche({ prenom: e.prenom || '', nom: e.nom || '', specialite: e.specialite || '', telephone: e.telephone || '' });
    setClasseId('');
    chargerClasses();
  }, [e?.id]);

  useEffect(() => {
    setMatiereId('');
    setProgramme([]);
    if (!classeId || maitre) return;
    get(`/scolarite/classes/${classeId}/enseignants`).then(setProgramme).catch(() => setProgramme([]));
  }, [classeId, maitre]);

  const agir = async (action, message) => {
    setEnCours(true);
    try {
      await action();
      onSucces(message);
      onChange();
      chargerClasses();
      return true;
    } catch (err) {
      onErreur(err.message);
      return false;
    } finally {
      setEnCours(false);
    }
  };

  if (!e || !fiche) return null;
  const maj = (champ) => (ev) => setFiche((v) => ({ ...v, [champ]: ev.target.value }));
  const choisie = programme.find((m) => String(m.matiere_id) === matiereId);
  const classeChoisie = classes.find((c) => String(c.id) === classeId);

  const affecter = async () => {
    if (maitre) {
      // A l elementaire, le professeur principal est le maitre titulaire
      if (classeChoisie?.prof_principal_id && classeChoisie.prof_principal_id !== e.utilisateur_id
          && !window.confirm(`${classeChoisie.libelle} a déjà un maître (${classeChoisie.pp_prenom || ''} ${classeChoisie.pp_nom || ''}). Le remplacer ?`)) return;
      if (await agir(() => put(`/scolarite/classes/${classeId}/maitre`, { enseignant_id: e.id }),
        `${e.prenom} ${e.nom} est maître du ${classeChoisie?.libelle}`)) setClasseId('');
      return;
    }
    if (choisie?.enseignant_id && choisie.enseignant_id !== e.id
        && !window.confirm(`${choisie.matiere} en ${classeChoisie?.libelle} est assurée par ${choisie.prenom} ${choisie.nom}. Le remplacer ?`)) return;
    if (await agir(() => post('/scolarite/affectations', {
      enseignant_id: e.id, classe_id: Number(classeId), matiere_id: Number(matiereId),
    }), `${choisie?.matiere} en ${classeChoisie?.libelle} confiée à ${e.prenom} ${e.nom}`)) {
      setMatiereId('');
      get(`/scolarite/classes/${classeId}/enseignants`).then(setProgramme).catch(() => {});
    }
  };

  return (
    <Modale ouverte={!!e} onFermer={onFermer} titre={`${e.prenom} ${e.nom}`} taille="md">
      <div className="space-y-5">
        {direction && (
          <form className="space-y-3" onSubmit={(ev) => {
            ev.preventDefault();
            agir(() => patch(`/scolarite/enseignants/${e.id}`, fiche), 'Fiche enregistrée');
          }}>
            <h3 className="text-sm font-semibold">Fiche</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="etiquette" htmlFor="ge-prenom">Prénom *</label>
                <input id="ge-prenom" className="champ" required value={fiche.prenom} onChange={maj('prenom')} />
              </div>
              <div>
                <label className="etiquette" htmlFor="ge-nom">Nom *</label>
                <input id="ge-nom" className="champ" required value={fiche.nom} onChange={maj('nom')} />
              </div>
              <div>
                <label className="etiquette" htmlFor="ge-spe">Spécialité</label>
                <input id="ge-spe" className="champ" value={fiche.specialite} onChange={maj('specialite')} />
              </div>
              <div>
                <label className="etiquette" htmlFor="ge-tel">Téléphone</label>
                <input id="ge-tel" className="champ" inputMode="tel" value={fiche.telephone} onChange={maj('telephone')} />
              </div>
            </div>
            <p className="text-xs text-slate-500">Identifiant de connexion : {e.email || e.telephone}</p>
            <div className="flex justify-end">
              <button type="submit" className="bouton-secondaire" disabled={enCours}>Enregistrer la fiche</button>
            </div>
          </form>
        )}

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold">{maitre ? 'Classe dont il est le maître' : 'Classes et matières'}</h3>
          {maitre ? (
            e.classes_maitre?.length ? e.classes_maitre.map((c) => (
              <div key={c.classe_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <span>Maître du {c.classe}</span>
                <button type="button" className="text-xs text-slate-500 underline" disabled={enCours}
                        onClick={() => window.confirm(`Retirer ${e.prenom} ${e.nom} du ${c.classe} ?`)
                          && agir(() => put(`/scolarite/classes/${c.classe_id}/maitre`, { enseignant_id: null }), 'Maître retiré')}>
                  Retirer
                </button>
              </div>
            )) : <p className="text-sm text-slate-400">Aucune classe</p>
          ) : (
            e.affectations?.length ? (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {e.affectations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{a.classe} · {a.matiere}</span>
                    <button type="button" className="text-xs text-slate-500 underline" disabled={enCours}
                            onClick={() => window.confirm(`Retirer ${a.matiere} en ${a.classe} à ${e.prenom} ${e.nom} ?`)
                              && agir(() => supprimer(`/scolarite/affectations/${a.id}`), 'Affectation retirée')}>
                      Retirer
                    </button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400">Aucune classe</p>
          )}

          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              {maitre ? "Le désigner maître d'une classe" : 'Ajouter une classe'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select className="champ" aria-label="Classe" value={classeId} onChange={(ev) => setClasseId(ev.target.value)}>
                <option value="">Classe…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
              {!maitre && (
                <select className="champ" aria-label="Matière" value={matiereId} disabled={!classeId}
                        onChange={(ev) => setMatiereId(ev.target.value)}>
                  <option value="">{classeId && !programme.length ? 'Aucune matière au programme' : 'Matière…'}</option>
                  {programme.map((m) => (
                    <option key={m.matiere_id} value={m.matiere_id}>
                      {m.matiere}{m.nom ? ` (actuellement ${m.prenom} ${m.nom})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="bouton-primaire shrink-0"
                      disabled={enCours || !classeId || (!maitre && !matiereId)} onClick={affecter}>
                Affecter
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" className="bouton-secondaire" onClick={onFermer}>Fermer</button>
        </div>
      </div>
    </Modale>
  );
}
