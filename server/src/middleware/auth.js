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
              eleve_suivi_id
       FROM utilisateur WHERE id = $1`,
      [payload.id]
    );
    if (!rows[0] || !rows[0].actif) {
      return res.status(401).json({ erreur: 'Compte introuvable ou desactive' });
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
