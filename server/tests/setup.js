import dotenv from 'dotenv';

// NODE_ENV=test empeche src/index.js d ouvrir un port : supertest attaque
// l app en memoire.
process.env.NODE_ENV = 'test';
dotenv.config();
