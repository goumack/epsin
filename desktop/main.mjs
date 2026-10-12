/**
 * EPSIN — programme Windows du poste de l ecole.
 *
 * Embarque tout ce qu il faut pour travailler SANS INTERNET :
 *   - une base PostgreSQL, dans le dossier de donnees de l utilisateur ;
 *   - le serveur EPSIN (mode « poste ») et l interface ;
 *   - la synchronisation avec le site en ligne, des que la connexion est la.
 *
 * Les autres ordinateurs de l ecole peuvent s y connecter par le reseau
 * local (http://<adresse du poste>:4545), meme sans internet.
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const ici = dirname(fileURLToPath(import.meta.url));
const PORT = 4545;          // interface et API, aussi pour les autres postes
const PORT_BASE = 54329;    // base embarquee, locale seulement
// Dossier des donnees (base, reglages) : celui de l utilisateur Windows,
// sauf si EPSIN_DONNEES en designe un autre (essais, poste particulier)
if (process.env.EPSIN_DONNEES) app.setPath('userData', process.env.EPSIN_DONNEES);
const DONNEES = app.getPath('userData');
const FICHIER_CONFIG = join(DONNEES, 'config.json');
const INTERFACE = app.isPackaged ? join(process.resourcesPath, 'interface') : join(ici, 'interface');
const ICONE = app.isPackaged ? join(process.resourcesPath, 'icone.png') : join(ici, 'icone.png');

let base = null;
let fenetre = null;
let arretEnCours = false;
// Pendant le demarrage, les fenetres se succedent (attente, mise en route) :
// qu aucune ne soit ouverte un instant ne doit pas fermer le programme
let demarrage = true;

// ---------- Configuration locale (secrets generes au premier lancement) ----------

function lireConfig() {
  mkdirSync(DONNEES, { recursive: true });
  let cfg = {};
  if (existsSync(FICHIER_CONFIG)) {
    try { cfg = JSON.parse(readFileSync(FICHIER_CONFIG, 'utf8')); } catch { cfg = {}; }
  }
  const complete = {
    mot_de_passe_base: randomBytes(18).toString('base64url'),
    secret_jetons: randomBytes(48).toString('base64url'),
    sync_url: '',
    sync_jeton: '',
    initialise: false,
    ...cfg,
  };
  ecrireConfig(complete);
  return complete;
}

function ecrireConfig(cfg) {
  writeFileSync(FICHIER_CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Le serveur EPSIN lit sa configuration dans l environnement. */
function configurerEnvironnement(cfg) {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    EPSIN_MODE: 'poste',
    PORT: String(PORT),
    DATABASE_URL: `postgresql://postgres:${encodeURIComponent(cfg.mot_de_passe_base)}@127.0.0.1:${PORT_BASE}/epsin`,
    DATABASE_SSL: 'false',
    JWT_SECRET: cfg.secret_jetons,
    CLIENT_DIST: INTERFACE,
    SYNC_URL: cfg.sync_url || '',
    SYNC_JETON: cfg.sync_jeton || '',
  });
}

/** Import d un module du serveur embarque. */
const importer = (chemin) => import(pathToFileURL(join(ici, 'serveur', chemin)).href);

// ---------- Base de donnees embarquee ----------

const DOSSIER_BASE = join(DONNEES, 'base');

async function demarrerBase(cfg) {
  const dossier = DOSSIER_BASE;
  base = new EmbeddedPostgres({
    databaseDir: dossier,
    user: 'postgres',
    password: cfg.mot_de_passe_base,
    port: PORT_BASE,
    persistent: true,
    onLog: () => {},
    onError: (e) => console.error('[base]', String(e)),
  });
  if (!existsSync(join(dossier, 'PG_VERSION'))) await base.initialise();
  await base.start();
  try { await base.createDatabase('epsin'); } catch { /* deja creee */ }
}

async function arreterBase() {
  if (!base) return;
  // Les connexions du serveur d abord, puis la base
  try {
    const { pool } = await importer('src/db/pool.js');
    await pool.end();
  } catch { /* serveur pas encore demarre */ }
  // Sous Windows, la bibliotheque tue PostgreSQL de force : on l arrete
  // d abord proprement (fin des ecritures, pas de reprise au prochain demarrage)
  if (process.platform === 'win32' && base.process) {
    const proc = base.process;
    const fini = proc.exitCode === null ? new Promise((ok) => proc.once('exit', ok)) : Promise.resolve();
    try {
      const { pg_ctl } = await import('@embedded-postgres/windows-x64');
      await new Promise((ok, ko) => execFile(pg_ctl, ['stop', '-D', DOSSIER_BASE, '-m', 'fast', '-w', '-t', '20'],
        (err) => (err ? ko(err) : ok())));
      await Promise.race([fini, new Promise((ok) => setTimeout(ok, 5000))]);
      if (proc.exitCode !== null) base.process = undefined;
    } catch (e) { console.error('[base] arret propre', e); }
  }
  try { await base.stop(); } catch (e) { console.error('[base] arret', e); }
  base = null;
}

// ---------- Fenetres ----------

function fenetreSimple(options) {
  return new BrowserWindow({
    icon: ICONE,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(ici, 'preload.cjs') },
    ...options,
  });
}

function fenetreAttente(texte) {
  const f = fenetreSimple({ width: 420, height: 220, resizable: false, frame: false });
  f.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
                 font-family:Segoe UI,system-ui,sans-serif;background:linear-gradient(135deg,#7A0A1B,#3F040E);color:#fff">
      <div style="text-align:center"><div style="font-size:22px;font-weight:700">EPSIN</div>
      <div style="margin-top:10px;color:#E8C88A">${texte}</div></div></body>`)}`);
  return f;
}

/**
 * Mise en route sans ecran, pour un deploiement prepare a l avance :
 * EPSIN_CLONER_URL et EPSIN_CLONER_JETON copient directement le site en ligne.
 */
async function miseEnRouteAutomatique(cfg) {
  const url = String(process.env.EPSIN_CLONER_URL).replace(/\/+$/, '').replace(/\/api$/, '');
  const jeton = String(process.env.EPSIN_CLONER_JETON || '');
  const { pool } = await importer('src/db/pool.js');
  const { cloner, distantHttp } = await importer('src/sync/poste.js');
  await cloner(pool, distantHttp(url, jeton, { delai: 300000 }));
  Object.assign(cfg, { sync_url: url, sync_jeton: jeton, initialise: true });
  ecrireConfig(cfg);
}

/** Premier lancement : recuperer les donnees en ligne, ou base vide. */
function miseEnRoute(cfg) {
  if (process.env.EPSIN_CLONER_URL) return miseEnRouteAutomatique(cfg);
  return new Promise((resolve) => {
    const f = fenetreSimple({ width: 620, height: 720, resizable: false, title: 'EPSIN — mise en route' });
    f.loadFile(join(ici, 'accueil.html'));

    const terminer = () => {
      cfg.initialise = true;
      ecrireConfig(cfg);
      ipcMain.removeHandler('cloner');
      ipcMain.removeHandler('base-vide');
      f.close();
      resolve();
    };

    ipcMain.handle('cloner', async (_e, { url, jeton }) => {
      const adresse = String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
      if (!/^https?:\/\//.test(adresse)) throw new Error('Adresse du serveur en ligne invalide');
      if (String(jeton || '').trim().length < 16) throw new Error('Jeton de synchronisation trop court');
      const { pool } = await importer('src/db/pool.js');
      const { cloner, distantHttp } = await importer('src/sync/poste.js');
      const compte = await cloner(pool, distantHttp(adresse, String(jeton).trim(), { delai: 300000 }));
      cfg.sync_url = adresse;
      cfg.sync_jeton = String(jeton).trim();
      setTimeout(terminer, 1500);
      return compte;
    });

    ipcMain.handle('base-vide', async (_e, { email, motDePasse }) => {
      const { initialiserBase } = await importer('src/db/init-production.js');
      await initialiserBase({ adminEmail: email, adminMotDePasse: motDePasse, journal: () => {} });
      setTimeout(terminer, 800);
      return true;
    });

    f.on('closed', () => {
      // Fenetre fermee sans choix : on quitte, rien n a ete installe
      if (!cfg.initialise) app.quit();
    });
  });
}

/** Adresses par lesquelles les autres ordinateurs de l ecole joignent ce poste. */
function adressesReseau() {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
}

function fenetrePrincipale() {
  fenetre = fenetreSimple({ width: 1360, height: 860, minWidth: 900, minHeight: 600, title: 'EPSIN', show: false });
  fenetre.maximize();
  fenetre.show();
  fenetre.loadURL(`http://localhost:${PORT}`);

  // Recus, fiches : fenetres internes ; liens exterieurs (Wave...) : navigateur
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(`http://localhost:${PORT}`)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICONE } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'EPSIN',
      submenu: [
        {
          label: 'Accès depuis les autres ordinateurs…',
          click: () => {
            const adresses = adressesReseau();
            dialog.showMessageBox(fenetre, {
              type: 'info', title: 'Accès par le réseau de l’école',
              message: 'Sur un autre ordinateur du même réseau, ouvrez dans le navigateur :',
              detail: (adresses.join('\n') || 'Aucun réseau détecté.')
                + '\n\nCe poste doit rester allumé avec EPSIN ouvert. Fonctionne sans internet.',
            });
          },
        },
        { label: 'Ouvrir le dossier des données', click: () => shell.openPath(DONNEES) },
        { type: 'separator' },
        { label: 'Recharger', accelerator: 'F5', click: () => fenetre?.webContents.reload() },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'Ctrl+Q', click: () => app.quit() },
      ],
    },
  ]));
}

async function attendreServeur(delai = 30000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/sante`);
      if (r.ok) return;
    } catch { /* pas encore pret */ }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  throw new Error('Le serveur EPSIN ne demarre pas');
}

// ---------- Demarrage ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
  });

  app.whenReady().then(async () => {
    const cfg = lireConfig();
    let attente = fenetreAttente('Démarrage de la base de données…');
    try {
      await demarrerBase(cfg);
      configurerEnvironnement(cfg);
      const { appliquerMigrations } = await importer('src/db/migrate.js');
      await appliquerMigrations(undefined, { journal: () => {} });

      if (!cfg.initialise) {
        attente.close();
        attente = null;
        await miseEnRoute(cfg);
        if (!cfg.initialise) return;
        attente = fenetreAttente('Ouverture d’EPSIN…');
      }
      // Les reglages de synchronisation ont pu etre saisis a la mise en route
      configurerEnvironnement(cfg);
      await importer('src/index.js');
      await attendreServeur();
      fenetrePrincipale();
      demarrage = false;
    } catch (err) {
      dialog.showErrorBox('EPSIN ne peut pas démarrer', String(err?.message || err));
      demarrage = false;
      app.quit();
    } finally {
      attente?.close();
    }
  });

  // Arret propre de la base avant de quitter
  app.on('before-quit', (e) => {
    if (arretEnCours || !base) return;
    e.preventDefault();
    arretEnCours = true;
    arreterBase().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (!demarrage) app.quit();
  });
}
