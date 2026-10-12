/**
 * Prepare le programme Windows : copie le serveur et l interface du projet
 * dans le dossier du programme, pour qu ils soient embarques a la
 * construction de l installateur.
 *
 *   serveur/    <- ../server/src et ../server/migrations
 *   interface/  <- ../client/dist (construit au besoin)
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(dirname(fileURLToPath(import.meta.url)));
const projet = dirname(ici);

console.log('Interface : construction…');
execSync('npm run build', { cwd: join(projet, 'client'), stdio: 'inherit' });

for (const cible of ['serveur', 'interface']) rmSync(join(ici, cible), { recursive: true, force: true });
cpSync(join(projet, 'server', 'src'), join(ici, 'serveur', 'src'), { recursive: true });
cpSync(join(projet, 'server', 'migrations'), join(ici, 'serveur', 'migrations'), { recursive: true });
cpSync(join(projet, 'client', 'dist'), join(ici, 'interface'), { recursive: true });

if (!existsSync(join(ici, 'icone.png'))) {
  cpSync(join(projet, 'client', 'public', 'logo-epsin.jpeg'), join(ici, 'icone-source.jpeg'));
  console.log('Attention : icone.png absente (icone par defaut a la construction).');
}
console.log('Serveur et interface copies dans le programme.');
