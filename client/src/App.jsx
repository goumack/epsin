import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './layouts/Layout';
import Connexion from './pages/Connexion';
import TableauBord from './pages/TableauBord';
import Eleves from './pages/Eleves';
import Classes from './pages/Classes';
import Notes from './pages/Notes';
import VieScolaire from './pages/VieScolaire';
import Personnel from './pages/Personnel';
import MonEnfant from './pages/MonEnfant';
import EmploiDuTemps from './pages/EmploiDuTemps';
import Finances from './pages/Finances';
import Communication from './pages/Communication';
import RecuPaiement from './pages/RecuPaiement';
import FicheInscription from './pages/FicheInscription';
import ChoisirMotDePasse from './pages/ChoisirMotDePasse';
import { Bibliotheque, Transport, Utilisateurs, Parametres } from './pages/Administration';
import { Chargement } from './components/ui';

// Chefs d etablissement : admin (transverse), censeur, et les deux directions
// d entite. Le cloisonnement effectif est applique par le serveur.
const CHEFS = ['admin', 'censeur', 'directeur', 'proviseur'];

/** Chefs d etablissement : seuls habilites a statuer sur les conges. */
const CHEFS_ETABLISSEMENT = ['admin', 'directeur', 'proviseur'];

/** Page d accueil selon le role : le tuteur a son propre espace. */
function accueilDe(utilisateur) {
  return utilisateur?.role === 'parent' ? '/mon-enfant' : '/';
}

/** Bloque l acces aux visiteurs non connectes, et filtre par role si demande. */
function Protegee({ roles, children }) {
  const { utilisateur, chargement } = useAuth();
  if (chargement) return <div className="flex min-h-screen items-center justify-center"><Chargement /></div>;
  if (!utilisateur) return <Navigate to="/connexion" replace />;
  // Mot de passe temporaire : rien d autre tant qu il n est pas remplace
  if (utilisateur.doit_changer_mdp) return <ChoisirMotDePasse />;
  // Renvoyer vers l accueil propre au role evite une boucle de redirection
  // pour un tuteur, qui n a pas acces au tableau de bord de l etablissement.
  if (roles && !roles.includes(utilisateur.role)) {
    return <Navigate to={accueilDe(utilisateur)} replace />;
  }
  return children;
}

/** Accueil : tableau de bord pour l ecole, espace de suivi pour le tuteur. */
function Accueil() {
  const { utilisateur } = useAuth();
  if (utilisateur?.role === 'parent') return <Navigate to="/mon-enfant" replace />;
  return <TableauBord />;
}

/** Redirige vers l accueil si deja connecte. */
function Publique({ children }) {
  const { utilisateur, chargement } = useAuth();
  if (chargement) return <div className="flex min-h-screen items-center justify-center"><Chargement /></div>;
  return utilisateur ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/connexion" element={<Publique><Connexion /></Publique>} />

          {/* Recu imprimable : hors de la mise en page, seul le recu s imprime */}
          <Route path="/fiche-inscription/:id" element={<Protegee roles={[...CHEFS, 'comptable']}><FicheInscription /></Protegee>} />
          <Route path="/recu/:id" element={<Protegee roles={['admin', 'comptable', 'parent']}><RecuPaiement /></Protegee>} />

          <Route path="/" element={<Protegee><Layout /></Protegee>}>
            <Route index element={<Accueil />} />
            <Route path="eleves" element={<Protegee roles={[...CHEFS,'comptable','enseignant']}><Eleves /></Protegee>} />
            <Route path="classes" element={<Protegee roles={[...CHEFS,'comptable','enseignant']}><Classes /></Protegee>} />
            <Route path="notes" element={<Notes />} />
            <Route path="vie-scolaire" element={<Protegee roles={[...CHEFS,'enseignant']}><VieScolaire /></Protegee>} />
            <Route path="personnel" element={<Protegee roles={[...CHEFS_ETABLISSEMENT,'enseignant']}><Personnel /></Protegee>} />
            <Route path="mon-enfant" element={<Protegee roles={['parent']}><MonEnfant /></Protegee>} />
            <Route path="emploi-du-temps" element={<EmploiDuTemps />} />
            <Route path="finances" element={<Protegee roles={['admin','comptable']}><Finances /></Protegee>} />
            <Route path="communication" element={<Communication />} />
            <Route path="bibliotheque" element={<Protegee roles={CHEFS}><Bibliotheque /></Protegee>} />
            <Route path="transport" element={<Protegee roles={CHEFS}><Transport /></Protegee>} />
            <Route path="utilisateurs" element={<Protegee roles={['admin']}><Utilisateurs /></Protegee>} />
            <Route path="parametres" element={<Protegee roles={['admin']}><Parametres /></Protegee>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
