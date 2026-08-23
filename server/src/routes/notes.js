import { Router } from 'express';
import { query, transaction } from '../db/pool.js';
import { authentifier, autoriser, tracer } from '../middleware/auth.js';
import { filtreEntite, accesAutorise } from '../middleware/entite.js';
import {
  estEnseignant, accesClasse, voitToutesMatieres, matieresDeLEnseignant,
} from '../middleware/portee-enseignant.js';
import { estTuteur, verifierEleveTuteur } from '../middleware/portee-tuteur.js';
import { mentionDe, appreciationDe, propositionsConseil } from '../metier/bareme.js';

const router = Router();
router.use(authentifier);

const SAISIE = ['admin', 'censeur', 'directeur', 'proviseur', 'enseignant'];

/** Refuse l acces si la classe ne releve pas de l entite du demandeur. */
async function verifierClasse(req, classeId) {
  const { rows } = await query(
    `SELECT n.entite FROM classe c JOIN niveau n ON n.id = c.niveau_id WHERE c.id = $1`,
    [classeId]
  );
  if (!rows[0]) return { ok: false, code: 404, message: 'Classe introuvable' };
  if (!accesAutorise(req.user, rows[0].entite)) {
    return { ok: false, code: 403, message: 'Cette classe ne relève pas de votre entité' };
  }
  // Un enseignant n accede qu aux classes ou il intervient
  if (estEnseignant(req.user) && !(await accesClasse(req.user, classeId))) {
    return { ok: false, code: 403, message: 'Vous n enseignez pas dans cette classe' };
  }
  return { ok: true };
}

// ---------- Evaluations ----------
router.get('/evaluations', async (req, res, next) => {
  try {
    const { classe_id, matiere_id, periode_id } = req.query;
    const conditions = [];
    const params = [];
    for (const [col, val] of [['e.classe_id', classe_id], ['e.matiere_id', matiere_id], ['e.periode_id', periode_id]]) {
      if (val) { params.push(Number(val)); conditions.push(`${col} = $${params.length}`); }
    }
    // Cloisonnement par entite
    const { clause, params: pe } = filtreEntite(req.user, 'niv', params.length + 1);
    if (clause) { params.push(...pe); conditions.push(clause); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT e.*, m.libelle AS matiere, c.libelle AS classe, p.libelle AS periode,
              (SELECT COUNT(*)::int FROM note n WHERE n.evaluation_id = e.id) AS nb_notes
       FROM evaluation e
       JOIN matiere m ON m.id = e.matiere_id
       JOIN classe c ON c.id = e.classe_id
       JOIN niveau niv ON niv.id = c.niveau_id
       JOIN periode p ON p.id = e.periode_id
       ${where} ORDER BY e.date_eval DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/evaluations', autoriser(...SAISIE), async (req, res, next) => {
  try {
    const { classe_id, matiere_id, periode_id, type, libelle, date_eval, bareme, coefficient } = req.body;
    if (!classe_id || !matiere_id || !periode_id || !libelle) {
      return res.status(400).json({ erreur: 'Classe, matiere, periode et libelle sont requis' });
    }
    const controle = await verifierClasse(req, classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });
    const { rows: pr } = await query(`SELECT cloturee FROM periode WHERE id = $1`, [periode_id]);
    if (!pr[0]) return res.status(404).json({ erreur: 'Periode introuvable' });
    if (pr[0].cloturee) return res.status(400).json({ erreur: 'Cette periode est cloturee' });

    const { rows } = await query(
      `INSERT INTO evaluation (classe_id, matiere_id, periode_id, enseignant_id,
                               type, libelle, date_eval, bareme, coefficient)
       VALUES ($1,$2,$3,(SELECT id FROM enseignant WHERE utilisateur_id = $4),
               $5,$6,COALESCE($7, CURRENT_DATE),COALESCE($8,20),COALESCE($9,1))
       RETURNING *`,
      [classe_id, matiere_id, periode_id, req.user.id, type || 'devoir',
       libelle, date_eval || null, bareme || null, coefficient || null]
    );
    await tracer(req, 'creation', 'evaluation', rows[0].id);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Feuille de saisie : tous les eleves de la classe avec leur note eventuelle
router.get('/evaluations/:id/feuille', async (req, res, next) => {
  try {
    const { rows: ev } = await query(
      `SELECT e.*, m.libelle AS matiere, c.libelle AS classe
       FROM evaluation e JOIN matiere m ON m.id = e.matiere_id
       JOIN classe c ON c.id = e.classe_id WHERE e.id = $1`,
      [req.params.id]
    );
    if (!ev[0]) return res.status(404).json({ erreur: 'Evaluation introuvable' });

    const controle = await verifierClasse(req, ev[0].classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows } = await query(
      `SELECT el.id AS eleve_id, el.matricule, el.prenom, el.nom,
              n.id AS note_id, n.valeur, n.appreciation
       FROM inscription i
       JOIN eleve el ON el.id = i.eleve_id
       LEFT JOIN note n ON n.eleve_id = el.id AND n.evaluation_id = $1
       WHERE i.classe_id = $2 AND el.statut = 'actif'
       ORDER BY el.nom, el.prenom`,
      [req.params.id, ev[0].classe_id]
    );
    res.json({ evaluation: ev[0], eleves: rows });
  } catch (err) { next(err); }
});

// Saisie en lot des notes d une evaluation
router.post('/evaluations/:id/notes', autoriser(...SAISIE), async (req, res, next) => {
  try {
    const { notes } = req.body; // [{ eleve_id, valeur, appreciation }]
    if (!Array.isArray(notes)) {
      return res.status(400).json({ erreur: 'Le champ notes doit etre un tableau' });
    }
    const { rows: ev } = await query(
      `SELECT bareme, classe_id FROM evaluation WHERE id = $1`, [req.params.id]
    );
    if (!ev[0]) return res.status(404).json({ erreur: 'Evaluation introuvable' });

    const controle = await verifierClasse(req, ev[0].classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const hors = notes.find((n) => n.valeur != null && (n.valeur < 0 || n.valeur > ev[0].bareme));
    if (hors) {
      return res.status(400).json({ erreur: `Note hors bareme (0 a ${ev[0].bareme})` });
    }

    await transaction(async (client) => {
      for (const n of notes) {
        await client.query(
          `INSERT INTO note (evaluation_id, eleve_id, valeur, appreciation)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (evaluation_id, eleve_id)
           DO UPDATE SET valeur = EXCLUDED.valeur,
                         appreciation = EXCLUDED.appreciation,
                         saisie_le = now()`,
          [req.params.id, n.eleve_id, n.valeur ?? null, n.appreciation || null]
        );
      }
    });
    await tracer(req, 'saisie_notes', 'evaluation', Number(req.params.id), { nombre: notes.length });
    res.json({ message: `${notes.length} note(s) enregistree(s)` });
  } catch (err) { next(err); }
});

router.patch('/evaluations/:id/publier', autoriser(...SAISIE), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE evaluation SET publiee = COALESCE($2, NOT publiee) WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.publiee ?? null]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Evaluation introuvable' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------- Bulletin ----------
/**
 * Moyenne par matiere = somme(note * coef_eval) / somme(coef_eval)
 * Moyenne generale   = somme(moy_matiere * coef_matiere) / somme(coef_matiere)
 * Les notes NULL (absent) sont exclues du calcul.
 */
router.get('/bulletin/:eleveId/:periodeId', async (req, res, next) => {
  try {
    const { eleveId, periodeId } = req.params;

    const { rows: info } = await query(
      `SELECT e.id, e.matricule, e.prenom, e.nom, e.date_naissance,
              c.id AS classe_id, c.libelle AS classe, n.libelle AS niveau, n.id AS niveau_id,
              n.cycle, n.examen,
              p.libelle AS periode, a.libelle AS annee
       FROM eleve e
       JOIN inscription i ON i.eleve_id = e.id
       JOIN classe c ON c.id = i.classe_id
       JOIN niveau n ON n.id = c.niveau_id
       JOIN periode p ON p.id = $2
       JOIN annee_scolaire a ON a.id = i.annee_id
       WHERE e.id = $1 AND i.annee_id = p.annee_id`,
      [eleveId, periodeId]
    );
    if (!info[0]) return res.status(404).json({ erreur: 'Eleve ou periode introuvable' });
    const eleve = info[0];

    const controle = await verifierClasse(req, eleve.classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    // Un tuteur ne consulte que le bulletin de son propre enfant
    const controleTuteur = verifierEleveTuteur(req.user, eleveId);
    if (!controleTuteur.ok) {
      return res.status(controleTuteur.code).json({ erreur: controleTuteur.message });
    }

    // Le bulletin officiel senegalais separe « Devoir » et « Composition ».
    // Un enseignant pouvant saisir plusieurs devoirs, la colonne Devoir
    // affiche leur moyenne ponderee ; la composition reste distincte.
    const { rows: matieres } = await query(
      `SELECT m.id, m.libelle AS matiere,
              COALESCE(mn.coefficient, 1) AS coefficient,
              ROUND(SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                    / NULLIF(SUM(ev.coefficient), 0), 2) AS moyenne,
              ROUND(SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                      FILTER (WHERE ev.type <> 'composition')
                    / NULLIF(SUM(ev.coefficient) FILTER (WHERE ev.type <> 'composition'), 0), 2)
                AS moyenne_devoir,
              ROUND(SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                      FILTER (WHERE ev.type = 'composition')
                    / NULLIF(SUM(ev.coefficient) FILTER (WHERE ev.type = 'composition'), 0), 2)
                AS moyenne_composition,
              COUNT(n.valeur)::int AS nb_notes
       FROM evaluation ev
       JOIN matiere m ON m.id = ev.matiere_id
       LEFT JOIN matiere_niveau mn ON mn.matiere_id = m.id AND mn.niveau_id = $3
       LEFT JOIN note n ON n.evaluation_id = ev.id AND n.eleve_id = $1 AND n.valeur IS NOT NULL
       WHERE ev.periode_id = $2 AND ev.classe_id = $4
       GROUP BY m.id, m.libelle, mn.coefficient
       HAVING COUNT(n.valeur) > 0
       ORDER BY m.libelle`,
      [eleveId, periodeId, eleve.niveau_id, eleve.classe_id]
    );

    // Rang de l eleve DANS CHAQUE MATIERE, comme l exige le modele officiel.
    const { rows: rangsMatiere } = await query(
      `WITH moy AS (
         SELECT ev.matiere_id, n.eleve_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient), 0) AS m
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         WHERE ev.periode_id = $1 AND ev.classe_id = $2 AND n.valeur IS NOT NULL
         GROUP BY ev.matiere_id, n.eleve_id
       )
       -- Le rang se calcule sur TOUTE la classe, puis on extrait celui de
       -- l eleve : filtrer avant le RANK() donnerait 1 a tout le monde.
       , classees AS (
         SELECT matiere_id, eleve_id,
                RANK() OVER (PARTITION BY matiere_id ORDER BY m DESC) AS rang
         FROM moy
       )
       SELECT matiere_id, rang FROM classees WHERE eleve_id = $3`,
      [periodeId, eleve.classe_id, eleveId]
    );
    const rangParMatiere = Object.fromEntries(
      rangsMatiere.map((r) => [r.matiere_id, Number(r.rang)])
    );
    for (const m of matieres) {
      m.rang = rangParMatiere[m.id] ?? null;
      m.points = Number((Number(m.moyenne) * Number(m.coefficient)).toFixed(2));
      m.appreciation = appreciationDe(m.moyenne);
    }

    // La moyenne generale et le rang se calculent TOUJOURS sur l integralite
    // des matieres : les masquer fausserait le bulletin. Seul l affichage du
    // detail par matiere est restreint ensuite.
    const totalCoef = matieres.reduce((s, m) => s + Number(m.coefficient), 0);
    const totalPoints = matieres.reduce((s, m) => s + Number(m.moyenne) * Number(m.coefficient), 0);
    const moyenne = totalCoef ? Number((totalPoints / totalCoef).toFixed(2)) : null;

    // Rang dans la classe : on recalcule la moyenne generale de chaque eleve
    // de la meme classe (et non de tout l etablissement).
    const { rows: rangs } = await query(
      `WITH moy_matiere AS (
         SELECT n.eleve_id, ev.matiere_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient),0) AS moy,
                COALESCE(mn.coefficient, 1) AS coef
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         LEFT JOIN matiere_niveau mn ON mn.matiere_id = ev.matiere_id AND mn.niveau_id = $2
         WHERE ev.periode_id = $1 AND ev.classe_id = $3 AND n.valeur IS NOT NULL
         GROUP BY n.eleve_id, ev.matiere_id, mn.coefficient
       )
       SELECT eleve_id,
              ROUND(SUM(moy * coef) / NULLIF(SUM(coef),0), 2) AS moyenne
       FROM moy_matiere GROUP BY eleve_id ORDER BY moyenne DESC NULLS LAST`,
      [periodeId, eleve.niveau_id, eleve.classe_id]
    );
    const rang = rangs.findIndex((r) => r.eleve_id === Number(eleveId)) + 1;
    const moyennes = rangs.map((r) => Number(r.moyenne)).filter(Number.isFinite);

    const { rows: abs } = await query(
      `SELECT COUNT(*) FILTER (WHERE type = 'absence')::int AS absences,
              COUNT(*) FILTER (WHERE type = 'retard')::int AS retards,
              COUNT(*) FILTER (WHERE type = 'absence' AND NOT justifiee)::int AS non_justifiees
       FROM absence a
       JOIN periode p ON p.id = $2
       WHERE a.eleve_id = $1 AND a.date_abs BETWEEN p.date_debut AND p.date_fin`,
      [eleveId, periodeId]
    );

    // En-tete administratif du modele officiel : IA, IEF, etablissement
    const { rows: etab } = await query(
      `SELECT nom, sigle, inspection_academie, inspection_ief FROM etablissement LIMIT 1`
    );

    // Effectif de la classe et nombre de redoublants, portes en en-tete
    const { rows: eff } = await query(
      `SELECT COUNT(*)::int AS effectif,
              COUNT(*) FILTER (WHERE i.redoublant)::int AS redoublants
       FROM inscription i
       JOIN eleve e ON e.id = i.eleve_id AND e.statut = 'actif'
       WHERE i.classe_id = $1
         AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
      [eleve.classe_id]
    );

    // Decisions du conseil : celles deja arretees, sinon les propositions
    // calculees d apres la moyenne (le conseil peut les corriger).
    const { rows: conseilRows } = await query(
      `SELECT appreciation, distinction, observations, arrete_le
       FROM conseil_classe WHERE eleve_id = $1 AND periode_id = $2`,
      [eleveId, periodeId]
    );
    const propositions = propositionsConseil(moyenne);
    const conseil = conseilRows[0]
      ? { ...conseilRows[0], arrete: Boolean(conseilRows[0].arrete_le) }
      : { ...propositions, observations: null, arrete: false };

    // Redoublement de l eleve lui-meme
    const { rows: redRow } = await query(
      `SELECT redoublant FROM inscription
       WHERE eleve_id = $1
         AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
      [eleveId]
    );

    // Confidentialite : un enseignant ne voit que les matieres qu il enseigne
    // lui-meme. Deux exceptions ou il voit tout : s il est PROFESSEUR
    // PRINCIPAL de la classe (il presente le conseil de classe), ou s il est
    // le maitre unique d une classe elementaire (il enseigne tous les
    // domaines). La synthese ci-dessus reste calculee sur l integralite.
    let matieresVisibles = matieres;
    let partiel = false;
    if (estEnseignant(req.user) && !(await voitToutesMatieres(req.user, eleve.classe_id))) {
      const siennes = await matieresDeLEnseignant(req.user, eleve.classe_id);
      matieresVisibles = matieres.filter((m) => siennes.includes(m.id));
      partiel = true;
    }

    res.json({
      etablissement: etab[0] || null,
      eleve: {
        ...eleve,
        redoublant: redRow[0]?.redoublant ?? false,
        effectif_classe: eff[0]?.effectif ?? 0,
        redoublants_classe: eff[0]?.redoublants ?? 0,
      },
      conseil,
      matieres: matieresVisibles,
      // Signale au client que le detail est restreint aux matieres de
      // l enseignant, pour qu il puisse l indiquer clairement.
      detail_partiel: partiel,
      synthese: {
        moyenne,
        total_coefficients: totalCoef,
        rang: rang || null,
        effectif: rangs.length,
        moyenne_classe: moyennes.length
          ? Number((moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2))
          : null,
        plus_forte: moyennes.length ? Math.max(...moyennes) : null,
        plus_faible: moyennes.length ? Math.min(...moyennes) : null,
        mention: mentionDe(moyenne),
        ...abs[0],
      },
    });
  } catch (err) { next(err); }
});

/**
 * Feuille de conseil de classe : tous les eleves d une classe avec leur
 * moyenne, leur rang et leurs decisions (arretees ou proposees).
 *
 * Evite d ouvrir 34 dossiers un par un pendant la seance : le conseil
 * parcourt la liste, ajuste ce qui doit l etre et enregistre.
 */
router.get('/conseil/:classeId/:periodeId',
  autoriser('admin', 'censeur', 'directeur', 'proviseur'),
  async (req, res, next) => {
    try {
      const { classeId, periodeId } = req.params;
      const controle = await verifierClasse(req, classeId);
      if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

      const { rows: cl } = await query(
        `SELECT niveau_id FROM classe WHERE id = $1`, [classeId]
      );
      if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });

      // Moyenne generale de chaque eleve, ponderee par les coefficients
      const { rows } = await query(
        `WITH moy_matiere AS (
           SELECT n.eleve_id, ev.matiere_id,
                  SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                    / NULLIF(SUM(ev.coefficient),0) AS moy,
                  COALESCE(mn.coefficient, 1) AS coef
           FROM note n
           JOIN evaluation ev ON ev.id = n.evaluation_id
           LEFT JOIN matiere_niveau mn ON mn.matiere_id = ev.matiere_id AND mn.niveau_id = $3
           WHERE ev.periode_id = $2 AND ev.classe_id = $1 AND n.valeur IS NOT NULL
           GROUP BY n.eleve_id, ev.matiere_id, mn.coefficient
         ),
         generale AS (
           SELECT eleve_id,
                  ROUND(SUM(moy * coef) / NULLIF(SUM(coef),0), 2) AS moyenne
           FROM moy_matiere GROUP BY eleve_id
         )
         SELECT e.id AS eleve_id, e.matricule, e.prenom, e.nom,
                i.redoublant,
                g.moyenne,
                RANK() OVER (ORDER BY g.moyenne DESC NULLS LAST) AS rang,
                cc.appreciation, cc.distinction, cc.observations,
                cc.arrete_le IS NOT NULL AS arrete,
                (SELECT COUNT(*)::int FROM absence a
                 JOIN periode p ON p.id = $2
                 WHERE a.eleve_id = e.id AND a.type = 'absence'
                   AND a.date_abs BETWEEN p.date_debut AND p.date_fin) AS absences
         FROM inscription i
         JOIN eleve e ON e.id = i.eleve_id AND e.statut = 'actif'
         LEFT JOIN generale g ON g.eleve_id = e.id
         LEFT JOIN conseil_classe cc ON cc.eleve_id = e.id AND cc.periode_id = $2
         WHERE i.classe_id = $1
           AND i.annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)
         ORDER BY g.moyenne DESC NULLS LAST, e.nom, e.prenom`,
        [classeId, periodeId, cl[0].niveau_id]
      );

      // Pour les eleves dont le conseil n a pas encore statue, on propose
      // les decisions calculees d apres la moyenne.
      const eleves = rows.map((r) => {
        if (r.arrete) return { ...r, propose: false };
        const p = propositionsConseil(r.moyenne);
        return {
          ...r,
          appreciation: r.appreciation ?? p.appreciation,
          distinction: r.distinction ?? p.distinction,
          propose: true,
        };
      });

      const moyennes = eleves.map((e) => Number(e.moyenne)).filter(Number.isFinite);
      res.json({
        eleves,
        synthese: {
          effectif: eleves.length,
          notes: moyennes.length,
          moyenne_classe: moyennes.length
            ? Number((moyennes.reduce((a, b) => a + b, 0) / moyennes.length).toFixed(2))
            : null,
          admis: moyennes.filter((m) => m >= 10).length,
          arretes: eleves.filter((e) => e.arrete).length,
        },
      });
    } catch (err) { next(err); }
  });

/**
 * Arrete les decisions du conseil de classe pour un eleve et une periode.
 * Reserve a l encadrement : c est le conseil qui tranche, pas l enseignant
 * d une seule matiere.
 */
router.put('/conseil/:eleveId/:periodeId',
  autoriser('admin', 'censeur', 'directeur', 'proviseur'),
  async (req, res, next) => {
    try {
      const { eleveId, periodeId } = req.params;
      const { appreciation, distinction, observations } = req.body;

      // Le cloisonnement d entite s applique via la classe de l eleve
      const { rows: insc } = await query(
        `SELECT classe_id FROM inscription
         WHERE eleve_id = $1
           AND annee_id = (SELECT id FROM annee_scolaire WHERE active LIMIT 1)`,
        [eleveId]
      );
      if (!insc[0]) return res.status(404).json({ erreur: 'Eleve non inscrit' });
      const controle = await verifierClasse(req, insc[0].classe_id);
      if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

      const { rows } = await query(
        `INSERT INTO conseil_classe
           (eleve_id, periode_id, appreciation, distinction, observations,
            arrete_par, arrete_le)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (eleve_id, periode_id) DO UPDATE
           SET appreciation = EXCLUDED.appreciation,
               distinction = EXCLUDED.distinction,
               observations = EXCLUDED.observations,
               arrete_par = EXCLUDED.arrete_par,
               arrete_le = now()
         RETURNING *`,
        [eleveId, periodeId, appreciation || null, distinction || null,
         observations?.trim() || null, req.user.id]
      );
      await tracer(req, 'conseil_classe', 'eleve', Number(eleveId));
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

/**
 * Detail des notes d un eleve sur une periode : chaque evaluation avec sa note,
 * regroupee par matiere. Sert au dossier eleve et au portail parent.
 */
router.get('/eleve/:eleveId/:periodeId', async (req, res, next) => {
  try {
    const { eleveId, periodeId } = req.params;

    const { rows: insc } = await query(
      `SELECT c.id AS classe_id FROM inscription i
       JOIN classe c ON c.id = i.classe_id
       JOIN periode p ON p.id = $2
       WHERE i.eleve_id = $1 AND i.annee_id = p.annee_id`,
      [eleveId, periodeId]
    );
    if (!insc[0]) return res.json([]);

    const controle = await verifierClasse(req, insc[0].classe_id);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const controleTuteur = verifierEleveTuteur(req.user, eleveId);
    if (!controleTuteur.ok) {
      return res.status(controleTuteur.code).json({ erreur: controleTuteur.message });
    }

    const { rows } = await query(
      `SELECT m.id AS matiere_id, m.libelle AS matiere, m.couleur,
              ev.id AS evaluation_id, ev.libelle, ev.type, ev.date_eval,
              ev.bareme, ev.coefficient, n.valeur, n.appreciation
       FROM evaluation ev
       JOIN matiere m ON m.id = ev.matiere_id
       LEFT JOIN note n ON n.evaluation_id = ev.id AND n.eleve_id = $1
       WHERE ev.periode_id = $2 AND ev.classe_id = $3
       ORDER BY m.libelle, ev.date_eval`,
      [eleveId, periodeId, insc[0].classe_id]
    );

    // Regroupement par matiere, avec la moyenne ramenee sur 20
    const parMatiere = [];
    for (const r of rows) {
      let bloc = parMatiere.find((b) => b.matiere_id === r.matiere_id);
      if (!bloc) {
        bloc = { matiere_id: r.matiere_id, matiere: r.matiere, couleur: r.couleur, evaluations: [] };
        parMatiere.push(bloc);
      }
      bloc.evaluations.push({
        id: r.evaluation_id, libelle: r.libelle, type: r.type,
        date_eval: r.date_eval, bareme: Number(r.bareme),
        coefficient: Number(r.coefficient),
        valeur: r.valeur === null ? null : Number(r.valeur),
        appreciation: r.appreciation,
      });
    }
    for (const bloc of parMatiere) {
      const notees = bloc.evaluations.filter((e) => e.valeur !== null);
      const totalCoef = notees.reduce((s, e) => s + e.coefficient, 0);
      const points = notees.reduce((s, e) => s + (e.valeur * 20 / e.bareme) * e.coefficient, 0);
      bloc.moyenne = totalCoef ? Number((points / totalCoef).toFixed(2)) : null;
    }
    res.json(parMatiere);
  } catch (err) { next(err); }
});

// Classement complet d une classe pour une periode
router.get('/classement/:classeId/:periodeId', async (req, res, next) => {
  try {
    const { classeId, periodeId } = req.params;
    // Le classement expose les moyennes de tous les eleves : un tuteur n a
    // pas a consulter les resultats des camarades de son enfant. Son rang
    // lui est communique dans le bulletin.
    if (estTuteur(req.user)) {
      return res.status(403).json({ erreur: 'Le classement nominatif n est pas accessible aux tuteurs' });
    }
    const controle = await verifierClasse(req, classeId);
    if (!controle.ok) return res.status(controle.code).json({ erreur: controle.message });

    const { rows: cl } = await query(`SELECT niveau_id FROM classe WHERE id = $1`, [classeId]);
    if (!cl[0]) return res.status(404).json({ erreur: 'Classe introuvable' });

    const { rows } = await query(
      `WITH moy_matiere AS (
         SELECT n.eleve_id, ev.matiere_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient),0) AS moy,
                COALESCE(mn.coefficient, 1) AS coef
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         LEFT JOIN matiere_niveau mn ON mn.matiere_id = ev.matiere_id AND mn.niveau_id = $3
         WHERE ev.periode_id = $2 AND ev.classe_id = $1 AND n.valeur IS NOT NULL
         GROUP BY n.eleve_id, ev.matiere_id, mn.coefficient
       )
       SELECT e.id, e.matricule, e.prenom, e.nom,
              ROUND(SUM(mm.moy * mm.coef) / NULLIF(SUM(mm.coef),0), 2) AS moyenne,
              RANK() OVER (ORDER BY SUM(mm.moy * mm.coef) / NULLIF(SUM(mm.coef),0) DESC)::int AS rang
       FROM moy_matiere mm
       JOIN eleve e ON e.id = mm.eleve_id
       GROUP BY e.id, e.matricule, e.prenom, e.nom
       ORDER BY rang`,
      [classeId, periodeId, cl[0].niveau_id]
    );
    res.json(rows.map((r) => ({ ...r, mention: mentionDe(Number(r.moyenne)) })));
  } catch (err) { next(err); }
});

export default router;
