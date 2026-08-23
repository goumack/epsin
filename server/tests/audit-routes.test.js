import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, COMPTES, contexte } from './aides.js';

/**
 * AUDIT — toutes les routes de lecture, avec tous les roles.
 *
 * Les tests cibles verifient ce que je sais avoir construit. Cet audit
 * balaie l INTEGRALITE des routes GET declarees pour debusquer celles qui
 * plantent (500) ou qui ont ete oubliees. Un 403 est un resultat valide :
 * c est le cloisonnement qui fonctionne. Seul un 500 est un defaut.
 */

const DOSSIER = new URL('../src/routes/', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1');

/** Prefixe d URL de chaque fichier de routes, tel que monte dans index.js. */
const PREFIXES = {
  'auth.js': '/api/auth',
  'eleves.js': '/api/eleves',
  'notes.js': '/api/notes',
  'finances.js': '/api/finances',
  'scolarite.js': '/api/scolarite',
  'vie-scolaire.js': '/api/vie-scolaire',
  'communication.js': '/api/communication',
  'tableau-bord.js': '/api/tableau-bord',
  'personnel.js': '/api/personnel',
  'parcours.js': '/api/parcours',
  'modules.js': '/api',
};

let ctx;
let routes;

beforeAll(async () => {
  ctx = await contexte();

  // Extraction des routes GET declarees, avec substitution des parametres
  // par de vrais identifiants tires de la base.
  const substituer = (chemin) => chemin
    .replace(':eleveId', ctx.eleveCI.id)
    .replace(':classeId', ctx.classes.ci.id)
    .replace(':periodeId', ctx.periodeId)
    .replace(':anneeId', ctx.anneeId)
    .replace(':id', '1');

  routes = [];
  for (const fichier of readdirSync(DOSSIER).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    const prefixe = PREFIXES[fichier];
    if (!prefixe) continue;

    for (const m of source.matchAll(/^router\.get\('([^']+)'/gm)) {
      const brut = m[1];
      // Les routes a parametres non reconnus sont ignorees : on ne veut
      // pas fabriquer d URL absurde.
      if (/:(?!eleveId|classeId|periodeId|anneeId|id\b)/.test(brut)) continue;
      const chemin = (prefixe + (brut === '/' ? '' : brut)).replace(/\/$/, '') || '/';
      routes.push({ fichier, chemin: substituer(chemin) });
    }
  }
});

describe('Audit : aucune route de lecture ne plante', () => {
  it('balaie toutes les routes GET avec le compte admin', async () => {
    const casses = [];
    for (const r of routes) {
      const rep = await api('GET', r.chemin, COMPTES.admin);
      // 200 attendu, 404 tolere (ressource absente), 403 impossible en admin
      if (rep.status >= 500) {
        casses.push(`${r.chemin} -> ${rep.status} ${rep.body?.erreur || ''}`);
      }
    }
    expect(casses, `routes en erreur :\n${casses.join('\n')}`).toHaveLength(0);
  });

  it('balaie toutes les routes GET avec chaque role', async () => {
    const casses = [];
    for (const compte of Object.values(COMPTES)) {
      for (const r of routes) {
        const rep = await api('GET', r.chemin, compte);
        if (rep.status >= 500) {
          casses.push(`${compte} ${r.chemin} -> ${rep.status} ${rep.body?.erreur || ''}`);
        }
      }
    }
    expect(casses, `routes en erreur :\n${casses.join('\n')}`).toHaveLength(0);
  });

  it('balaie toutes les routes GET avec un compte tuteur', async () => {
    const tuteur = `${ctx.eleveCI.matricule.toLowerCase()}@epsin.sn`;
    const casses = [];
    for (const r of routes) {
      const rep = await api('GET', r.chemin, tuteur);
      if (rep.status >= 500) {
        casses.push(`${r.chemin} -> ${rep.status} ${rep.body?.erreur || ''}`);
      }
    }
    expect(casses, `routes en erreur :\n${casses.join('\n')}`).toHaveLength(0);
  });

  it('a bien balaye un nombre significatif de routes', () => {
    // Garde-fou : si l extraction casse, l audit passerait a vide.
    expect(routes.length).toBeGreaterThan(25);
  });
});
