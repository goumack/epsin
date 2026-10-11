import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { post } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Erreur } from '../components/ui';

/**
 * Premiere connexion avec un mot de passe temporaire (fiche d acces parent,
 * reinitialisation) : le compte doit choisir son propre mot de passe avant
 * tout le reste. Le serveur refuse de toute facon les autres requetes.
 */
export default function ChoisirMotDePasse() {
  const { utilisateur, rafraichir, deconnexion } = useAuth();
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async (e) => {
    e.preventDefault();
    setErreur('');
    if (nouveau.length < 8) return setErreur('Le mot de passe doit faire au moins 8 caractères');
    if (nouveau !== confirmation) return setErreur('Les deux mots de passe ne correspondent pas');
    setEnvoi(true);
    try {
      await post('/auth/mot-de-passe', { ancien, nouveau });
      await rafraichir();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  const type = visible ? 'text' : 'password';

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #7A0A1B 0%, #610615 55%, #3F040E 100%)' }}
    >
      <div className="animer w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/logo-epsin.jpeg" alt=""
               className="mx-auto mb-4 h-20 w-20 rounded-full object-cover shadow-lg ring-2 ring-white/25" />
          <h1 className="text-xl font-bold text-white">Bienvenue{utilisateur?.prenom ? `, ${utilisateur.prenom}` : ''}</h1>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5" /> Choisissez votre mot de passe
          </h2>
          <p className="mb-5 text-sm text-slate-500">
            Le mot de passe qui vous a été remis ne sert qu'une fois. Choisissez-en un que vous seul connaissez.
          </p>

          <form onSubmit={soumettre} className="space-y-4">
            <div>
              <label htmlFor="ancien" className="etiquette">Mot de passe qui vous a été remis</label>
              <input id="ancien" type={type} className="champ font-mono" required autoFocus
                     autoComplete="current-password" value={ancien}
                     onChange={(e) => setAncien(e.target.value)} />
            </div>
            <div>
              <label htmlFor="nouveau" className="etiquette">Nouveau mot de passe (8 caractères minimum)</label>
              <div className="relative">
                <input id="nouveau" type={type} className="champ pr-10" required minLength={8}
                       autoComplete="new-password" value={nouveau}
                       onChange={(e) => setNouveau(e.target.value)} />
                <button type="button" onClick={() => setVisible((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label={visible ? 'Masquer' : 'Afficher'}>
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="confirmation" className="etiquette">Confirmez le nouveau mot de passe</label>
              <input id="confirmation" type={type} className="champ" required
                     autoComplete="new-password" value={confirmation}
                     onChange={(e) => setConfirmation(e.target.value)} />
            </div>

            <Erreur message={erreur} />

            <button type="submit" className="bouton-primaire w-full py-2.5" disabled={envoi}
                    style={{ backgroundColor: '#7A0A1B', borderColor: '#7A0A1B' }}>
              {envoi && <Loader2 className="h-4 w-4 animate-spin" />}
              {envoi ? 'Enregistrement…' : 'Enregistrer et continuer'}
            </button>
          </form>

          <button type="button" onClick={deconnexion}
                  className="mt-4 w-full text-center text-xs text-slate-500 underline">
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
