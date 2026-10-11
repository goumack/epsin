import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, GraduationCap, ClipboardList, CalendarDays,
  Wallet, MessageSquare, BookOpen, Bus, Settings, LogOut, Menu, X,
  Bell, Moon, Sun, School, UserCog, ShieldAlert, UserCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { get, patch } from '../lib/api';

/** Chaque entree declare les roles autorises a la voir. */
// Le directeur (elementaire) et le proviseur (moyen/secondaire) ont les memes
// ecrans que le censeur ; le serveur limite ce qu ils y voient a leur entite.
const CHEFS = ['admin', 'censeur', 'directeur', 'proviseur'];

/** Chefs d etablissement : seuls habilites a statuer sur les conges. */
const CHEFS_ETABLISSEMENT = ['admin', 'directeur', 'proviseur'];

const NAVIGATION = [
  { to: '/', libelle: 'Tableau de bord', icone: LayoutDashboard, roles: [...CHEFS,'comptable','enseignant','eleve'] },
  // Le tuteur a son propre espace : le suivi de son enfant, rien d autre
  { to: '/mon-enfant', libelle: 'Mon enfant', icone: Users, roles: ['parent'] },
  { to: '/eleves', libelle: 'Élèves', icone: Users, roles: [...CHEFS,'comptable','enseignant'] },
  { to: '/classes', libelle: 'Classes', icone: School, roles: [...CHEFS,'comptable','enseignant'] },
  { to: '/notes', libelle: 'Notes et bulletins', icone: ClipboardList, roles: [...CHEFS,'enseignant','eleve'] },
  { to: '/vie-scolaire', libelle: 'Vie scolaire', icone: ShieldAlert, roles: [...CHEFS,'enseignant'] },
  { to: '/personnel', libelle: 'Personnel', icone: UserCheck, roles: [...CHEFS_ETABLISSEMENT,'enseignant'] },
  { to: '/emploi-du-temps', libelle: 'Emploi du temps', icone: CalendarDays, roles: [...CHEFS,'enseignant','eleve'] },
  { to: '/finances', libelle: 'Finances', icone: Wallet, roles: ['admin','comptable'] },
  { to: '/communication', libelle: 'Communication', icone: MessageSquare, roles: [...CHEFS,'comptable','enseignant','eleve','parent'] },
  { to: '/bibliotheque', libelle: 'Bibliothèque', icone: BookOpen, roles: CHEFS },
  { to: '/transport', libelle: 'Transport', icone: Bus, roles: CHEFS },
  { to: '/utilisateurs', libelle: 'Utilisateurs', icone: UserCog, roles: ['admin'] },
  { to: '/parametres', libelle: 'Paramètres', icone: Settings, roles: ['admin'] },
];

const LIBELLES_ROLE = {
  admin: 'Administrateur', censeur: 'Censeur', comptable: 'Comptable',
  directeur: 'Directeur', proviseur: 'Proviseur',
  enseignant: 'Enseignant', eleve: 'Élève', parent: 'Parent',
};

/** Nom lisible de l entite, affiche sous le nom de l utilisateur. */
const LIBELLES_ENTITE = {
  scolaire: 'Élémentaire',
  secondaire: 'Moyen et secondaire',
};

export default function Layout() {
  const { utilisateur, deconnexion } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [sombre, setSombre] = useState(() => {
    try { return localStorage.getItem('epsin_theme') === 'sombre'; } catch { return false; }
  });
  const [nonLues, setNonLues] = useState(0);

  // Applique le theme sur la racine du document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', sombre);
    try { localStorage.setItem('epsin_theme', sombre ? 'sombre' : 'clair'); } catch { /* ignore */ }
  }, [sombre]);

  // Ferme le menu mobile a chaque changement de page
  useEffect(() => { setMenuOuvert(false); }, [location.pathname]);

  // Compteur de notifications, rafraichi periodiquement
  useEffect(() => {
    let actif = true;
    const charger = async () => {
      try {
        const d = await get('/communication/notifications');
        if (actif) setNonLues(d.non_lues || 0);
      } catch { /* silencieux : le compteur n est pas critique */ }
    };
    charger();
    const t = setInterval(charger, 60000);
    return () => { actif = false; clearInterval(t); };
  }, []);

  const entrees = NAVIGATION.filter((e) => e.roles.includes(utilisateur?.role));

  const seDeconnecter = () => {
    deconnexion();
    navigate('/connexion');
  };

  const marquerLues = async () => {
    try {
      await patch('/communication/notifications/tout-lu');
      setNonLues(0);
    } catch { /* ignore */ }
    navigate('/communication');
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Voile sombre du menu mobile */}
      {menuOuvert && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuOuvert(false)}
        />
      )}

      {/* Barre laterale */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-slate-200 dark:border-slate-800
                    bg-white dark:bg-slate-900 transition-transform duration-200 lg:static lg:translate-x-0
                    ${menuOuvert ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800 px-5 h-16 shrink-0">
            <img
              src="/logo-epsin.jpeg"
              alt="Sceau de l'École Privée Serighe Ibrahima Niang"
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0">
              <p className="font-semibold leading-tight">EPSIN-YEHE</p>
              <p className="text-[11px] text-slate-500 leading-tight">Gestion scolaire</p>
            </div>
            <button
              onClick={() => setMenuOuvert(false)}
              className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Fermer le menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {entrees.map(({ to, libelle, icone: Icone }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-marine-50 text-marine-700 dark:bg-marine-950 dark:text-marine-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icone className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{libelle}</span>
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 shrink-0">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marine-100 dark:bg-marine-900 text-marine-700 dark:text-marine-300 font-semibold text-sm">
                {utilisateur?.prenom?.[0]}{utilisateur?.nom?.[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {utilisateur?.prenom} {utilisateur?.nom}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {LIBELLES_ROLE[utilisateur?.role] || utilisateur?.role}
                  {utilisateur?.entite && ` · ${LIBELLES_ENTITE[utilisateur.entite]}`}
                </p>
              </div>
            </div>
            <button
              onClick={seDeconnecter}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 transition-colors"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Déconnexion
            </button>
          </div>
        </div>
      </aside>

      {/* Zone principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-4 sm:px-6">
          <button
            onClick={() => setMenuOuvert(true)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <h1 className="truncate font-semibold">
            {entrees.find((e) => e.to === location.pathname)?.libelle || 'EPSIN'}
          </h1>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={marquerLues}
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {nonLues > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {nonLues > 9 ? '9+' : nonLues}
                </span>
              )}
            </button>
            <button
              onClick={() => setSombre((s) => !s)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={sombre ? 'Thème clair' : 'Thème sombre'}
            >
              {sombre ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
