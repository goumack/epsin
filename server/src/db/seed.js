import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const PRENOMS_M = ['Mamadou', 'Ibrahima', 'Cheikh', 'Moussa', 'Abdoulaye', 'Ousmane', 'Alioune', 'Modou', 'Babacar', 'Serigne'];
const PRENOMS_F = ['Fatou', 'Aissatou', 'Awa', 'Mariama', 'Khady', 'Ndeye', 'Astou', 'Sokhna', 'Bineta', 'Rokhaya'];
const NOMS = ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Ba', 'Gueye', 'Sarr', 'Diallo', 'Faye', 'Mbaye', 'Seck', 'Cisse'];

const alea = (arr) => arr[Math.floor(Math.random() * arr.length)];
const entier = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Convertit un decalage de mois depuis octobre 2025 en "AAAA-MM".
 * decalage 0 -> 2025-10, decalage 3 -> 2026-01.
 */
function moisScolaire(decalage) {
  const absolu = 9 + decalage;                 // 9 = octobre (base 0)
  const annee = 2025 + Math.floor(absolu / 12);
  const mois = (absolu % 12) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}`;
}

async function seed() {
  // Ce script insere 400+ eleves FICTIFS. Le lancer par erreur sur une base
  // de production polluerait durablement les donnees reelles.
  // `npm run init-production` est le script destine a la production.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Refus : ce seed insere des donnees de demonstration.\n'
      + 'Pour une base de production, utilisez : npm run init-production'
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: dejaLa } = await client.query(`SELECT COUNT(*)::int AS n FROM utilisateur`);
    if (dejaLa[0].n > 0) {
      console.log('La base contient deja des donnees. Seed ignore.');
      await client.query('ROLLBACK');
      return;
    }

    // Etablissement
    await client.query(
      // IA et IEF figurent en en-tete du bulletin officiel : sans elles,
      // le document sort incomplet.
      `INSERT INTO etablissement (nom, sigle, adresse, telephone, email,
                                  inspection_academie, inspection_ief)
       VALUES ('École Privée Serigne Ibrahima Niang','EPSIN - YENE','Dakar, Senegal',
               '+221 33 000 00 00','contact@epsin.sn','IA DAKAR','IEF Dakar 1')`
    );

    // Annee scolaire + trimestres
    const { rows: annee } = await client.query(
      `INSERT INTO annee_scolaire (libelle, date_debut, date_fin, active)
       VALUES ('2025-2026','2025-10-01','2026-07-15', true) RETURNING id`
    );
    const anneeId = annee[0].id;
    const trimestres = [
      ['1er trimestre', 1, '2025-10-01', '2025-12-20'],
      ['2eme trimestre', 2, '2026-01-05', '2026-03-28'],
      ['3eme trimestre', 3, '2026-04-06', '2026-07-15'],
    ];
    const periodeIds = [];
    for (const [lib, ordre, d, f] of trimestres) {
      const { rows } = await client.query(
        `INSERT INTO periode (annee_id, libelle, ordre, date_debut, date_fin)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`, [anneeId, lib, ordre, d, f]
      );
      periodeIds.push(rows[0].id);
    }

    // Niveaux
    // Structure du systeme educatif senegalais :
    //   elementaire CI->CM2 (6 ans, CFEE), moyen 6eme->3eme (4 ans, BFEM),
    //   secondaire Seconde->Terminale (3 ans, baccalaureat).
    const niveaux = [
      ['CI','elementaire',1,null],   ['CP','elementaire',2,null],
      ['CE1','elementaire',3,null],  ['CE2','elementaire',4,null],
      ['CM1','elementaire',5,null],  ['CM2','elementaire',6,'CFEE'],
      ['6eme','moyen',7,null],       ['5eme','moyen',8,null],
      ['4eme','moyen',9,null],       ['3eme','moyen',10,'BFEM'],
      ['Seconde','secondaire',11,null], ['Premiere','secondaire',12,null],
      ['Terminale','secondaire',13,'Baccalaureat'],
    ];
    const niveauIds = {};
    const cycleDe = {};
    const entiteDeNiveau = {};
    for (const [lib, cycle, ordre, examen] of niveaux) {
      // L elementaire forme l entite « scolaire », le reste « secondaire »
      const entite = cycle === 'elementaire' ? 'scolaire' : 'secondaire';
      const { rows } = await client.query(
        `INSERT INTO niveau (libelle, cycle, ordre, examen, entite)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [lib, cycle, ordre, examen, entite]
      );
      niveauIds[lib] = rows[0].id;
      cycleDe[lib] = cycle;
      entiteDeNiveau[lib] = entite;
    }

    // ---------- Matieres du moyen et du secondaire ----------
    // Un professeur par matiere, comme au college/lycee classique.
    const matieresSecondaires = [
      ['Mathematiques','MATH','#3b82f6', { moyen: 4, secondaire: 4 }],
      ['Francais','FR','#8b5cf6',        { moyen: 4, secondaire: 4 }],
      ['Anglais','ANG','#06b6d4',        { moyen: 2, secondaire: 2 }],
      ['Histoire-Geographie','HG','#f59e0b', { moyen: 2, secondaire: 2 }],
      ['SVT','SVT','#10b981',            { moyen: 2, secondaire: 2 }],
      ['Physique-Chimie','PC','#ef4444', { moyen: 3, secondaire: 3 }],
      ['EPS','EPS','#84cc16',            { moyen: 1, secondaire: 1 }],
      ['Philosophie','PHILO','#ec4899',  { secondaire: 2 }],
    ];

    // ---------- Domaines du CEB (elementaire) ----------
    // Le systeme senegalais n a PAS de "matieres" separees a l elementaire :
    // le programme officiel (Curriculum de l Education de Base) organise
    // l enseignement en 4 DOMAINES, tous pris en charge par un seul MAITRE
    // POLYVALENT par classe (l instituteur titulaire), pas par un professeur
    // different pour chaque discipline comme au college/lycee.
    const domainesCEB = [
      ['Langue et Communication','LC','#8b5cf6', 4],
      ['Mathematiques (CEB)','MATH-CEB','#3b82f6', 4],
      ['Education a la Science et a la Vie Sociale','ESVS','#10b981', 3],
      ['Education Physique, Sportive et Artistique','EPSA','#84cc16', 2],
    ];

    const matiereIds = {};      // libelle -> id, pour les deux ensembles
    const matieresParCycle = { moyen: [], secondaire: [] };
    const domaineIds = [];      // ids des 4 domaines CEB, dans l ordre

    for (const [lib, code, couleur, cycles] of matieresSecondaires) {
      const { rows } = await client.query(
        `INSERT INTO matiere (libelle, code, couleur, domaine_ceb)
         VALUES ($1,$2,$3,false) RETURNING id`,
        [lib, code, couleur]
      );
      matiereIds[lib] = rows[0].id;
      for (const [cycle, coef] of Object.entries(cycles)) {
        matieresParCycle[cycle].push(rows[0].id);
        for (const [nomNiveau, nid] of Object.entries(niveauIds)) {
          if (cycleDe[nomNiveau] !== cycle) continue;
          await client.query(
            `INSERT INTO matiere_niveau (matiere_id, niveau_id, coefficient) VALUES ($1,$2,$3)`,
            [rows[0].id, nid, coef]
          );
        }
      }
    }

    for (const [lib, code, couleur, coef] of domainesCEB) {
      const { rows } = await client.query(
        `INSERT INTO matiere (libelle, code, couleur, domaine_ceb)
         VALUES ($1,$2,$3,true) RETURNING id`,
        [lib, code, couleur]
      );
      matiereIds[lib] = rows[0].id;
      domaineIds.push(rows[0].id);
      for (const [nomNiveau, nid] of Object.entries(niveauIds)) {
        if (cycleDe[nomNiveau] !== 'elementaire') continue;
        await client.query(
          `INSERT INTO matiere_niveau (matiere_id, niveau_id, coefficient) VALUES ($1,$2,$3)`,
          [rows[0].id, nid, coef]
        );
      }
    }

    // Comptes de demonstration
    const mdp = await bcrypt.hash('epsin2026', 10);
    // Chaque entite a son equipe de direction : un DIRECTEUR pour
    // l elementaire ; un PROVISEUR pour le moyen/secondaire, seconde par
    // un CENSEUR (vie scolaire, discipline) qui n est PAS transverse — il
    // appartient au CEM/lycee au meme titre que le principal.
    // L admin et le comptable restent transverses (caisse commune).
    const comptes = [
      ['admin@epsin.sn','admin','Aminata','Sow', null],
      ['directeur@epsin.sn','directeur','Mamadou','Faye', 'scolaire'],
      ['proviseur@epsin.sn','proviseur','Ibrahima','Gueye', 'secondaire'],
      ['censeur@epsin.sn','censeur','Ousmane','Diallo', 'secondaire'],
      ['comptable@epsin.sn','comptable','Fatou','Ndiaye', null],
    ];
    for (const [email, role, prenom, nom, entite] of comptes) {
      await client.query(
        `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom, entite)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [email, mdp, role, prenom, nom, entite]
      );
    }

    // ---------- Enseignants du moyen/secondaire : un par matiere ----------
    const enseignantsSecondaire = [];
    for (let i = 0; i < matieresSecondaires.length; i++) {
      const prenom = i % 2 ? alea(PRENOMS_F) : alea(PRENOMS_M);
      const nom = alea(NOMS);
      const { rows: u } = await client.query(
        `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom, entite)
         VALUES ($1,$2,'enseignant',$3,$4,'secondaire') RETURNING id`,
        [`prof${i + 1}@epsin.sn`, mdp, prenom, nom]
      );
      const { rows: e } = await client.query(
        `INSERT INTO enseignant (utilisateur_id, matricule, specialite,
                                 date_embauche, type_contrat, entite)
         VALUES ($1,$2,$3,$4,'permanent','secondaire') RETURNING id`,
        [u[0].id, `ENS-${String(i + 1).padStart(3, '0')}`,
         matieresSecondaires[i][0], '2022-09-01']
      );
      enseignantsSecondaire.push(e[0].id);
    }

    // ---------- Maitres de l elementaire : un par classe, polyvalent ----------
    // Le "specialite" d un maitre n a pas de sens comme au secondaire : il
    // prend en charge les 4 domaines. On le nomme "Maitre polyvalent".
    const maitresElementaire = [];
    for (let i = 0; i < 6; i++) {
      const prenom = i % 2 ? alea(PRENOMS_F) : alea(PRENOMS_M);
      const nom = alea(NOMS);
      const { rows: u } = await client.query(
        `INSERT INTO utilisateur (email, mot_de_passe, role, prenom, nom, entite)
         VALUES ($1,$2,'enseignant',$3,$4,'scolaire') RETURNING id`,
        [`maitre${i + 1}@epsin.sn`, mdp, prenom, nom]
      );
      const { rows: e } = await client.query(
        `INSERT INTO enseignant (utilisateur_id, matricule, specialite,
                                 date_embauche, type_contrat, entite)
         VALUES ($1,$2,'Maitre polyvalent',$3,'permanent','scolaire') RETURNING id`,
        [u[0].id, `MTR-${String(i + 1).padStart(3, '0')}`, '2022-09-01']
      );
      maitresElementaire.push(e[0].id);
    }

    // Classes : groupe scolaire complet, de l elementaire au secondaire.
    // Les effectifs sont plus eleves a l elementaire, comme dans la realite.
    const classeIds = [];
    const definitionClasses = [
      ['CI A','CI'], ['CP A','CP'], ['CE1 A','CE1'], ['CE2 A','CE2'],
      ['CM1 A','CM1'], ['CM2 A','CM2'],
      ['6eme A','6eme'], ['6eme B','6eme'], ['5eme A','5eme'],
      ['4eme A','4eme'], ['3eme A','3eme'],
      ['Seconde S','Seconde'], ['Premiere S','Premiere'], ['Terminale S','Terminale'],
    ];
    for (const [lib, nid] of definitionClasses) {
      const cycle = cycleDe[nid];
      const { rows } = await client.query(
        `INSERT INTO classe (annee_id, niveau_id, libelle, capacite, salle)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, niveau_id`,
        [anneeId, niveauIds[nid], lib, cycle === 'elementaire' ? 55 : 45,
         `Salle ${classeIds.length + 1}`]
      );
      classeIds.push({ ...rows[0], cycle, entite: entiteDeNiveau[nid] });
    }

    // ---------- Affectation d un maitre unique par classe elementaire ----------
    let indexMaitre = 0;
    const maitreDeClasse = {};   // classe_id -> enseignant_id, reutilise plus bas
    for (const c of classeIds) {
      if (c.cycle !== 'elementaire') continue;
      const maitreId = maitresElementaire[indexMaitre % maitresElementaire.length];
      indexMaitre++;
      maitreDeClasse[c.id] = maitreId;

      await client.query(
        `INSERT INTO classe_maitre (classe_id, enseignant_id, annee_id) VALUES ($1,$2,$3)`,
        [c.id, maitreId, anneeId]
      );
      // Le maitre est designe professeur principal de sa propre classe
      await client.query(
        `UPDATE classe SET prof_principal_id =
           (SELECT utilisateur_id FROM enseignant WHERE id = $2) WHERE id = $1`,
        [c.id, maitreId]
      );
      // Une affectation par domaine, toutes tenues par le meme maitre :
      // cela permet de reutiliser le meme mecanisme d evaluation/notes
      // que le secondaire sans dupliquer la logique metier.
      for (const domaineId of domaineIds) {
        await client.query(
          `INSERT INTO affectation (enseignant_id, classe_id, matiere_id, annee_id)
           VALUES ($1,$2,$3,$4)`,
          [maitreId, c.id, domaineId, anneeId]
        );
      }
    }

    // Affectations du moyen/secondaire : un professeur par matiere
    for (const c of classeIds) {
      if (c.cycle === 'elementaire') continue;
      const duCycle = matieresParCycle[c.cycle];
      for (let m = 0; m < duCycle.length; m++) {
        await client.query(
          `INSERT INTO affectation (enseignant_id, classe_id, matiere_id, annee_id)
           VALUES ($1,$2,$3,$4)`,
          [enseignantsSecondaire[m % enseignantsSecondaire.length], c.id, duCycle[m], anneeId]
        );
      }
    }

    // Emploi du temps. A l elementaire la journee est plus courte
    // (3 creneaux, pas de cours en fin d apres-midi), et c est toujours
    // le meme maitre qui apparait sur chaque creneau de sa classe.
    const heuresLongues = [['08:00','10:00'],['10:15','12:15'],['14:00','16:00'],['16:15','18:00']];
    const heuresCourtes = [['08:00','10:00'],['10:15','12:15'],['14:00','16:00']];
    for (const c of classeIds) {
      const estElementaire = c.cycle === 'elementaire';
      const domaines = estElementaire ? domaineIds : matieresParCycle[c.cycle];
      const heures = estElementaire ? heuresCourtes : heuresLongues;
      let idx = 0;
      for (let jour = 1; jour <= 5; jour++) {
        for (const [hd, hf] of heures) {
          const enseignantId = estElementaire
            ? maitreDeClasse[c.id]
            : enseignantsSecondaire[idx % enseignantsSecondaire.length];
          await client.query(
            `INSERT INTO creneau (classe_id, matiere_id, enseignant_id, jour, heure_debut, heure_fin, salle)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [c.id, domaines[idx % domaines.length], enseignantId,
             jour, hd, hf, estElementaire ? `Salle ${classeIds.indexOf(c) + 1}` : `Salle ${entier(1, 12)}`]
          );
          idx++;
        }
      }
    }

    // Frais de scolarite communs a tout l etablissement
    await client.query(
      `INSERT INTO frais (annee_id, niveau_id, libelle, montant, obligatoire, recurrent)
       VALUES ($1,NULL,'Frais d inscription',25000,true,false),
              ($1,NULL,'Mensualite',15000,true,true),
              ($1,NULL,'Tenue scolaire',12000,false,false),
              ($1,NULL,'Cantine',10000,false,true)`,
      [anneeId]
    );

    // Frais specifiques aux niveaux d examen (preparation, frais de dossier)
    for (const [niveauLib, libelle, montant] of [
      ['CM2', 'Frais d examen CFEE', 5000],
      ['3eme', 'Frais d examen BFEM', 10000],
      ['Terminale', 'Frais d examen Baccalaureat', 15000],
    ]) {
      await client.query(
        `INSERT INTO frais (annee_id, niveau_id, libelle, montant, obligatoire, recurrent)
         VALUES ($1,$2,$3,$4,true,false)`,
        [anneeId, niveauIds[niveauLib], libelle, montant]
      );
    }

    // Seuls les frais communs servent a generer les paiements de demonstration
    const { rows: fraisRows } = await client.query(
      `SELECT id, libelle, montant FROM frais WHERE annee_id = $1 AND niveau_id IS NULL`,
      [anneeId]
    );

    // Eleves, avec tuteur, notes, absences, paiements.
    // L age est deduit du niveau : un eleve entre au CI vers 6 ans et
    // progresse d un an par niveau (ordre 1 = CI ... ordre 13 = Terminale).
    const ordreDe = Object.fromEntries(niveaux.map(([lib, , ordre]) => [lib, ordre]));
    const ordreParNiveauId = Object.fromEntries(
      Object.entries(niveauIds).map(([lib, id]) => [id, ordreDe[lib]])
    );

    let compteur = 0;
    for (const c of classeIds) {
      // Les classes elementaires sont plus chargees
      const effectif = c.cycle === 'elementaire' ? entier(30, 42) : entier(22, 30);
      const ordre = ordreParNiveauId[c.niveau_id] || 1;
      // Rentree 2025 : un eleve d ordre N a environ 5 + N ans
      const anneeNaissance = 2025 - (5 + ordre);

      for (let i = 0; i < effectif; i++) {
        compteur++;
        const sexe = Math.random() > 0.5 ? 'M' : 'F';
        const prenom = sexe === 'M' ? alea(PRENOMS_M) : alea(PRENOMS_F);
        const nom = alea(NOMS);
        const matricule = `EP-2026-${String(compteur).padStart(4, '0')}`;

        const { rows: el } = await client.query(
          `INSERT INTO eleve (matricule, prenom, nom, sexe, date_naissance, lieu_naissance, nationalite, adresse)
           VALUES ($1,$2,$3,$4,$5,'Dakar','Senegalaise',$6) RETURNING id`,
          [matricule, prenom, nom, sexe,
           // +/- 1 an d ecart pour refleter les redoublements et avances
           `${anneeNaissance + entier(-1, 1)}-${String(entier(1, 12)).padStart(2, '0')}-${String(entier(1, 28)).padStart(2, '0')}`,
           `Quartier ${alea(['Medina','Point E','Ouakam','Yoff','Parcelles'])}, Dakar`]
        );
        const eleveId = el[0].id;

        await client.query(
          `INSERT INTO inscription (eleve_id, classe_id, annee_id) VALUES ($1,$2,$3)`,
          [eleveId, c.id, anneeId]
        );

        const { rows: tu } = await client.query(
          `INSERT INTO tuteur (prenom, nom, telephone, profession)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [alea(PRENOMS_M), nom, `+2217${entier(0, 9)}${entier(1000000, 9999999)}`,
           alea(['Commercant','Enseignant','Infirmier','Chauffeur','Fonctionnaire'])]
        );
        await client.query(
          `INSERT INTO eleve_tuteur (eleve_id, tuteur_id, lien, principal)
           VALUES ($1,$2,'pere',true)`, [eleveId, tu[0].id]
        );

        // Paiements : inscription + quelques mensualites
        const inscription = fraisRows.find((f) => f.libelle.includes('inscription'));
        const mensualite = fraisRows.find((f) => f.libelle === 'Mensualite');
        await client.query(
          `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, numero_recu, date_paiement)
           VALUES ($1,$2,$3,$4,'especes',$5,'2025-10-05')`,
          [eleveId, inscription.id, anneeId, inscription.montant,
           `REC-2025-${String(compteur).padStart(5, '0')}`]
        );
        // 75 % des eleves sont a jour, les autres accumulent des impayes
        const moisPayes = Math.random() > 0.25 ? entier(3, 5) : entier(0, 2);
        for (let m = 0; m < moisPayes; m++) {
          await client.query(
            `INSERT INTO paiement (eleve_id, frais_id, annee_id, montant, mode, numero_recu, mois_couvert, date_paiement)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [eleveId, mensualite.id, anneeId, mensualite.montant,
             alea(['especes','wave','om']),
             `REC-2025-M${compteur}-${m}`, moisScolaire(m),
             `${moisScolaire(m)}-${String(entier(5, 25)).padStart(2, '0')}`]
          );
        }

        // Absences
        for (let a = 0; a < entier(0, 5); a++) {
          await client.query(
            `INSERT INTO absence (eleve_id, date_abs, type, justifiee)
             VALUES ($1,$2,$3,$4)`,
            [eleveId, `${moisScolaire(entier(0, 2))}-${String(entier(1, 28)).padStart(2, '0')}`,
             Math.random() > 0.3 ? 'absence' : 'retard', Math.random() > 0.5]
          );
        }
      }
    }

    // Evaluations et notes pour le 1er trimestre
    for (const c of classeIds) {
      const { rows: eleves } = await client.query(
        `SELECT eleve_id FROM inscription WHERE classe_id = $1`, [c.id]
      );
      const estElementaire = c.cycle === 'elementaire';
      const domaines = estElementaire ? domaineIds : matieresParCycle[c.cycle];
      for (let m = 0; m < domaines.length; m++) {
        const enseignantId = estElementaire
          ? maitreDeClasse[c.id]
          : enseignantsSecondaire[m % enseignantsSecondaire.length];
        for (const [type, lib, coef] of [['devoir','Devoir n1',1],['composition','Composition',2]]) {
          const { rows: ev } = await client.query(
            `INSERT INTO evaluation (classe_id, matiere_id, periode_id, enseignant_id,
                                     type, libelle, date_eval, bareme, coefficient, publiee)
             VALUES ($1,$2,$3,$4,$5,$6,$7,20,$8,true) RETURNING id`,
            [c.id, domaines[m], periodeIds[0], enseignantId,
             type, lib, `2025-11-${String(entier(1, 28)).padStart(2, '0')}`, coef]
          );
          for (const e of eleves) {
            // Quelques absents a l epreuve (note NULL)
            const valeur = Math.random() > 0.05
              ? Math.round((Math.random() * 12 + 6) * 4) / 4
              : null;
            await client.query(
              `INSERT INTO note (evaluation_id, eleve_id, valeur) VALUES ($1,$2,$3)`,
              [ev[0].id, e.eleve_id, valeur]
            );
          }
        }
      }
    }

    // Annonces
    await client.query(
      `INSERT INTO annonce (titre, contenu, auteur_id, cible, epingle)
       VALUES ('Rentree scolaire 2025-2026','Les cours reprennent le lundi 1er octobre 2025 a 8h. Presence obligatoire en tenue reglementaire.',
               (SELECT id FROM utilisateur WHERE role='admin' LIMIT 1),'tous',true),
              ('Conseil de classe du 1er trimestre','Les conseils de classe se tiendront du 15 au 20 decembre. Les bulletins seront remis aux parents a l issue.',
               (SELECT id FROM utilisateur WHERE role='admin' LIMIT 1),'tous',false),
              ('Reunion pedagogique','Reunion de tous les enseignants le vendredi a 16h en salle des professeurs.',
               (SELECT id FROM utilisateur WHERE role='admin' LIMIT 1),'enseignants',false)`
    );

    // Bibliotheque
    for (const [titre, auteur, cat, ex] of [
      ['Une si longue lettre','Mariama Ba','Roman',5],
      ['L Aventure ambigue','Cheikh Hamidou Kane','Roman',4],
      ['Les Bouts de bois de Dieu','Sembene Ousmane','Roman',3],
      ['Mathematiques 3eme','Collection Excellence','Manuel',20],
      ['Physique-Chimie Seconde','Hachette','Manuel',15],
    ]) {
      await client.query(
        `INSERT INTO livre (titre, auteur, categorie, exemplaires, disponibles)
         VALUES ($1,$2,$3,$4,$4)`, [titre, auteur, cat, ex]
      );
    }

    // Transport
    await client.query(
      `INSERT INTO bus (immatriculation, chauffeur, telephone, capacite, itineraire)
       VALUES ('DK-1234-AB','Modou Fall','+221770000001',35,'Yoff - Ouakam - Ecole'),
              ('DK-5678-CD','Alioune Sarr','+221770000002',30,'Parcelles - Patte d Oie - Ecole')`
    );

    // Depenses
    await client.query(
      `INSERT INTO depense (annee_id, categorie, libelle, montant, date_depense)
       VALUES ($1,'Salaires','Salaires enseignants octobre',2400000,'2025-10-30'),
              ($1,'Fournitures','Craies et materiel pedagogique',150000,'2025-10-12'),
              ($1,'Entretien','Reparation toiture batiment B',320000,'2025-11-08'),
              ($1,'Salaires','Salaires enseignants novembre',2400000,'2025-11-30')`,
      [anneeId]
    );

    await client.query('COMMIT');

    const { rows: stats } = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM eleve) AS eleves,
              (SELECT COUNT(*)::int FROM classe) AS classes,
              (SELECT COUNT(*)::int FROM note) AS notes,
              (SELECT COUNT(*)::int FROM paiement) AS paiements`
    );
    console.log('Donnees de demonstration inserees :');
    console.log(`  ${stats[0].eleves} eleves, ${stats[0].classes} classes, ${stats[0].notes} notes, ${stats[0].paiements} paiements`);
    console.log('\nComptes de connexion (mot de passe : epsin2026)');
    console.log('  admin@epsin.sn       -> Administrateur (tout l etablissement)');
    console.log('  directeur@epsin.sn   -> Directeur, entite SCOLAIRE (CI -> CM2)');
    console.log('  proviseur@epsin.sn   -> Proviseur, entite SECONDAIRE (6eme -> Terminale)');
    console.log('  censeur@epsin.sn     -> Censeur / vie scolaire');
    console.log('  comptable@epsin.sn   -> Comptable (caisse commune)');
    console.log('  maitre1@epsin.sn     -> Maitre polyvalent (elementaire)');
    console.log('  prof1@epsin.sn       -> Enseignant moyen/secondaire');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Echec du seed :', err.message);
  process.exit(1);
});
