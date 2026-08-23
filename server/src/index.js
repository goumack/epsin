import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import elevesRoutes from './routes/eleves.js';
import notesRoutes from './routes/notes.js';
import financesRoutes from './routes/finances.js';
import scolariteRoutes from './routes/scolarite.js';
import vieScolaireRoutes from './routes/vie-scolaire.js';
import communicationRoutes from './routes/communication.js';
import tableauBordRoutes from './routes/tableau-bord.js';
import personnelRoutes from './routes/personnel.js';
import parcoursRoutes from './routes/parcours.js';
import modulesRoutes from './routes/modules.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));
app.use(express.json({ limit: '2mb' }));
// Les logs HTTP noieraient la sortie des tests
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Protection contre le bourrage de mots de passe
// Protection contre le bourrage de mots de passe.
//
// Deux choix importants pour un usage en etablissement :
//   1. Seuls les ECHECS sont comptes (skipSuccessfulRequests) : se connecter
//      normalement ne consomme jamais le quota.
//   2. Le compteur est indexe sur l IDENTIFIANT vise, pas sur l adresse IP.
//      Toute l ecole sort souvent derriere un seul routeur : compter par IP
//      verrouillerait tout le monde des qu une personne se trompe.
//      Comptabiliser par identifiant limite bien le bourrage d un compte
//      donne, qui est la menace reelle.
app.use('/api/auth/connexion', rateLimit({
  windowMs: Number(process.env.LOGIN_WINDOW_MIN || 15) * 60 * 1000,
  max: Number(process.env.LOGIN_MAX_ECHECS || 20),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const id = String(req.body?.identifiant || '').trim().toLowerCase();
    return id || req.ip;   // sans identifiant fourni, on retombe sur l IP
  },
  message: { erreur: 'Trop de tentatives echouees sur ce compte, reessayez dans quelques minutes' },
  standardHeaders: true,
  legacyHeaders: false,
}));

app.get('/api/sante', (req, res) => res.json({ statut: 'ok', heure: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/eleves', elevesRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/scolarite', scolariteRoutes);
app.use('/api/vie-scolaire', vieScolaireRoutes);
app.use('/api/communication', communicationRoutes);
app.use('/api/tableau-bord', tableauBordRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/parcours', parcoursRoutes);
app.use('/api', modulesRoutes);

app.use((req, res) => res.status(404).json({ erreur: 'Route introuvable' }));

// Gestionnaire d erreurs centralise
app.use((err, req, res, _next) => {
  console.error('[erreur]', err.message);
  const status = err.status || 500;
  res.status(status).json({
    erreur: status === 500 ? 'Erreur interne du serveur' : err.message,
  });
});

// L app est exportee pour que les tests l attaquent en memoire, sans ouvrir
// de port. En dehors du mode test, le comportement est inchange.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`EPSIN API demarree sur http://localhost:${PORT}`);
  });
}

export default app;
