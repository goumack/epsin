import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { signerToken, authentifier, tracer } from '../middleware/auth.js';

const router = Router();

const schemaConnexion = z.object({
  identifiant: z.string().min(1, 'Identifiant requis'),
  mot_de_passe: z.string().min(1, 'Mot de passe requis'),
});

router.post('/connexion', async (req, res, next) => {
  try {
    const parsed = schemaConnexion.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0].message });
    }
    const { identifiant, mot_de_passe } = parsed.data;

    const { rows } = await query(
      `SELECT * FROM utilisateur WHERE email = $1 OR telephone = $1`,
      [identifiant.trim().toLowerCase()]
    );
    const u = rows[0];
    // Message identique dans les deux cas : on ne revele pas si le compte existe.
    if (!u || !(await bcrypt.compare(mot_de_passe, u.mot_de_passe))) {
      return res.status(401).json({ erreur: 'Identifiants incorrects' });
    }
    if (!u.actif) return res.status(403).json({ erreur: 'Compte desactive' });

    await query(`UPDATE utilisateur SET derniere_connexion = now() WHERE id = $1`, [u.id]);

    delete u.mot_de_passe;
    res.json({ token: signerToken(u), utilisateur: u });
  } catch (err) { next(err); }
});

router.get('/moi', authentifier, (req, res) => {
  res.json({ utilisateur: req.user });
});

router.post('/mot-de-passe', authentifier, async (req, res, next) => {
  try {
    const { ancien, nouveau } = req.body;
    if (!nouveau || nouveau.length < 8) {
      return res.status(400).json({ erreur: 'Le nouveau mot de passe doit faire au moins 8 caracteres' });
    }
    const { rows } = await query(`SELECT mot_de_passe FROM utilisateur WHERE id = $1`, [req.user.id]);
    if (!(await bcrypt.compare(ancien || '', rows[0].mot_de_passe))) {
      return res.status(400).json({ erreur: 'Ancien mot de passe incorrect' });
    }
    // Garder le mot de passe de la fiche reviendrait a le laisser connu de
    // quiconque a vu la fiche
    if (nouveau === ancien) {
      return res.status(400).json({ erreur: 'Le nouveau mot de passe doit etre different de l ancien' });
    }
    // Le compte redevient pleinement utilisable
    await query(
      `UPDATE utilisateur SET mot_de_passe = $1, doit_changer_mdp = false WHERE id = $2`,
      [await bcrypt.hash(nouveau, 10), req.user.id]
    );
    await tracer(req, 'changement_mot_de_passe', 'utilisateur', req.user.id);
    res.json({ message: 'Mot de passe mis a jour' });
  } catch (err) { next(err); }
});

export default router;
