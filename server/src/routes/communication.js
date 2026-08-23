import { Router } from 'express';
import { query } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';

const router = Router();
router.use(authentifier);

// ---------- Annonces ----------
router.get('/annonces', async (req, res, next) => {
  try {
    // Chaque utilisateur ne voit que les annonces qui le concernent
    const cibles = ['tous'];
    if (['eleve'].includes(req.user.role)) cibles.push('eleves');
    if (['parent'].includes(req.user.role)) cibles.push('parents');
    if (['enseignant'].includes(req.user.role)) cibles.push('enseignants');
    const voitTout = ['admin', 'censeur'].includes(req.user.role);

    const { rows } = await query(
      `SELECT a.*, u.prenom, u.nom, c.libelle AS classe
       FROM annonce a
       LEFT JOIN utilisateur u ON u.id = a.auteur_id
       LEFT JOIN classe c ON c.id = a.classe_id
       WHERE $2::boolean OR a.cible = ANY($1)
       ORDER BY a.epingle DESC, a.publie_le DESC LIMIT 50`,
      [cibles, voitTout]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/annonces', autoriser('admin', 'censeur', 'enseignant'), async (req, res, next) => {
  try {
    const { titre, contenu, cible, classe_id, epingle } = req.body;
    if (!titre || !contenu) return res.status(400).json({ erreur: 'Titre et contenu requis' });

    const { rows } = await query(
      `INSERT INTO annonce (titre, contenu, auteur_id, cible, classe_id, epingle)
       VALUES ($1,$2,$3,COALESCE($4,'tous'),$5,COALESCE($6,false)) RETURNING *`,
      [titre, contenu, req.user.id, cible, classe_id || null, epingle]
    );

    // Notification aux destinataires concernes
    await query(
      `INSERT INTO notification (utilisateur_id, type, titre, contenu, lien)
       SELECT u.id, 'annonce', $1, LEFT($2, 120), '/annonces'
       FROM utilisateur u
       WHERE u.actif AND u.id <> $3
         AND ($4 = 'tous'
              OR ($4 = 'enseignants' AND u.role = 'enseignant')
              OR ($4 = 'eleves' AND u.role = 'eleve')
              OR ($4 = 'parents' AND u.role = 'parent'))`,
      [titre, contenu, req.user.id, cible || 'tous']
    );
    await tracer(req, 'publication', 'annonce', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/annonces/:id', autoriser('admin', 'censeur'), async (req, res, next) => {
  try {
    await query(`DELETE FROM annonce WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Annonce supprimee' });
  } catch (err) { next(err); }
});

// ---------- Messagerie ----------
router.get('/messages', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.*,
              ex.prenom AS exp_prenom, ex.nom AS exp_nom, ex.role AS exp_role,
              de.prenom AS dest_prenom, de.nom AS dest_nom
       FROM message m
       JOIN utilisateur ex ON ex.id = m.expediteur_id
       JOIN utilisateur de ON de.id = m.destinataire_id
       WHERE m.destinataire_id = $1 OR m.expediteur_id = $1
       ORDER BY m.envoye_le DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/messages', async (req, res, next) => {
  try {
    const { destinataire_id, objet, contenu } = req.body;
    if (!destinataire_id || !contenu) {
      return res.status(400).json({ erreur: 'Destinataire et contenu requis' });
    }
    const { rows } = await query(
      `INSERT INTO message (expediteur_id, destinataire_id, objet, contenu)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, destinataire_id, objet || null, contenu]
    );
    await query(
      `INSERT INTO notification (utilisateur_id, type, titre, contenu, lien)
       VALUES ($1,'message',$2,LEFT($3,120),'/messages')`,
      [destinataire_id, `Message de ${req.user.prenom} ${req.user.nom}`, contenu]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/messages/:id/lu', async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE message SET lu = true WHERE id = $1 AND destinataire_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Message introuvable' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Annuaire pour choisir un destinataire
router.get('/contacts', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, prenom, nom, role, photo_url FROM utilisateur
       WHERE actif AND id <> $1 ORDER BY role, nom LIMIT 300`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- Notifications ----------
router.get('/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM notification WHERE utilisateur_id = $1
       ORDER BY cree_le DESC LIMIT 50`,
      [req.user.id]
    );
    const { rows: nl } = await query(
      `SELECT COUNT(*)::int AS n FROM notification WHERE utilisateur_id = $1 AND NOT lu`,
      [req.user.id]
    );
    res.json({ notifications: rows, non_lues: nl[0].n });
  } catch (err) { next(err); }
});

router.patch('/notifications/tout-lu', async (req, res, next) => {
  try {
    await query(`UPDATE notification SET lu = true WHERE utilisateur_id = $1 AND NOT lu`, [req.user.id]);
    res.json({ message: 'Notifications marquees comme lues' });
  } catch (err) { next(err); }
});

export default router;
