import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/db/pool.js';

/**
 * Utilitaires partages par les tests.
 *
 * Les tests s appuient sur les donnees de demonstration reelles plutot que
 * sur des fixtures inventees : c est ce jeu-la qui tourne en developpement,
 * et une regression sur les vraies donnees est celle qui compte.
 */

const MDP = 'epsin2026';
const jetons = new Map();

/** Jeton d un compte, mis en cache pour ne pas rejouer la connexion. */
export async function jeton(identifiant) {
  if (jetons.has(identifiant)) return jetons.get(identifiant);
  const r = await request(app)
    .post('/api/auth/connexion')
    .send({ identifiant, mot_de_passe: MDP });
  if (!r.body?.token) {
    throw new Error(`Connexion impossible pour ${identifiant} : ${r.body?.erreur || r.status}`);
  }
  jetons.set(identifiant, r.body.token);
  return r.body.token;
}

/** Requete authentifiee : `await api('GET', '/api/eleves', compte)`. */
export async function api(methode, chemin, identifiant, corps) {
  const t = await jeton(identifiant);
  const req = request(app)[methode.toLowerCase()](chemin)
    .set('Authorization', `Bearer ${t}`);
  return corps ? req.send(corps) : req;
}

/** Comptes de demonstration, par role. */
export const COMPTES = {
  admin: 'admin@epsin.sn',
  directeur: 'directeur@epsin.sn',
  proviseur: 'proviseur@epsin.sn',
  censeur: 'censeur@epsin.sn',
  comptable: 'comptable@epsin.sn',
  maitre: 'maitre1@epsin.sn',
  professeur: 'prof1@epsin.sn',
};

/**
 * Identifiants reels tires de la base : ces tests ne doivent pas coder en
 * dur des ids qui changeraient au prochain seed.
 */
export async function contexte() {
  const { rows: annee } = await query(
    `SELECT id FROM annee_scolaire WHERE active LIMIT 1`
  );
  const { rows: periode } = await query(
    `SELECT id FROM periode WHERE annee_id = $1 ORDER BY ordre LIMIT 1`,
    [annee[0].id]
  );
  const { rows: classes } = await query(
    `SELECT c.id, c.libelle, n.entite, n.id AS niveau_id
     FROM classe c JOIN niveau n ON n.id = c.niveau_id
     WHERE c.annee_id = $1`,
    [annee[0].id]
  );

  const classeDe = (libelle) => classes.find((c) => c.libelle === libelle);
  const ci = classeDe('CI A');
  const cp = classeDe('CP A');
  const sixieme = classeDe('6eme A');

  const premierEleve = async (classeId) => {
    const { rows } = await query(
      `SELECT e.id, e.matricule FROM inscription i
       JOIN eleve e ON e.id = i.eleve_id
       WHERE i.classe_id = $1 AND i.annee_id = $2
       ORDER BY e.id LIMIT 1`,
      [classeId, annee[0].id]
    );
    return rows[0];
  };

  return {
    anneeId: annee[0].id,
    periodeId: periode[0].id,
    classes: { ci, cp, sixieme },
    eleveCI: await premierEleve(ci.id),
    eleveCP: await premierEleve(cp.id),
    eleve6eme: await premierEleve(sixieme.id),
  };
}

/** Compte tuteur d un eleve : son matricule en minuscules + @epsin.sn. */
export function compteTuteur(matricule) {
  return `${matricule.toLowerCase()}@epsin.sn`;
}
