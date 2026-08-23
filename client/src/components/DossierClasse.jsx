import { useEffect, useState } from 'react';
import {
  Users, MapPin, GraduationCap, Trophy, CalendarDays, UserCheck,
} from 'lucide-react';
import { get, dateFr, couleurNote } from '../lib/api';
import { Chargement, Erreur, Vide, Modale, Puce, Onglets } from './ui';
import DossierEleve from './DossierEleve';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/**
 * Dossier complet d une classe : identite, effectif, eleves,
 * equipe pedagogique, emploi du temps et resultats.
 */
export default function DossierClasse({ classeId, onFermer }) {
  const [onglet, setOnglet] = useState('infos');
  const [classe, setClasse] = useState(null);
  const [erreur, setErreur] = useState('');
  // Permet d ouvrir le dossier d un eleve depuis la liste de la classe
  const [eleveOuvert, setEleveOuvert] = useState(null);

  useEffect(() => {
    if (!classeId) { setClasse(null); setOnglet('infos'); return; }
    setErreur('');
    setClasse(null);
    get(`/scolarite/classes/${classeId}`)
      .then(setClasse)
      .catch((e) => setErreur(e.message));
  }, [classeId]);

  const onglets = [
    { cle: 'infos', libelle: 'Informations' },
    { cle: 'eleves', libelle: 'Élèves' },
    { cle: 'equipe', libelle: 'Équipe pédagogique' },
    { cle: 'edt', libelle: 'Emploi du temps' },
    { cle: 'resultats', libelle: 'Résultats' },
  ];

  return (
    <>
      <Modale
        ouverte={!!classeId && !eleveOuvert}
        onFermer={onFermer}
        titre="Dossier de la classe"
        taille="xl"
      >
        <Erreur message={erreur} />
        {!classe ? <Chargement /> : (
          <div className="space-y-4">
            <EnTete classe={classe} />

            <div className="print:hidden">
              <Onglets onglets={onglets} actif={onglet} onChange={setOnglet} />
            </div>

            {onglet === 'infos' && <Informations classe={classe} />}
            {onglet === 'eleves' && (
              <ListeEleves classeId={classeId} onOuvrirEleve={setEleveOuvert} />
            )}
            {onglet === 'equipe' && <Equipe classeId={classeId} entite={classe.entite} />}
            {onglet === 'edt' && <EmploiDuTemps classeId={classeId} />}
            {onglet === 'resultats' && <Resultats classeId={classeId} />}
          </div>
        )}
      </Modale>

      {/* Dossier d un eleve ouvert depuis la liste : on referme celui-ci en revenant */}
      <DossierEleve eleveId={eleveOuvert} onFermer={() => setEleveOuvert(null)} />
    </>
  );
}

function EnTete({ classe }) {
  const taux = classe.capacite ? (classe.effectif / classe.capacite) * 100 : 0;
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-marine-100 dark:bg-marine-900 text-marine-700 dark:text-marine-300">
          <GraduationCap className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold">{classe.libelle}</p>
          <p className="text-sm text-slate-500">
            {classe.niveau} · {classe.cycle} · Année {classe.annee}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {classe.examen && <Puce ton="info">{classe.examen}</Puce>}
          <Puce ton={taux >= 95 ? 'danger' : taux >= 80 ? 'alerte' : 'succes'}>
            {classe.effectif}/{classe.capacite} élèves
          </Puce>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${
            taux >= 95 ? 'bg-red-500' : taux >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
          }`}
          style={{ width: `${Math.min(taux, 100)}%` }}
        />
      </div>
    </div>
  );
}

function Informations({ classe }) {
  const tuiles = [
    ['Effectif', classe.effectif, Users],
    ['Garçons', classe.garcons, Users],
    ['Filles', classe.filles, Users],
    ['Places libres', Math.max(classe.capacite - classe.effectif, 0), UserCheck],
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tuiles.map(([libelle, valeur, Icone]) => (
          <div key={libelle} className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
            <Icone className="mx-auto mb-1 h-4 w-4 text-slate-400" />
            <p className="text-xl font-semibold tabular-nums">{valeur}</p>
            <p className="text-xs text-slate-400">{libelle}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-500">Professeur principal</h3>
        {classe.pp_nom ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 text-sm font-semibold text-marine-700 dark:text-marine-300">
              {classe.pp_prenom?.[0]}{classe.pp_nom?.[0]}
            </div>
            <div className="min-w-0">
              <p className="font-medium">{classe.pp_prenom} {classe.pp_nom}</p>
              <p className="text-sm text-slate-500">
                {classe.pp_email || classe.pp_telephone || 'Aucun contact renseigné'}
              </p>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 text-sm text-slate-500">
            Aucun professeur principal désigné pour cette classe.
          </p>
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-500">Organisation</h3>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Niveau', classe.niveau],
            ['Cycle', classe.cycle],
            ['Salle', classe.salle || '—'],
            ['Capacité', `${classe.capacite} places`],
            ['Matières enseignées', classe.nb_matieres],
            ['Créneaux hebdomadaires', classe.nb_creneaux],
            ['Examen de fin de cycle', classe.examen || 'Aucun'],
            ['Année scolaire', classe.annee],
          ].map(([cle, val]) => (
            <div key={cle}>
              <p className="text-xs text-slate-400">{cle}</p>
              <p className="text-sm">{val}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListeEleves({ classeId, onOuvrirEleve }) {
  const [eleves, setEleves] = useState(null);

  useEffect(() => {
    setEleves(null);
    get(`/scolarite/classes/${classeId}/eleves`)
      .then(setEleves)
      .catch(() => setEleves([]));
  }, [classeId]);

  if (!eleves) return <Chargement />;
  if (!eleves.length) {
    return <Vide titre="Aucun élève" texte="Cette classe n'a pas encore d'élèves inscrits." />;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">
        {eleves.length} élève{eleves.length > 1 ? 's' : ''} — cliquez sur une ligne pour ouvrir le dossier
      </p>
      <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="tableau">
          <thead className="sticky top-0">
            <tr>
              <th>Matricule</th>
              <th>Nom complet</th>
              <th className="hidden sm:table-cell">Sexe</th>
              <th className="hidden md:table-cell">Naissance</th>
              <th className="hidden lg:table-cell">Contact tuteur</th>
            </tr>
          </thead>
          <tbody>
            {eleves.map((e) => (
              <tr
                key={e.id}
                onClick={() => onOuvrirEleve(e.id)}
                className="cursor-pointer"
              >
                <td className="font-mono text-xs text-slate-500">{e.matricule}</td>
                <td className="font-medium">{e.prenom} {e.nom}</td>
                <td className="hidden sm:table-cell">
                  {e.sexe === 'F' ? 'Fille' : e.sexe === 'M' ? 'Garçon' : '—'}
                </td>
                <td className="hidden md:table-cell text-slate-500">{dateFr(e.date_naissance)}</td>
                <td className="hidden lg:table-cell text-slate-500">{e.contact_tuteur || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Equipe({ classeId, entite }) {
  const [equipe, setEquipe] = useState(null);

  useEffect(() => {
    setEquipe(null);
    get(`/scolarite/classes/${classeId}/enseignants`)
      .then(setEquipe)
      .catch(() => setEquipe([]));
  }, [classeId]);

  if (!equipe) return <Chargement />;
  if (!equipe.length) {
    return <Vide titre="Aucun domaine affecté" texte="Affectez un maître à cette classe." />;
  }

  // A l elementaire, un seul maitre prend en charge les 4 domaines du CEB :
  // une carte par matiere repeterait 4 fois le meme nom, ce qui est confus.
  // On affiche donc une seule carte "maitre" avec ses domaines en-dessous.
  if (entite === 'scolaire') {
    const maitre = equipe.find((a) => a.nom);
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Classe à maître unique — programme du CEB (Curriculum de l'Éducation de Base)
        </p>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          {maitre ? (
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 font-semibold text-marine-700 dark:text-marine-300">
                {maitre.prenom?.[0]}{maitre.nom?.[0]}
              </div>
              <div className="min-w-0">
                <p className="font-medium">{maitre.prenom} {maitre.nom}</p>
                <p className="text-sm text-slate-500">
                  {maitre.specialite || 'Maître polyvalent'}
                  {maitre.email && ` · ${maitre.email}`}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Aucun maître affecté à cette classe</p>
          )}

          <div className="mt-4 grid gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 sm:grid-cols-2">
            {equipe.map((a) => (
              <div key={a.affectation_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.couleur }} />
                  {a.matiere}
                </span>
                <Puce>coef {a.coefficient}</Puce>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Moyen et secondaire : un professeur different par matiere
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">
        {equipe.length} matière{equipe.length > 1 ? 's' : ''} enseignée{equipe.length > 1 ? 's' : ''}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {equipe.map((a) => (
          <div
            key={a.affectation_id}
            className="rounded-lg border border-slate-200 dark:border-slate-800 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.couleur }} />
                {a.matiere}
              </span>
              <Puce>coef {a.coefficient}</Puce>
            </div>
            {a.nom ? (
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold">
                  {a.prenom?.[0]}{a.nom?.[0]}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm">{a.prenom} {a.nom}</p>
                  {a.email && <p className="truncate text-xs text-slate-400">{a.email}</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Aucun enseignant affecté</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmploiDuTemps({ classeId }) {
  const [creneaux, setCreneaux] = useState(null);

  useEffect(() => {
    setCreneaux(null);
    get(`/scolarite/emploi-du-temps/${classeId}`)
      .then(setCreneaux)
      .catch(() => setCreneaux([]));
  }, [classeId]);

  if (!creneaux) return <Chargement />;
  if (!creneaux.length) {
    return <Vide titre="Emploi du temps vide" texte="Aucun créneau défini pour cette classe." />;
  }

  // Vue compacte par jour : la grille horaire complete reste sur sa page dediee
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {JOURS.map((jour, i) => {
        const duJour = creneaux
          .filter((c) => c.jour === i + 1)
          .sort((a, b) => String(a.heure_debut).localeCompare(String(b.heure_debut)));
        if (!duJour.length) return null;
        return (
          <div key={jour} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              {jour}
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {duJour.map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.couleur || '#3b82f6' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.matiere}</p>
                    <p className="text-xs text-slate-400">
                      {String(c.heure_debut).slice(0, 5)}–{String(c.heure_fin).slice(0, 5)}
                      {c.salle && ` · ${c.salle}`}
                    </p>
                    {c.ens_nom && (
                      <p className="truncate text-xs text-slate-400">{c.ens_prenom} {c.ens_nom}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Resultats({ classeId }) {
  const [periodes, setPeriodes] = useState([]);
  const [periodeId, setPeriodeId] = useState('');
  const [classement, setClassement] = useState(null);

  useEffect(() => {
    get('/scolarite/periodes').then((p) => {
      setPeriodes(p);
      if (p[0]) setPeriodeId(String(p[0].id));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!periodeId) return;
    setClassement(null);
    get(`/notes/classement/${classeId}/${periodeId}`)
      .then(setClassement)
      .catch(() => setClassement([]));
  }, [classeId, periodeId]);

  const moyennes = (classement || [])
    .map((r) => Number(r.moyenne))
    .filter(Number.isFinite);
  const moyenneClasse = moyennes.length
    ? (moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2)
    : null;
  const admis = moyennes.filter((m) => m >= 10).length;

  return (
    <div className="space-y-4">
      <select
        className="champ sm:w-52"
        value={periodeId}
        onChange={(e) => setPeriodeId(e.target.value)}
      >
        {periodes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
      </select>

      {!classement ? <Chargement /> : classement.length === 0 ? (
        <Vide titre="Aucun résultat" texte="Aucune note saisie pour cette période." />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
              <p className="text-xs text-slate-400">Moyenne de classe</p>
              <p className={`text-xl font-semibold tabular-nums ${couleurNote(Number(moyenneClasse))}`}>
                {moyenneClasse ?? '—'}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-center">
              <p className="text-xs text-slate-400">Moyennes ≥ 10</p>
              <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {admis}/{moyennes.length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-center">
              <p className="text-xs text-slate-400">Taux de réussite</p>
              <p className="text-xl font-semibold tabular-nums">
                {moyennes.length ? `${Math.round((admis / moyennes.length) * 100)} %` : '—'}
              </p>
            </div>
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="tableau">
              <thead className="sticky top-0">
                <tr>
                  <th className="w-16">Rang</th>
                  <th>Élève</th>
                  <th className="text-center">Moyenne</th>
                  <th className="hidden sm:table-cell text-center">Mention</th>
                </tr>
              </thead>
              <tbody>
                {classement.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.rang <= 3 ? (
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Trophy className={`h-4 w-4 ${
                            r.rang === 1 ? 'text-amber-500' : r.rang === 2 ? 'text-slate-400' : 'text-orange-700'
                          }`} />
                          {r.rang}
                        </span>
                      ) : (
                        <span className="tabular-nums text-slate-500">{r.rang}</span>
                      )}
                    </td>
                    <td className="font-medium">{r.prenom} {r.nom}</td>
                    <td className={`text-center font-semibold tabular-nums ${couleurNote(Number(r.moyenne))}`}>
                      {r.moyenne}
                    </td>
                    <td className="hidden sm:table-cell text-center text-slate-500">{r.mention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
