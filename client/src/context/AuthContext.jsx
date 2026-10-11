import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { get, post, ecrireJeton, lireJeton } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [utilisateur, setUtilisateur] = useState(null);
  const [chargement, setChargement] = useState(true);

  // Au montage : on revalide le jeton stocke aupres du serveur
  useEffect(() => {
    let annule = false;
    (async () => {
      if (!lireJeton()) { setChargement(false); return; }
      try {
        const { utilisateur: u } = await get('/auth/moi');
        if (!annule) setUtilisateur(u);
      } catch {
        ecrireJeton(null);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const connexion = useCallback(async (identifiant, mot_de_passe) => {
    const { token, utilisateur: u } = await post('/auth/connexion', { identifiant, mot_de_passe });
    ecrireJeton(token);
    setUtilisateur(u);
    return u;
  }, []);

  /** Relit le compte (apres un changement de mot de passe, par exemple). */
  const rafraichir = useCallback(async () => {
    const { utilisateur: u } = await get('/auth/moi');
    setUtilisateur(u);
    return u;
  }, []);

  const deconnexion = useCallback(() => {
    ecrireJeton(null);
    setUtilisateur(null);
  }, []);

  /** Verifie si l utilisateur possede l un des roles demandes. */
  const aRole = useCallback(
    (...roles) => !!utilisateur && roles.includes(utilisateur.role),
    [utilisateur]
  );

  return (
    <AuthContext.Provider value={{ utilisateur, chargement, connexion, deconnexion, rafraichir, aRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre utilise dans un AuthProvider');
  return ctx;
}
