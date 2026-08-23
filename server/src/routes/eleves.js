import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { entiteDe, accesAutorise, GESTION_SCOLAIRE } from '../middleware/entite.js';
import { filtreClassesEnseignant, estEnseignant, accesClasse } from '../middleware/portee-enseignant.js';
import { eleveSuivi, verifierEleveTuteur } from '../middleware/portee-tuteur.js';

const router = Router();
router.use(authentifier);

const GESTION = GESTION_SCOLAIRE;

/** Entite d un eleve, deduite de sa classe d inscription (null si non inscrit). */
async function entiteEleve(eleveId) {
  const { rows } = await query(
    `SELECT n.entite FROM inscription i
     JOIN classe c ON c.id = i.classe_id
     JOIN niveau n ON n.id = c.niveau_id
     WHERE i.eleve_id = $1
       AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
    [eleveId]
  );
  return rows[0]?.entite ?? null;
}

/**
 * Vrai si un enseignant peut consulter cet eleve : il faut qu il intervienne
 * dans la classe ou l eleve est inscrit. Les autres roles ne sont pas
 * concernes (leur perimetre est deja fixe par l entite).
 */
async function enseignantVoitEleve(req, eleveId) {
  if (!estEnseignant(req.user)) return true;
  const { rows } = await query(
    `SELECT i.classe_id FROM inscription i
     WHERE i.eleve_id = $1
       AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
    [eleveId]
  );
  if (!rows[0]) return false;
  return accesClasse(req.user, rows[0].classe_id);
}

const schemaEleve = z.object({
  prenom: z.string().min(1),
  nom: z.string().min(1),
  sexe: z.enum(['M', 'F']).optional().nullable(),
  date_naissance: z.string().optional().nullable(),
  lieu_naissance: z.string().optional().nullable(),
  nationalite: z.string().optional().nullable(),
  adresse: z.string().optional().nullable(),
  classe_id: z.coerce.number().int().optional().nullable(),
  tuteurs: z.array(z.object({
    prenom: z.string().min(1),
    nom: z.string().min(1),
    telephone: z.string().min(1),
    email: z.string().email().optional().nullable(),
    profession: z.string().optional().nullable(),
    lien: z.string().default('tuteur'),
    principal: z.boolean().default(false),
  })).optional().default([]),
});

/** Genere un matricule du type EP-2026-0042. */
async function genererMatricule(client) {
  const annee = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM eleve WHERE matricule LIKE $1`,
    [`EP-${annee}-%`]
  );
  return `EP-${annee}-${String(rows[0].n + 1).padStart(4, '0')}`;
}

// Liste paginee avec recherche et filtre par classe
router.get('/', async (req, res, next) => {
  try {
    const { recherche = '', classe_id, statut = 'actif', page = 1, taille = 25 } = req.query;
    const limite = Math.min(Number(taille) || 25, 100);
    const decalage = (Math.max(Number(page) || 1, 1) - 1) * limite;

    const conditions = ['e.statut = $1'];
    const params = [statut];

    if (recherche.trim()) {
      params.push(`%${recherche.trim()}%`);
      conditions.push(`(e.nom ILIKE $${params.length} OR e.prenom ILIKE $${params.length} OR e.matricule ILIKE $${params.length})`);
    }
    if (classe_id) {
      params.push(Number(classe_id));
      conditions.push(`i.classe_id = $${params.length}`);
    }
    // Cloisonnement : un directeur ne voit que les eleves de l elementaire
    const entite = entiteDe(req.user);
    if (entite) {
      params.push(entite);
      conditions.push(`n.entite = $${params.length}`);
    }
    // Un enseignant ne voit que les eleves de SES classes : un maitre ceux de
    // sa classe, un professeur ceux des classes ou il intervient.
    const portee = await filtreClassesEnseignant(req.user, 'c', params.length + 1);
    if (portee.clause) {
      params.push(...portee.params);
      conditions.push(portee.clause);
    }
    // Un tuteur ne voit que son propre enfant
    const suivi = eleveSuivi(req.user);
    if (suivi != null) {
      params.push(suivi);
      conditions.push(`e.id = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT e.*, c.libelle AS classe, c.id AS classe_id, n.entite,
             COUNT(*) OVER()::int AS total
      FROM eleve e
      LEFT JOIN inscription i ON i.eleve_id = e.id
        AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
      LEFT JOIN classe c ON c.id = i.classe_id
      LEFT JOIN niveau n ON n.id = c.niveau_id
      ${where}
      ORDER BY e.nom, e.prenom
      LIMIT ${limite} OFFSET ${decalage}`;

    const { rows } = await query(sql, params);
    res.json({
      donnees: rows.map(({ total, ...r }) => r),
      total: rows[0]?.total ?? 0,
      page: Number(page),
      taille: limite,
    });
  } catch (err) { next(err); }
});

// Fiche complete d un eleve
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*, c.libelle AS classe, c.id AS classe_id, n.libelle AS niveau
       FROM eleve e
       LEFT JOIN inscription i ON i.eleve_id = e.id
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       LEFT JOIN classe c ON c.id = i.classe_id
       LEFT JOIN niveau n ON n.id = c.niveau_id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Eleve introuvable' });

    // Un chef d entite ne consulte pas la fiche d un eleve de l autre entite
    if (!accesAutorise(req.user, await entiteEleve(req.params.id))) {
      return res.status(403).json({ erreur: "Cet élève ne relève pas de votre entité" });
    }
    if (!(await enseignantVoitEleve(req, req.params.id))) {
      return res.status(403).json({ erreur: "Cet élève n'est pas dans vos classes" });
    }
    const controleTuteur = verifierEleveTuteur(req.user, req.params.id);
    if (!controleTuteur.ok) {
      return res.status(controleTuteur.code).json({ erreur: controleTuteur.message });
    }

    const tuteurs = await query(
      `SELECT t.*, et.lien, et.principal FROM tuteur t
       JOIN eleve_tuteur et ON et.tuteur_id = t.id WHERE et.eleve_id = $1`,
      [req.params.id]
    );
    res.json({ ...rows[0], tuteurs: tuteurs.rows });
  } catch (err) { next(err); }
});

// Creation : eleve + tuteurs + inscription, le tout dans une transaction
router.post('/', autoriser(...GESTION), async (req, res, next) => {
  try {
    const parsed = schemaEleve.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0].message });
    }
    const { tuteurs, classe_id, ...eleve } = parsed.data;

    // Inscrire directement dans une classe suppose qu elle releve de l entite
    if (classe_id) {
      const { rows: cl } = await query(
        `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
        [classe_id]
      );
      if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
      if (!accesAutorise(req.user, cl[0].entite)) {
        return res.status(403).json({ erreur: "Cette classe ne relève pas de votre entité" });
      }
    }

    const cree = await transaction(async (client) => {
      const matricule = await genererMatricule(client);
      const { rows } = await client.query(
        `INSERT INTO eleve (matricule, prenom, nom, sexe, date_naissance,
                            lieu_naissance, nationalite, adresse)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [matricule, eleve.prenom, eleve.nom, eleve.sexe || null,
         eleve.date_naissance || null, eleve.lieu_naissance || null,
         eleve.nationalite || null, eleve.adresse || null]
      );
      const nouvel = rows[0];

      for (const t of tuteurs) {
        const { rows: tr } = await client.query(
          `INSERT INTO tuteur (prenom, nom, telephone, email, profession)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [t.prenom, t.nom, t.telephone, t.email || null, t.profession || null]
        );
        await client.query(
          `INSERT INTO eleve_tuteur (eleve_id, tuteur_id, lien, principal)
           VALUES ($1,$2,$3,$4)`,
          [nouvel.id, tr[0].id, t.lien, t.principal]
        );
      }

      if (classe_id) {
        const { rows: ar } = await client.query(
          `SELECT id FROM annee_scolaire WHERE active LIMIT 1`
        );
        if (!ar[0]) throw Object.assign(new Error('Aucune annee scolaire active'), { status: 400 });
        await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES ($1,$2,$3)`,
          [nouvel.id, classe_id, ar[0].id]
        );
      }
      return nouvel;
    });

    await tracer(req, 'creation', 'eleve', cree.id, { matricule: cree.matricule });
    res.status(201).json(cree);
  } catch (err) { next(err); }
});

router.put('/:id', autoriser(...GESTION), async (req, res, next) => {
  try {
    const parsed = schemaEleve.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0].message });
    }
    const champs = ['prenom', 'nom', 'sexe', 'date_naissance', 'lieu_naissance',
                    'nationalite', 'adresse', 'statut'];
    const maj = champs.filter((c) => req.body[c] !== undefined);
    if (!maj.length) return res.status(400).json({ erreur: 'Aucun champ a modifier' });

    const set = maj.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE eleve SET ${set} WHERE id = $1 RETURNING *`,
      [req.params.id, ...maj.map((c) => req.body[c] || null)]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Eleve introuvable' });

    await tracer(req, 'modification', 'eleve', rows[0].id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Changement de classe (reaffectation)
router.post('/:id/affecter', autoriser(...GESTION), async (req, res, next) => {
  try {
    const { classe_id } = req.body;
    const { rows: ar } = await query(`SELECT id FROM annee_scolaire WHERE active LIMIT 1`);
    if (!ar[0]) return res.status(400).json({ erreur: 'Aucune annee scolaire active' });

    // La classe cible doit relever de l entite du demandeur
    const { rows: cl } = await query(
      `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
      [classe_id]
    );
    if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });
    if (!accesAutorise(req.user, cl[0].entite)) {
      return res.status(403).json({ erreur: "Cette classe ne relève pas de votre entité" });
    }

    await query(
      `INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES ($1,$2,$3)
       ON CONFLICT (eleve_id, annee_id) DO UPDATE SET classe_id = EXCLUDED.classe_id`,
      [req.params.id, classe_id, ar[0].id]
    );
    await tracer(req, 'affectation', 'eleve', Number(req.params.id), { classe_id });
    res.json({ message: 'Eleve affecte a la classe' });
  } catch (err) { next(err); }
});

/**
 * Marque un eleve comme redoublant pour l annee en cours.
 * L information figure en en-tete du bulletin officiel (« Classe Redoublée »).
 */
router.patch('/:id/redoublant', autoriser(...GESTION), async (req, res, next) => {
  try {
    if (!accesAutorise(req.user, await entiteEleve(req.params.id))) {
      return res.status(403).json({ erreur: "Cet élève ne relève pas de votre entité" });
    }
    const { redoublant } = req.body;
    const { rows } = await query(
      `UPDATE inscription SET redoublant = $2
       WHERE eleve_id = $1
         AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
       RETURNING eleve_id, redoublant`,
      [req.params.id, Boolean(redoublant)]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Eleve non inscrit cette annee' });
    await tracer(req, 'statut_redoublant', 'eleve', Number(req.params.id), { redoublant });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Suppression logique : on conserve l historique scolaire
router.delete('/:id', autoriser('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE eleve SET statut = 'archive' WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Eleve introuvable' });
    await tracer(req, 'archivage', 'eleve', rows[0].id);
    res.json({ message: 'Eleve archive' });
  } catch (err) { next(err); }
});

export default router;
