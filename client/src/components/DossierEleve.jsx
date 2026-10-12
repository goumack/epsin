import { useEffect, useState, useCallback } from 'react';
import {
  User, ClipboardList, CalendarX, Wallet, Printer, ShieldAlert, Clock, KeyRound,
} from 'lucide-react';
import { get, post, fcfa, dateFr, couleurNote } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Chargement, Erreur, Vide, Modale, Puce, Onglets } from './ui';
import BulletinOfficiel from './BulletinOfficiel';
import ParcoursEleve from './ParcoursEleve';
import FicheAcces from './FicheAcces';
import { FormulairePaiement, BandeauRecu } from '../pages/Finances';

/**
 * Dossier complet d un eleve : identite, bulletin, detail des notes,
 * assiduite et situation financiere. Ouvert depuis la liste des eleves.
 */
export default function DossierEleve({ eleveId, onFermer }) {
  const { aRole } = useAuth();
  const [onglet, setOnglet] = useState('infos');
  const [eleve, setEleve] = useState(null);
  const [periodes, setPeriodes] = useState([]);
  const [periodeId, setPeriodeId] = useState('');
  const [erreur, setErreur] = useState('');

  const voitFinances = aRole('admin', 'comptable', 'censeur', 'directeur', 'proviseur');

  // Rechargement complet a chaque changement d eleve
  useEffect(() => {
    if (!eleveId) { setEleve(null); setOnglet('infos'); return; }
    setErreur('');
    setEleve(null);
    get(`/eleves/${eleveId}`).then(setEleve).catch((e) => setErreur(e.message));
  }, [eleveId]);

  // Apres une affectation : relit le dossier sans vider l ecran
  const recharger = () => get(`/eleves/${eleveId}`).then(setEleve).catch(() => {});

  useEffect(() => {
    get('/scolarite/periodes').then((p) => {
      setPeriodes(p);
      if (p[0]) setPeriodeId(String(p[0].id));
    }).catch(() => {});
  }, []);

  const onglets = [
    { cle: 'infos', libelle: 'Informations' },
    { cle: 'parcours', libelle: 'Parcours' },
    { cle: 'bulletin', libelle: 'Bulletin' },
    { cle: 'notes', libelle: 'Notes' },
    { cle: 'assiduite', libelle: 'Assiduité' },
    ...(voitFinances ? [{ cle: 'finances', libelle: 'Finances' }] : []),
  ];

  return (
    <Modale
      ouverte={!!eleveId}
      onFermer={onFermer}
      titre="Dossier de l'élève"
      taille="xl"
    >
      <Erreur message={erreur} />
      {!eleve ? <Chargement /> : (
        <div className="space-y-4">
          <EnTete eleve={eleve} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center print:hidden">
            <div className="flex-1 overflow-x-auto">
              <Onglets onglets={onglets} actif={onglet} onChange={setOnglet} />
            </div>
            {['bulletin', 'notes'].includes(onglet) && periodes.length > 0 && (
              <select
                className="champ sm:w-44"
                value={periodeId}
                onChange={(e) => setPeriodeId(e.target.value)}
              >
                {periodes.map((p) => (
                  <option key={p.id} value={p.id}>{p.libelle}</option>
                ))}
              </select>
            )}
          </div>

          {onglet === 'infos' && <Informations eleve={eleve} onChange={recharger} />}
          {onglet === 'parcours' && <ParcoursEleve eleveId={eleveId} />}
          {onglet === 'bulletin' && <Bulletin eleveId={eleveId} periodeId={periodeId} />}
          {onglet === 'notes' && <DetailNotes eleveId={eleveId} periodeId={periodeId} />}
          {onglet === 'assiduite' && <Assiduite eleveId={eleveId} />}
          {onglet === 'finances' && voitFinances && <Finances eleveId={eleveId} />}
        </div>
      )}
    </Modale>
  );
}

function EnTete({ eleve }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 text-lg font-semibold text-marine-700 dark:text-marine-300">
        {eleve.prenom?.[0]}{eleve.nom?.[0]}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold">{eleve.prenom} {eleve.nom}</p>
        <p className="text-sm text-slate-500">
          <span className="font-mono">{eleve.matricule}</span>
          {eleve.classe && <> · {eleve.classe}</>}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {eleve.classe ? <Puce ton="info">{eleve.classe}</Puce> : <Puce>Non affecté</Puce>}
        <Puce ton={eleve.statut === 'actif' ? 'succes' : 'neutre'}>{eleve.statut}</Puce>
      </div>
    </div>
  );
}

function Informations({ eleve, onChange }) {
  const { aRole } = useAuth();
  const peutAffecter = aRole('admin', 'censeur', 'directeur', 'proviseur', 'comptable');
  const champs = [
    ['Matricule', eleve.matricule],
    ['Sexe', eleve.sexe === 'F' ? 'Fille' : eleve.sexe === 'M' ? 'Garçon' : '—'],
    ['Date de naissance', dateFr(eleve.date_naissance)],
    ['Lieu de naissance', eleve.lieu_naissance || '—'],
    ['Nationalité', eleve.nationalite || '—'],
    ['Classe', eleve.classe || 'Non affecté'],
    ['Niveau', eleve.niveau || '—'],
    ['Adresse', eleve.adresse || '—'],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-500">État civil</h3>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {champs.map(([cle, val]) => (
            <div key={cle}>
              <p className="text-xs text-slate-400">{cle}</p>
              <p className="text-sm">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {peutAffecter && <AffectationClasse eleve={eleve} onChange={onChange} />}

      <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-500">
          Tuteurs et personnes à contacter
        </h3>
        {!eleve.tuteurs?.length ? (
          <p className="text-sm text-slate-500">Aucun tuteur enregistré.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {eleve.tuteurs.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.prenom} {t.nom}</span>
                  <Puce>{t.lien}</Puce>
                  {t.principal && <Puce ton="info">principal</Puce>}
                </div>
                <p className="text-sm text-slate-500">{t.telephone}</p>
                {t.email && <p className="text-sm text-slate-500">{t.email}</p>}
                {t.profession && <p className="text-xs text-slate-400">{t.profession}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Visible de la seule direction : le serveur n envoie pas l info aux autres */}
      {eleve.compte_parent !== undefined && <CompteParent eleve={eleve} />}
    </div>
  );
}

/**
 * Place l eleve dans une classe de l annee active : un eleve inscrit
 * « a affecter plus tard », ou dont l inscription concerne une annee
 * passee, apparait « Non affecte » tant que ce n est pas fait.
 */
function AffectationClasse({ eleve, onChange }) {
  const [classes, setClasses] = useState([]);
  const [choix, setChoix] = useState(eleve.classe_id ? String(eleve.classe_id) : '');
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    get('/scolarite/classes').then(setClasses).catch(() => setClasses([]));
  }, []);

  const affecter = async () => {
    setEnvoi(true);
    setMessage('');
    try {
      await post(`/eleves/${eleve.id}/affecter`, { classe_id: Number(choix) });
      onChange?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  const nonAffecte = !eleve.classe_id;
  return (
    <div className={`rounded-lg border p-3 ${nonAffecte
      ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
      : 'border-slate-200 dark:border-slate-800'}`}>
      <p className="mb-2 text-sm">
        {nonAffecte
          ? <><strong>Non affecté</strong> à une classe de l'année en cours : choisissez sa classe.</>
          : <>Classe de l'année en cours : <strong>{eleve.classe}</strong></>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="champ w-auto min-w-[12rem]" value={choix} aria-label="Classe"
                onChange={(e) => setChoix(e.target.value)}>
          <option value="">— Choisir une classe —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.libelle} ({c.effectif}/{c.capacite})</option>
          ))}
        </select>
        <button type="button" className="bouton-primaire px-3 py-1.5"
                disabled={envoi || !choix || choix === String(eleve.classe_id || '')} onClick={affecter}>
          {envoi ? 'Affectation…' : nonAffecte ? 'Affecter' : 'Changer de classe'}
        </button>
      </div>
      {classes.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">Aucune classe pour l'année en cours : créez-les d'abord (menu Classes).</p>
      )}
      {message && <p className="mt-2 text-sm text-red-600">{message}</p>}
    </div>
  );
}

/**
 * Compte parent de l eleve : etat, et remise d une fiche d acces. Sert aux
 * eleves inscrits avant la creation automatique, et aux fiches perdues.
 */
function CompteParent({ eleve }) {
  const [compte, setCompte] = useState(eleve.compte_parent);
  const [fiche, setFiche] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  const genererFiche = async () => {
    if (compte && !window.confirm(
      'Générer une nouvelle fiche ? Le mot de passe actuel du parent cessera de fonctionner.'
    )) return;
    setEnvoi(true);
    setErreur('');
    try {
      const r = await post(`/eleves/${eleve.id}/compte-parent`, {});
      setFiche(r);
      setCompte((c) => ({
        ...(c || {}), identifiant: r.identifiant, mot_de_passe: r.mot_de_passe,
        actif: true, doit_changer_mdp: true,
      }));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  let etat;
  if (!compte) etat = <Puce ton="danger">Aucun compte</Puce>;
  else if (!compte.actif) etat = <Puce ton="danger">Désactivé</Puce>;
  else if (compte.doit_changer_mdp) etat = <Puce ton="alerte">Pas encore activé par le parent</Puce>;
  else etat = <Puce ton="succes">Actif</Puce>;

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-500">Accès du parent</h3>
        <a href={`/fiche-inscription/${eleve.id}`} target="_blank" rel="noopener noreferrer"
           className="bouton-secondaire px-3 py-1.5">
          <Printer className="h-4 w-4" /> Fiche d'inscription
        </a>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <KeyRound className="h-5 w-5 shrink-0 text-slate-400" />
          {etat}
          {compte?.derniere_connexion && (
            <span className="text-xs text-slate-500">Dernière connexion : {dateFr(compte.derniere_connexion)}</span>
          )}
        </div>

        {compte && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-400">Nom d'utilisateur</p>
              <p className="font-mono text-sm font-semibold break-all">{compte.identifiant}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Mot de passe</p>
              {compte.mot_de_passe ? (
                <p className="font-mono text-lg font-bold tracking-wider">{compte.mot_de_passe}</p>
              ) : compte.doit_changer_mdp ? (
                <p className="text-sm text-slate-500">
                  Non disponible : générez une nouvelle fiche pour en obtenir un.
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  Choisi par le parent, confidentiel. En cas d'oubli : nouvelle fiche d'accès.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
          {compte?.mot_de_passe && (
            <button type="button" className="bouton-primaire"
                    onClick={() => setFiche({ identifiant: compte.identifiant, mot_de_passe: compte.mot_de_passe })}>
              <Printer className="h-4 w-4" /> Imprimer la fiche d'accès
            </button>
          )}
          <button type="button" className={compte ? 'bouton-secondaire' : 'bouton-primaire'}
                  disabled={envoi} onClick={genererFiche}>
            {envoi ? 'Génération…' : compte ? "Nouvelle fiche d'accès" : 'Créer le compte parent'}
          </button>
        </div>
      </div>
      {erreur && <p className="mt-2 text-sm text-red-600">{erreur}</p>}
      <FicheAcces eleve={eleve} compte={fiche} onFermer={() => setFiche(null)} />
    </div>
  );
}

function Bulletin({ eleveId, periodeId }) {
  const [bulletin, setBulletin] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    if (!eleveId || !periodeId) return;
    setBulletin(null);
    setErreur('');
    get(`/notes/bulletin/${eleveId}/${periodeId}`)
      .then(setBulletin)
      .catch((e) => setErreur(e.message));
  }, [eleveId, periodeId]);

  if (erreur) return <Vide titre="Bulletin indisponible" texte={erreur} />;
  if (!bulletin) return <Chargement />;
  if (!bulletin.matieres?.length) {
    return <Vide titre="Aucune note" texte="Aucune note saisie pour cette période." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden">
        <button onClick={() => window.print()} className="bouton-secondaire">
          <Printer className="h-4 w-4" /> Imprimer
        </button>
      </div>

      {/* Un enseignant ne voit que ses propres matieres, sauf s il est
          professeur principal : on l explique plutot que de laisser croire
          a des notes manquantes. La moyenne reste calculee sur tout. */}
      {bulletin.detail_partiel && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Vous ne voyez que les matières que vous enseignez. La moyenne
          générale et le rang tiennent compte de toutes les matières.
        </p>
      )}
      <BulletinOfficiel bulletin={bulletin} />
    </div>
  );
}

/** Detail evaluation par evaluation, regroupe par matiere. */
function DetailNotes({ eleveId, periodeId }) {
  const [matieres, setMatieres] = useState(null);

  useEffect(() => {
    if (!eleveId || !periodeId) return;
    setMatieres(null);
    get(`/notes/eleve/${eleveId}/${periodeId}`)
      .then(setMatieres)
      .catch(() => setMatieres([]));
  }, [eleveId, periodeId]);

  if (!matieres) return <Chargement />;
  if (!matieres.length) {
    return <Vide titre="Aucune évaluation" texte="Aucune évaluation sur cette période." />;
  }

  return (
    <div className="space-y-3">
      {matieres.map((m) => (
        <div key={m.matiere_id} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/50 px-4 py-2.5">
            <span className="flex items-center gap-2 font-medium">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: m.couleur }} />
              {m.matiere}
            </span>
            <span className={`font-semibold tabular-nums ${couleurNote(m.moyenne)}`}>
              {m.moyenne != null ? `${m.moyenne}/20` : '—'}
            </span>
          </div>
          <table className="tableau">
            <tbody>
              {m.evaluations.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="text-sm">{e.libelle}</span>
                    <span className="ml-2 text-xs capitalize text-slate-400">{e.type}</span>
                  </td>
                  <td className="hidden sm:table-cell text-slate-500">{dateFr(e.date_eval)}</td>
                  <td className="text-center text-xs text-slate-400">coef {e.coefficient}</td>
                  <td className="w-24 text-right">
                    {e.valeur === null ? (
                      <Puce ton="neutre">Absent</Puce>
                    ) : (
                      <span className={`font-semibold tabular-nums ${couleurNote(e.valeur * 20 / e.bareme)}`}>
                        {e.valeur}/{e.bareme}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Assiduite({ eleveId }) {
  const [absences, setAbsences] = useState(null);
  const [sanctions, setSanctions] = useState([]);

  const charger = useCallback(() => {
    get(`/vie-scolaire/absences?eleve_id=${eleveId}`)
      .then(setAbsences).catch(() => setAbsences([]));
    get(`/vie-scolaire/sanctions?eleve_id=${eleveId}`)
      .then(setSanctions).catch(() => setSanctions([]));
  }, [eleveId]);

  useEffect(() => { charger(); }, [charger]);

  if (!absences) return <Chargement />;

  const nbAbsences = absences.filter((a) => a.type === 'absence').length;
  const nbRetards = absences.filter((a) => a.type === 'retard').length;
  const nbNonJust = absences.filter((a) => a.type === 'absence' && !a.justifiee).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Absences', nbAbsences, CalendarX, 'text-red-600 dark:text-red-400'],
          ['Retards', nbRetards, Clock, 'text-amber-600 dark:text-amber-400'],
          ['Non justifiées', nbNonJust, ShieldAlert, 'text-slate-700 dark:text-slate-300'],
        ].map(([libelle, valeur, Icone, couleur]) => (
          <div key={libelle} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
            <Icone className={`mx-auto mb-1 h-4 w-4 ${couleur}`} />
            <p className={`text-xl font-semibold tabular-nums ${couleur}`}>{valeur}</p>
            <p className="text-xs text-slate-400">{libelle}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-500">Historique</h3>
        {absences.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune absence ni retard enregistré.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="tableau">
              <thead className="sticky top-0">
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="hidden sm:table-cell">Matière</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <tr key={a.id}>
                    <td>{dateFr(a.date_abs)}</td>
                    <td>
                      <Puce ton={a.type === 'retard' ? 'alerte' : 'danger'}>
                        {a.type === 'retard' ? 'Retard' : 'Absence'}
                      </Puce>
                    </td>
                    <td className="hidden sm:table-cell text-slate-500">{a.matiere || '—'}</td>
                    <td>
                      {a.justifiee
                        ? <Puce ton="succes">Justifiée</Puce>
                        : <Puce>Non justifiée</Puce>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sanctions.length > 0 && (
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-500">Sanctions</h3>
          <ul className="space-y-2">
            {sanctions.map((s) => (
              <li key={s.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Puce ton={s.type === 'exclusion' ? 'danger' : 'alerte'}>{s.type}</Puce>
                  <span className="text-xs text-slate-400">{dateFr(s.date_debut)}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">{s.motif}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Finances({ eleveId }) {
  const { aRole } = useAuth();
  const caisse = aRole('admin', 'comptable');
  const [situation, setSituation] = useState(null);
  const [erreur, setErreur] = useState('');
  const [encaisser, setEncaisser] = useState(false);
  const [recu, setRecu] = useState(null);
  const [messageCaisse, setMessageCaisse] = useState('');

  const charger = useCallback(() => {
    get(`/finances/situation/${eleveId}`)
      .then(setSituation)
      .catch((e) => setErreur(e.message));
  }, [eleveId]);

  useEffect(() => { setSituation(null); charger(); }, [charger]);

  if (erreur) return <Vide titre="Situation indisponible" texte={erreur} />;
  if (!situation) return <Chargement />;

  // Frais d entree (droit d inscription, blouse, assurance...) encore dus :
  // on propose l encaissement de l inscription, 1er mois compris
  const inscriptionDue = situation.lignes?.some(
    (l) => !l.recurrent && l.obligatoire && Number(l.reste) > 0
  );

  return (
    <div className="space-y-4">
      {caisse && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {inscriptionDue && (
            <span className="mr-auto text-sm text-amber-600 dark:text-amber-400">
              Frais d'inscription non réglés
            </span>
          )}
          <button type="button" className="bouton-primaire" onClick={() => { setMessageCaisse(''); setEncaisser(true); }}>
            <Wallet className="h-4 w-4" />
            {inscriptionDue ? "Encaisser les frais d'inscription" : 'Encaisser un paiement'}
          </button>
        </div>
      )}
      {messageCaisse && <p className="text-sm text-red-600">{messageCaisse}</p>}
      <BandeauRecu recu={recu} onFermer={() => setRecu(null)} />
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-xs text-slate-400">Total dû</p>
          <p className="font-semibold tabular-nums">{fcfa(situation.total_du)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3">
          <p className="text-xs text-slate-400">Payé</p>
          <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fcfa(situation.total_paye)}
          </p>
        </div>
        <div className={`rounded-lg p-3 ${situation.reste > 0 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
          <p className="text-xs text-slate-400">Reste à payer</p>
          <p className={`font-semibold tabular-nums ${situation.reste > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
            {fcfa(situation.reste)}
          </p>
        </div>
      </div>

      {situation.a_jour && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          Cet élève est à jour de ses paiements.
        </div>
      )}

      <FormulairePaiement
        ouvert={encaisser}
        eleveInitial={situation.eleve}
        preselection={inscriptionDue ? 'inscription' : null}
        onFermer={() => setEncaisser(false)}
        onCree={(p) => {
          setEncaisser(false);
          setRecu({ id: p.id, numero: p.numero_recu, texte: `${fcfa(p.montant)} encaissés` });
          charger();
        }}
        onErreur={setMessageCaisse}
      />

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="tableau">
          <thead>
            <tr>
              <th>Frais</th>
              <th className="text-center">Type</th>
              <th className="text-right">Dû</th>
              <th className="text-right">Payé</th>
              <th className="text-right">Reste</th>
            </tr>
          </thead>
          <tbody>
            {situation.lignes.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.libelle}</td>
                <td className="text-center">
                  <Puce ton={l.recurrent ? 'info' : 'neutre'}>
                    {l.recurrent ? 'Mensuel' : 'Unique'}
                  </Puce>
                </td>
                <td className="text-right tabular-nums text-slate-500">{fcfa(l.du)}</td>
                <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fcfa(l.paye)}
                </td>
                <td className={`text-right font-semibold tabular-nums ${l.reste > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                  {fcfa(l.reste)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
