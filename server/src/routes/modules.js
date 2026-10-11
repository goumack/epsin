import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';

const router = Router();
router.use(authentifier);

// ============ Bibliotheque ============
router.get('/livres', async (req, res, next) => {
  try {
    const { recherche = '' } = req.query;
    const { rows } = await query(
      `SELECT * FROM livre
       WHERE ($1 = '' OR titre ILIKE $2 OR auteur ILIKE $2 OR isbn ILIKE $2)
       ORDER BY titre LIMIT 200`,
      [recherche, `%${recherche}%`]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/livres', autoriser('admin', 'censeur'), async (req, res, next) => {
  try {
    const { titre, auteur, isbn, categorie, exemplaires = 1 } = req.body;
    if (!titre) return res.status(400).json({ erreur: 'Titre requis' });
    const { rows } = await query(
      `INSERT INTO livre (titre, auteur, isbn, categorie, exemplaires, disponibles)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [titre, auteur || null, isbn || null, categorie || null, exemplaires]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/emprunts', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT em.*, l.titre, l.auteur, e.matricule, e.prenom, e.nom,
              (em.date_retour_reel IS NULL AND em.date_retour_prevu < CURRENT_DATE) AS en_retard
       FROM emprunt em
       JOIN livre l ON l.id = em.livre_id
       JOIN eleve e ON e.id = em.eleve_id
       ORDER BY em.date_emprunt DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/emprunts', autoriser('admin', 'censeur'), async (req, res, next) => {
  try {
    const { livre_id, eleve_id, duree_jours = 14 } = req.body;
    if (!livre_id || !eleve_id) return res.status(400).json({ erreur: 'Livre et eleve requis' });

    const emprunt = await transaction(async (client) => {
      // Verrouille la ligne pour eviter deux emprunts simultanes du dernier exemplaire
      const { rows: lv } = await client.query(
        `SELECT disponibles FROM livre WHERE id = $1 FOR UPDATE`, [livre_id]
      );
      if (!lv[0]) throw Object.assign(new Error('Livre introuvable'), { status: 404 });
      if (lv[0].disponibles < 1) {
        throw Object.assign(new Error('Aucun exemplaire disponible'), { status: 400 });
      }
      await client.query(`UPDATE livre SET disponibles = disponibles - 1 WHERE id = $1`, [livre_id]);
      const { rows } = await client.query(
        `INSERT INTO emprunt (livre_id, eleve_id, date_retour_prevu)
         VALUES ($1,$2,CURRENT_DATE + ($3 || ' days')::interval) RETURNING *`,
        [livre_id, eleve_id, duree_jours]
      );
      return rows[0];
    });
    res.status(201).json(emprunt);
  } catch (err) { next(err); }
});

router.patch('/emprunts/:id/retour', autoriser('admin', 'censeur'), async (req, res, next) => {
  try {
    const resultat = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE emprunt SET date_retour_reel = CURRENT_DATE
         WHERE id = $1 AND date_retour_reel IS NULL RETURNING *`,
        [req.params.id]
      );
      if (!rows[0]) throw Object.assign(new Error('Emprunt introuvable ou deja rendu'), { status: 404 });
      await client.query(
        `UPDATE livre SET disponibles = LEAST(disponibles + 1, exemplaires) WHERE id = $1`,
        [rows[0].livre_id]
      );
      return rows[0];
    });
    res.json({ message: 'Retour enregistre', emprunt: resultat });
  } catch (err) { next(err); }
});

// ============ Transport ============
router.get('/bus', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*, COUNT(te.eleve_id)::int AS inscrits FROM bus b
       LEFT JOIN transport_eleve te ON te.bus_id = b.id
       GROUP BY b.id ORDER BY b.immatriculation`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/bus', autoriser('admin'), async (req, res, next) => {
  try {
    const { immatriculation, chauffeur, telephone, capacite, itineraire } = req.body;
    if (!immatriculation) return res.status(400).json({ erreur: 'Immatriculation requise' });
    const { rows } = await query(
      `INSERT INTO bus (immatriculation, chauffeur, telephone, capacite, itineraire)
       VALUES ($1,$2,$3,COALESCE($4,30),$5) RETURNING *`,
      [immatriculation, chauffeur || null, telephone || null, capacite, itineraire || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/bus/:id/eleves', autoriser('admin', 'censeur'), async (req, res, next) => {
  try {
    const { eleve_id, arret } = req.body;
    await query(
      `INSERT INTO transport_eleve (eleve_id, bus_id, arret) VALUES ($1,$2,$3)
       ON CONFLICT (eleve_id, bus_id) DO UPDATE SET arret = EXCLUDED.arret`,
      [eleve_id, req.params.id, arret || null]
    );
    res.status(201).json({ message: 'Eleve rattache au bus' });
  } catch (err) { next(err); }
});

// ============ Utilisateurs ============
router.get('/utilisateurs', autoriser('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, telephone, role, prenom, nom, photo_url, actif, derniere_connexion, cree_le
       FROM utilisateur ORDER BY role, nom`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/utilisateurs', autoriser('admin'), async (req, res, next) => {
  try {
    const { email, telephone, mot_de_passe, role, prenom, nom, specialite } = req.body;
    if (!role || !prenom || !nom || !mot_de_passe) {
      return res.status(400).json({ erreur: 'Role, prenom, nom et mot de passe requis' });
    }
    if (!email && !telephone) {
      return res.status(400).json({ erreur: 'Email ou telephone requis' });
    }
    if (mot_de_passe.length < 8) {
      return res.status(400).json({ erreur: 'Mot de passe : 8 caracteres minimum' });
    }

    const cree = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO utilisateur (email, telephone, mot_de_passe, role, prenom, nom)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, email, telephone, role, prenom, nom, actif`,
        [email?.toLowerCase() || null, telephone || null,
         await bcrypt.hash(mot_de_passe, 10), role, prenom, nom]
      );
      // Un enseignant a une fiche dediee
      if (role === 'enseignant') {
        await client.query(
          `INSERT INTO enseignant (utilisateur_id, specialite) VALUES ($1,$2)`,
          [rows[0].id, specialite || null]
        );
      }
      return rows[0];
    });

    await tracer(req, 'creation', 'utilisateur', cree.id, { role });
    res.status(201).json(cree);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ erreur: 'Cet email ou telephone est deja utilise' });
    }
    next(err);
  }
});

router.patch('/utilisateurs/:id/actif', autoriser('admin'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ erreur: 'Vous ne pouvez pas desactiver votre propre compte' });
    }
    const { rows } = await query(
      `UPDATE utilisateur SET actif = NOT actif WHERE id = $1
       RETURNING id, prenom, nom, actif`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
    await tracer(req, rows[0].actif ? 'activation' : 'desactivation', 'utilisateur', rows[0].id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/utilisateurs/:id/reinitialiser', autoriser('admin'), async (req, res, next) => {
  try {
    const nouveau = req.body.mot_de_passe;
    if (!nouveau || nouveau.length < 8) {
      return res.status(400).json({ erreur: 'Mot de passe : 8 caracteres minimum' });
    }
    // Mot de passe connu de l administrateur : a changer a la connexion
    await query(`UPDATE utilisateur SET mot_de_passe = $1, doit_changer_mdp = true WHERE id = $2`,
      [await bcrypt.hash(nouveau, 10), req.params.id]);
    await tracer(req, 'reinitialisation_mot_de_passe', 'utilisateur', Number(req.params.id));
    res.json({ message: 'Mot de passe reinitialise' });
  } catch (err) { next(err); }
});

// ============ Parametres etablissement ============
router.get('/etablissement', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM etablissement ORDER BY id LIMIT 1`);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.put('/etablissement', autoriser('admin'), async (req, res, next) => {
  try {
    const { nom, sigle, adresse, telephone, email, devise, bareme } = req.body;
    const { rows: ex } = await query(`SELECT id FROM etablissement ORDER BY id LIMIT 1`);
    const sql = ex[0]
      ? `UPDATE etablissement SET nom=$1, sigle=$2, adresse=$3, telephone=$4, email=$5,
           devise=COALESCE($6,'FCFA'), bareme=COALESCE($7,20) WHERE id=$8 RETURNING *`
      : `INSERT INTO etablissement (nom, sigle, adresse, telephone, email, devise, bareme)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'FCFA'),COALESCE($7,20)) RETURNING *`;
    const params = [nom, sigle || null, adresse || null, telephone || null, email || null, devise, bareme];
    if (ex[0]) params.push(ex[0].id);

    const { rows } = await query(sql, params);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ============ Journal d audit ============
router.get('/audit', autoriser('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT j.*, u.prenom, u.nom, u.role FROM journal_audit j
       LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
       ORDER BY j.cree_le DESC LIMIT 200`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
