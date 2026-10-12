import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, query } from '../db/pool.js';
import { authentifier, autoriser } from '../middleware/auth.js';
import {
  lireChangements, appliquerChangements, instantane,
} from '../sync/noyau.js';
import { synchroniser, statutSynchro, distantHttp } from '../sync/poste.js';

/**
 * Cote SERVEUR EN LIGNE : points d entree reserves au poste de l ecole,
 * proteges par un jeton secret partage (SYNC_JETON), sans compte
 * utilisateur.
 */
export const routesServeur = Router();

routesServeur.use((req, res, next) => {
  const attendu = process.env.SYNC_JETON || '';
  const recu = String(req.get('x-sync-jeton') || '');
  const valide = attendu.length >= 16 && recu.length === attendu.length
    && crypto.timingSafeEqual(Buffer.from(recu), Buffer.from(attendu));
  if (!valide) return res.status(401).json({ erreur: 'Jeton de synchronisation invalide' });
  next();
});

/** Copie complete, pour le premier lancement du poste. */
routesServeur.get('/instantane', async (req, res, next) => {
  try { res.json(await instantane(pool)); } catch (err) { next(err); }
});

/**
 * Modifications faites en ligne depuis `depuis`. Ce qui precede a deja ete
 * recu par le poste : on l efface du journal.
 */
routesServeur.get('/reception', async (req, res, next) => {
  try {
    const depuis = Number(req.query.depuis) || 0;
    if (depuis > 0) await query(`DELETE FROM sync_journal WHERE id <= $1`, [depuis]);
    res.json(await lireChangements(pool, depuis));
  } catch (err) { next(err); }
});

/** Modifications faites sur le poste pendant une coupure : appliquees telles quelles. */
routesServeur.post('/envoi', async (req, res, next) => {
  try {
    const changements = Array.isArray(req.body?.changements) ? req.body.changements : [];
    res.json({ appliques: await appliquerChangements(pool, changements) });
  } catch (err) { next(err); }
});

/**
 * Cote POSTE DE L ECOLE : etat de la synchronisation, et synchronisation
 * immediate a la demande.
 */
export const routesPoste = Router();
routesPoste.use(authentifier);

routesPoste.get('/statut', async (req, res, next) => {
  try {
    res.json({ mode: 'poste', ...(await statutSynchro(pool)) });
  } catch (err) { next(err); }
});

routesPoste.post('/maintenant', autoriser('admin', 'comptable', 'directeur', 'proviseur', 'censeur'),
  async (req, res, next) => {
    try {
      if (!process.env.SYNC_URL || !process.env.SYNC_JETON) {
        return res.status(400).json({ erreur: 'Synchronisation non configuree sur ce poste' });
      }
      const r = await synchroniser(pool, distantHttp(process.env.SYNC_URL, process.env.SYNC_JETON));
      res.json({ ...r, ...(await statutSynchro(pool)) });
    } catch (err) {
      res.status(503).json({ erreur: `Serveur en ligne injoignable : ${err.message}` });
    }
  });
