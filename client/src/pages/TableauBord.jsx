import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { Users, School, Wallet, TrendingDown, UserCheck, ClipboardList } from 'lucide-react';
import { get, fcfa } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Chargement, Erreur, Statistique, Vide, Puce } from '../components/ui';

const COULEURS = ['#0d72f0', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

export default function TableauBord() {
  const { utilisateur, aRole } = useAuth();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    get('/tableau-bord').then(setDonnees).catch((e) => setErreur(e.message));
  }, []);

  if (erreur) return <Erreur message={erreur} />;
  if (!donnees) return <Chargement />;

  if (!donnees.annee) {
    return (
      <Vide
        titre="Aucune année scolaire active"
        texte="Créez une année scolaire et activez-la pour commencer."
        action={<Link to="/parametres" className="bouton-primaire">Aller aux paramètres</Link>}
      />
    );
  }

  const { effectifs, structure, finances, par_classe = [], absences_semaine = [] } = donnees;

  return (
    <div className="animer space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">
            Bonjour {utilisateur?.prenom}, voici la situation de l'établissement.
          </p>
        </div>
        <Puce ton="info">Année {donnees.annee.libelle}</Puce>
      </div>

      {/* Indicateurs cles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistique
          titre="Élèves inscrits"
          valeur={effectifs.total}
          detail={`${effectifs.garcons} garçons · ${effectifs.filles} filles`}
          icone={Users}
          ton="info"
        />
        <Statistique
          titre="Classes"
          valeur={structure.classes}
          detail={`${structure.enseignants} enseignants`}
          icone={School}
          ton="succes"
        />
        {finances ? (
          <>
            <Statistique
              titre="Recettes de l'année"
              valeur={fcfa(finances.recettes)}
              detail={`Ce mois : ${fcfa(finances.recettes_mois)}`}
              icone={Wallet}
              ton="succes"
            />
            <Statistique
              titre="Solde"
              valeur={fcfa(finances.solde)}
              detail={`Dépenses : ${fcfa(finances.depenses)}`}
              icone={TrendingDown}
              ton={Number(finances.solde) >= 0 ? 'succes' : 'danger'}
            />
          </>
        ) : (
          <Statistique
            titre="Taux d'encadrement"
            valeur={structure.enseignants ? `${Math.round(effectifs.total / structure.enseignants)} él./ens.` : '—'}
            icone={UserCheck}
            ton="alerte"
          />
        )}
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="carte p-5 lg:col-span-2">
          <h3 className="mb-4 font-semibold">Effectifs par classe</h3>
          {par_classe.length === 0 ? (
            <Vide titre="Aucune classe" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={par_classe} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="classe" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                  formatter={(v) => [`${v} élèves`, 'Effectif']}
                />
                <Bar dataKey="effectif" fill="#0d72f0" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="carte p-5">
          <h3 className="mb-4 font-semibold">Répartition par sexe</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={[
                  { name: 'Garçons', value: effectifs.garcons },
                  { name: 'Filles', value: effectifs.filles },
                ]}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                label={({ name, value }) => `${name} : ${value}`}
                labelLine={false}
                style={{ fontSize: 12 }}
              >
                <Cell fill="#0d72f0" />
                <Cell fill="#ec4899" />
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {absences_semaine.length > 0 && (
        <div className="carte p-5">
          <h3 className="mb-4 font-semibold">Absences des 7 derniers jours</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={absences_semaine} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                stroke="#94a3b8"
                tickFormatter={(d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
              />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} />
              <Line type="monotone" dataKey="nombre" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Vue enseignant */}
      {aRole('enseignant') && donnees.mes_cours?.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="carte p-5">
            <h3 className="mb-3 font-semibold">Mes cours</h3>
            <div className="flex flex-wrap gap-2">
              {donnees.mes_cours.map((c, i) => (
                <span key={i} className="puce bg-marine-50 text-marine-700 dark:bg-marine-950 dark:text-marine-300">
                  {c.classe} · {c.matiere}
                </span>
              ))}
            </div>
          </div>

          <div className="carte p-5">
            <h3 className="mb-3 font-semibold">Évaluations récentes</h3>
            {donnees.evaluations_recentes?.length ? (
              <ul className="space-y-2">
                {donnees.evaluations_recentes.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      <span className="text-slate-500">{e.classe} ·</span> {e.libelle}
                    </span>
                    <Puce ton={e.saisies >= e.attendus ? 'succes' : 'alerte'}>
                      {e.saisies}/{e.attendus}
                    </Puce>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Aucune évaluation créée.</p>
            )}
          </div>
        </div>
      )}

      {/* Activite recente */}
      {donnees.activite?.length > 0 && (
        <div className="carte p-5">
          <h3 className="mb-3 font-semibold">Activité récente</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {donnees.activite.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate">
                  <span className="font-medium">{a.prenom} {a.nom}</span>
                  <span className="text-slate-500"> — {a.action} {a.entite}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">
                  {new Date(a.cree_le).toLocaleString('fr-FR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
