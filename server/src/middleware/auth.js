import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';

/**
 * Secret de signature des jetons.
 *
 * En production, un secret par defaut serait une faille beante : il est
 * public, donc n importe qui pourrait forger un jeton d administrateur.
 * On refuse donc de demarrer sans JWT_SECRET hors developpement.
 */
const SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error(
          'JWT_SECRET est obligatoire en production. '
          + 'Definissez-le dans les variables d environnement.'
        );
      })()
    : 'epsin-dev-secret-a-changer');

export function signerToken(utilisateur) {
  return jwt.sign(
    { id: utilisateur.id, role: utilisateur.role },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '12h' }
  );
}

/** Verifie le jeton et charge l utilisateur dans req.user. */
export async function authentifier(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erreur: 'Jeton manquant' });

  try {
    const payload = jwt.verify(token, SECRET);
    const { rows } = await query(
      `SELECT id, email, telephone, role, prenom, nom, photo_url, actif, entite,
              eleve_suivi_id, doit_changer_mdp
       FROM utilisateur WHERE id = $1`,
      [payload.id]
    );
    if (!rows[0] || !rows[0].actif) {
      return res.status(401).json({ erreur: 'Compte introuvable ou desactive' });
    }
    // Mot de passe temporaire (fiche d acces, reinitialisation) : tant qu il
    // n est pas remplace, le compte ne sert qu a le changer. Applique ici,
    // cote serveur, pour qu un appel direct a l API soit refuse aussi.
    if (rows[0].doit_changer_mdp && !req.originalUrl.startsWith('/api/auth/')) {
      return res.status(403).json({
        erreur: 'Choisissez d abord votre mot de passe personnel',
        code: 'MOT_DE_PASSE_A_CHANGER',
      });
    }
    // Serveur en ligne en mode copie : le personnel travaille sur le poste
    // de l ecole, qui fait foi. En ligne, il consulte seulement ; seuls les
    // parents y agissent (paiement Wave, absence signalee, messages).
    if (process.env.EPSIN_MODE === 'replique' && rows[0].role !== 'parent'
        && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.originalUrl.startsWith('/api/auth/')) {
      return res.status(403).json({
        erreur: 'Le site en ligne est en consultation pour le personnel : '
          + 'faites cette operation sur le poste de l ecole, elle sera synchronisee.',
        code: 'SERVEUR_EN_COPIE',
      });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ erreur: 'Jeton invalide ou expire' });
  }
}

/** Restreint l acces a certains roles. */
export function autoriser(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ erreur: 'Non authentifie' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ erreur: 'Acces refuse pour votre role' });
    }
    next();
  };
}

/** Trace une action dans le journal d audit. */
export async function tracer(req, action, entite, entiteId, details = null) {
  try {
    await query(
      `INSERT INTO journal_audit (utilisateur_id, action, entite, entite_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user?.id ?? null, action, entite, entiteId, details, req.ip]
    );
  } catch (err) {
    console.error('[audit] echec de journalisation', err.message);
  }
}
