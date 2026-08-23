import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Erreur } from '../components/ui';

export default function Connexion() {
  const { connexion } = useAuth();
  const navigate = useNavigate();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [visible, setVisible] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async (e) => {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      await connexion(identifiant, motDePasse);
      navigate('/', { replace: true });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  const remplir = (email) => {
    setIdentifiant(email);
    setMotDePasse('epsin2026');
  };

  return (
    // Bordeaux et or : les couleurs du sceau de l etablissement
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #7A0A1B 0%, #610615 55%, #3F040E 100%)' }}
    >
      <div className="animer w-full max-w-md">
        <div className="mb-6 text-center">
          <img
            src="/logo-epsin.jpeg"
            alt="Sceau de l'École Privée Serighe Ibrahima Niang"
            className="mx-auto mb-4 h-24 w-24 rounded-full object-cover shadow-lg ring-2 ring-white/25"
          />
          <h1 className="text-2xl font-bold text-white">EPSIN-YEHE</h1>
          <p className="mt-1 text-sm" style={{ color: '#E8C88A' }}>
            École Privée Serighe Ibrahima Niang
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
          <h2 className="mb-5 text-lg font-semibold">Connexion</h2>

          <form onSubmit={soumettre} className="space-y-4">
            <div>
              <label htmlFor="identifiant" className="etiquette">Email ou téléphone</label>
              <input
                id="identifiant"
                type="text"
                className="champ"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                placeholder="admin@epsin.sn"
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="mdp" className="etiquette">Mot de passe</label>
              <div className="relative">
                <input
                  id="mdp"
                  type={visible ? 'text' : 'password'}
                  className="champ pr-10"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label={visible ? 'Masquer' : 'Afficher'}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Erreur message={erreur} />

            {/* Bordeaux du sceau plutot que le bleu applicatif : l ecran de
                connexion porte l identite de l etablissement. */}
            <button
              type="submit"
              className="bouton-primaire w-full py-2.5"
              style={{ backgroundColor: '#7A0A1B', borderColor: '#7A0A1B' }}
              disabled={envoi}
            >
              {envoi && <Loader2 className="h-4 w-4 animate-spin" />}
              {envoi ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Comptes de démonstration</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                ['admin@epsin.sn', 'Administrateur'],
                ['directeur@epsin.sn', 'Directeur · Élémentaire'],
                ['proviseur@epsin.sn', 'Proviseur · Secondaire'],
                ['comptable@epsin.sn', 'Comptable'],
              ].map(([email, role]) => (
                <button
                  key={email}
                  type="button"
                  onClick={() => remplir(email)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="block font-medium">{role}</span>
                  <span className="block truncate text-slate-400">{email}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Mot de passe : epsin2026
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
