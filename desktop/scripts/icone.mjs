// Icone du programme (256 x 256) a partir du logo de l ecole.
// npx electron scripts/icone.mjs
import { app, nativeImage } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(dirname(fileURLToPath(import.meta.url)));
app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(join(ici, '..', 'client', 'public', 'logo-epsin.jpeg'));
  writeFileSync(join(ici, 'icone.png'), logo.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  console.log('icone.png creee');
  app.quit();
});
