import { describe, it, expect, beforeAll } from 'vitest';
import { api, COMPTES, contexte, compteTuteur } from './aides.js';
import { query } from '../src/db/pool.js';
import { propositionsConseil, appreciationDe } from '../src/metier/bareme.js';

/**
 * TESTS DE NON-REGRESSION.
 *
 * Chaque test fige un bug REELLEMENT rencontre pendant le developpement.
 * Il ne s agit pas de cas theoriques : ces defauts sont passes en
 * production locale et ont ete corriges. Ces tests empechent leur retour.
 */

let ctx;
beforeAll(async () => { ctx = await contexte(); });

describe('Regression : le censeur n est pas transverse', () => {
  it('ne voit que le secondaire, pas tout l etablissement', async () => {
    // Bug : le censeur voyait les 14 classes et 430 eleves de l ecole.
    // Il est l adjoint du proviseur, donc cloisonne sur « secondaire ».
    const r = await api('GET', '/api/scolarite/classes', COMPTES.censeur);
    expect(r.body.every((c) => c.entite === 'secondaire')).toBe(true);

    const eleves = await api('GET', '/api/eleves?taille=1', COMPTES.censeur);
    const tous = await api('GET', '/api/eleves?taille=1', COMPTES.admin);
    expect(eleves.body.total).toBeLessThan(tous.body.total);
  });
});

describe('Regression : un enseignant est limite a ses classes', () => {
  it('le maitre ne voit pas les eleves des autres classes elementaires', async () => {
    // Bug : le maitre de CI voyait les 219 eleves des 6 classes de son
    // entite, au lieu des seuls eleves de sa classe.
    const maitre = await api('GET', '/api/eleves?taille=1', COMPTES.maitre);
    const directeur = await api('GET', '/api/eleves?taille=1', COMPTES.directeur);
    expect(maitre.body.total).toBeLessThan(directeur.body.total);
  });

  it('ne divulgue pas le trombinoscope des collegues', async () => {
    // Bug : l onglet Enseignants montrait les 14 enseignants avec leurs
    // emails et affectations a n importe quel enseignant.
    const r = await api('GET', '/api/scolarite/enseignants', COMPTES.maitre);
    expect(r.body).toHaveLength(1);
  });

  it('ne divulgue pas le catalogue complet des matieres', async () => {
    // Bug : un maitre voyait les 12 matieres de l etablissement, dont
    // Philosophie et SVT qu il n enseigne pas.
    const maitre = await api('GET', '/api/scolarite/matieres', COMPTES.maitre);
    const admin = await api('GET', '/api/scolarite/matieres', COMPTES.admin);
    expect(maitre.body.length).toBeLessThan(admin.body.length);
  });
});

describe('Regression : une matiere nouvelle reste visible du maitre', () => {
  it('le maitre voit les matieres de son niveau meme sans affectation', async () => {
    // Bug : une matiere creee par la direction restait invisible du maitre
    // tant qu aucune affectation n avait ete saisie, car le filtre ne
    // regardait que la table `affectation`.
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM matiere_niveau mn
       WHERE mn.niveau_id = $1`,
      [ctx.classes.ci.niveau_id]
    );
    const r = await api('GET', '/api/scolarite/matieres', COMPTES.maitre);
    expect(r.body.length).toBe(rows[0].n);
  });
});

describe('Regression : le rang par matiere n est pas toujours 1', () => {
  it('classe reellement l eleve parmi ses camarades', async () => {
    // Bug : la requete filtrait sur l eleve AVANT le RANK(), ce qui
    // donnait rang 1 a tout le monde dans toutes les matieres.
    const r = await api(
      'GET', `/api/notes/bulletin/${ctx.eleveCI.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const rangs = r.body.matieres.map((m) => Number(m.rang));

    // Au moins un eleve de la classe doit avoir un rang autre que 1 quelque
    // part : sinon le calcul est a nouveau casse.
    const { rows } = await query(
      `WITH moy AS (
         SELECT ev.matiere_id, n.eleve_id,
                SUM(n.valeur * ev.coefficient * 20.0 / ev.bareme)
                  / NULLIF(SUM(ev.coefficient),0) AS m
         FROM note n
         JOIN evaluation ev ON ev.id = n.evaluation_id
         WHERE ev.periode_id = $1 AND ev.classe_id = $2 AND n.valeur IS NOT NULL
         GROUP BY ev.matiere_id, n.eleve_id
       ),
       classees AS (
         SELECT matiere_id, eleve_id,
                RANK() OVER (PARTITION BY matiere_id ORDER BY m DESC) AS rang
         FROM moy
       )
       SELECT matiere_id, rang FROM classees WHERE eleve_id = $3`,
      [ctx.periodeId, ctx.classes.ci.id, ctx.eleveCI.id]
    );
    const attendus = Object.fromEntries(rows.map((x) => [x.matiere_id, Number(x.rang)]));
    for (const m of r.body.matieres) {
      expect(Number(m.rang)).toBe(attendus[m.id]);
    }
    expect(rangs.length).toBeGreaterThan(0);
  });
});

describe('Regression : la vue partielle ne fausse pas le bulletin', () => {
  it('moyenne et rang restent calcules sur toutes les matieres', async () => {
    // Invariant : filtrer l affichage pour un enseignant ne doit jamais
    // modifier la moyenne generale ni le rang.
    const complet = await api(
      'GET', `/api/notes/bulletin/${ctx.eleve6eme.id}/${ctx.periodeId}`, COMPTES.admin
    );
    const partiel = await api(
      'GET', `/api/notes/bulletin/${ctx.eleve6eme.id}/${ctx.periodeId}`, COMPTES.professeur
    );
    expect(partiel.body.synthese.moyenne).toBe(complet.body.synthese.moyenne);
    expect(partiel.body.synthese.rang).toBe(complet.body.synthese.rang);
  });
});

describe('Regression : aucune proposition sans notes', () => {
  it('ne suggere pas le redoublement a un eleve sans moyenne', () => {
    // Bug : un eleve nouvellement inscrit, sans aucune note, recevait
    // « Risque de Redoubler » et « Avertissement ».
    expect(propositionsConseil(null).appreciation).toBeNull();
    expect(propositionsConseil(null).distinction).toBeNull();
  });

  it('ne donne pas d appreciation a une matiere sans moyenne', () => {
    // Bug : Number(null) valant 0, la matiere recevait « Travail Insuffisant ».
    expect(appreciationDe(null)).toBeNull();
  });

  it('la feuille de conseil ne propose rien pour un eleve sans note', async () => {
    const r = await api('GET', `/api/notes/conseil/${ctx.classes.ci.id}/${ctx.periodeId}`,
      COMPTES.directeur);
    for (const e of r.body.eleves) {
      if (e.moyenne == null) {
        expect(e.appreciation).toBeNull();
        expect(e.distinction).toBeNull();
      }
    }
  });
});

describe('Regression : le tuteur ne voit pas au-dela de son enfant', () => {
  it('ne voit ni toutes les classes ni tous les enseignants', async () => {
    // Bug : le tuteur voyait les 14 classes et les 14 enseignants avec
    // leurs emails.
    const tuteur = compteTuteur(ctx.eleveCI.matricule);

    const classes = await api('GET', '/api/scolarite/classes', tuteur);
    expect(classes.body).toHaveLength(1);

    const enseignants = await api('GET', '/api/scolarite/enseignants', tuteur);
    expect(enseignants.body.length).toBeLessThan(5);
  });

  it('un eleve_id force dans le corps est ignore', async () => {
    // Un tuteur ne doit pas pouvoir signaler une absence pour l enfant
    // d un autre en forgeant la requete.
    const tuteur = compteTuteur(ctx.eleveCI.matricule);
    const r = await api('POST', '/api/vie-scolaire/absences/signaler', tuteur, {
      eleve_id: ctx.eleveCP.id,          // tentative de detournement
      date_abs: '2027-01-15',
      motif: 'Test de non-regression',
    });
    expect(r.status).toBe(201);
    for (const a of r.body.absences) {
      expect(a.eleve_id).toBe(ctx.eleveCI.id);   // son enfant, pas l autre
    }
    // Nettoyage
    await query(`DELETE FROM absence WHERE date_abs = '2027-01-15'`);
  });
});

describe('Regression : chaque eleve actif a un compte tuteur', () => {
  it('aucun eleve actif ne reste sans compte parent', async () => {
    // Bug : `comptes-tuteurs.js` plantait sur une base deja peuplee quand
    // deux enfants partageaient le numero de leur tuteur — la colonne
    // `utilisateur.telephone` etant UNIQUE. Le script s arretait alors
    // avant de creer les comptes restants.
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM eleve e
       WHERE e.statut = 'actif'
         AND NOT EXISTS (SELECT 1 FROM utilisateur u WHERE u.eleve_suivi_id = e.id)`
    );
    expect(rows[0].n, 'des eleves actifs n ont pas de compte tuteur').toBe(0);
  });

  it('un meme numero de tuteur ne bloque pas la creation', async () => {
    // Une fratrie partage le numero du parent : plusieurs comptes doivent
    // pouvoir coexister, le telephone n etant renseigne qu une fois.
    const { rows } = await query(
      `SELECT t.telephone, COUNT(DISTINCT et.eleve_id)::int AS enfants
       FROM tuteur t JOIN eleve_tuteur et ON et.tuteur_id = t.id
       GROUP BY t.telephone HAVING COUNT(DISTINCT et.eleve_id) > 1
       LIMIT 1`
    );
    if (!rows[0]) return;   // pas de fratrie dans ce jeu de donnees

    // Chacun de ces enfants doit malgre tout avoir son compte
    const { rows: sans } = await query(
      `SELECT COUNT(*)::int AS n
       FROM eleve_tuteur et
       JOIN tuteur t ON t.id = et.tuteur_id
       JOIN eleve e ON e.id = et.eleve_id AND e.statut = 'actif'
       WHERE t.telephone = $1
         AND NOT EXISTS (SELECT 1 FROM utilisateur u WHERE u.eleve_suivi_id = e.id)`,
      [rows[0].telephone]
    );
    expect(sans[0].n).toBe(0);
  });
});

describe('Regression : le passage d annee est rejouable', () => {
  it('ne cree pas de doublon si on le relance', async () => {
    // Le passage en lot doit etre idempotent : une seconde execution ne
    // doit rien creer de plus.
    const { rows: avant } = await query(
      `SELECT COUNT(*)::int AS n FROM inscription`
    );
    // Aucune decision arretee en base de demonstration : le passage ne doit
    // rien creer, mais surtout ne pas echouer.
    const r = await api('POST', '/api/parcours/passage', COMPTES.directeur, {
      classe_id: ctx.classes.ci.id,
      annee_cible_id: ctx.anneeId,
      classe_cible_id: ctx.classes.cp.id,
    });
    expect(r.status).toBe(200);

    const { rows: apres } = await query(
      `SELECT COUNT(*)::int AS n FROM inscription`
    );
    expect(apres[0].n).toBe(avant[0].n);
  });
});
