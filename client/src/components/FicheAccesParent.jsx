import { useEffect, useState } from 'react';
import { KeyRound, Printer } from 'lucide-react';
import { get } from '../lib/api';
import { Modale } from './ui';

/** Echappe un texte avant de l ecrire dans le HTML de la fiche. */
function html(valeur) {
  return String(valeur ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Fiche d acces remise au parent : identifiant et mot de passe a usage
 * unique. Imprimee dans une fenetre a part, pour que seule la fiche sorte
 * sur le papier. Le mot de passe n est visible qu ici : le serveur ne le
 * conserve pas en clair et ne pourra plus le redonner.
 */
function imprimerFiche({ etablissement, eleve, compte }) {
  const site = window.location.origin;
  const fenetre = window.open('', '_blank');
  if (!fenetre) return false;
  fenetre.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Accès parent — ${html(eleve.prenom)} ${html(eleve.nom)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #000;
         margin: 0; padding: 32px; }
  .fiche { max-width: 640px; margin: 0 auto; border: 2px solid #000; padding: 28px; }
  header { display: flex; gap: 14px; align-items: center; border-bottom: 2px solid #000;
           padding-bottom: 14px; }
  header img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; }
  h1 { font-size: 20px; margin: 18px 0 4px; }
  .eleve { margin: 0 0 18px; }
  .acces { border: 1px dashed #000; padding: 14px 18px; margin: 14px 0; }
  .acces p { margin: 6px 0; }
  .valeur { font-family: ui-monospace, Consolas, monospace; font-size: 20px; font-weight: 700;
            letter-spacing: 1px; }
  ol { padding-left: 20px; line-height: 1.6; }
  .note { font-size: 12px; color: #333; margin-top: 18px; }
  @media print { body { padding: 0; } }
</style></head>
<body><div class="fiche">
  <header>
    <img src="${site}/logo-epsin.jpeg" alt="">
    <div><strong>${html(etablissement?.nom)}</strong><br>${html(etablissement?.sigle || '')}<br>
    ${html([etablissement?.telephone, etablissement?.email].filter(Boolean).join(' · '))}</div>
  </header>
  <h1>Accès au portail des parents</h1>
  <p class="eleve">Élève : <strong>${html(eleve.prenom)} ${html(eleve.nom)}</strong>
    — matricule ${html(eleve.matricule)}${eleve.classe ? ` — ${html(eleve.classe)}` : ''}</p>
  <div class="acces">
    <p>Adresse : <span class="valeur">${html(site)}</span></p>
    <p>Identifiant : <span class="valeur">${html(compte.identifiant)}</span></p>
    <p>Mot de passe : <span class="valeur">${html(compte.mot_de_passe)}</span></p>
  </div>
  <ol>
    <li>Ouvrez l'adresse ci-dessus sur votre téléphone ou un ordinateur.</li>
    <li>Saisissez l'identifiant et le mot de passe, exactement comme écrits.</li>
    <li>Choisissez votre mot de passe personnel : celui de cette fiche ne servira plus.</li>
  </ol>
  <p>Vous pourrez ensuite suivre les notes, les absences et les paiements de votre enfant,
     et régler les mensualités par Wave.</p>
  <p class="note">Gardez cette fiche pour vous. En cas de perte, demandez une nouvelle fiche
     à l'établissement : l'ancien mot de passe cessera alors de fonctionner.
     Fiche éditée le ${new Date().toLocaleDateString('fr-FR')}.</p>
</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`);
  fenetre.document.close();
  return true;
}

/**
 * Fenetre affichee juste apres la creation (ou la reinitialisation) d un
 * compte parent : identifiants a remettre, et impression de la fiche.
 */
export default function FicheAccesParent({ eleve, compte, onFermer }) {
  const [etablissement, setEtablissement] = useState(null);

  useEffect(() => {
    if (compte) get('/etablissement').then(setEtablissement).catch(() => {});
  }, [compte]);

  return (
    <Modale ouverte={Boolean(compte)} onFermer={onFermer} titre="Fiche d'accès parent" taille="sm">
      {compte && eleve && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Compte parent de <strong className="text-slate-800 dark:text-slate-200">
              {eleve.prenom} {eleve.nom}</strong>. Remettez cette fiche au parent : le mot de passe
            ne s'affichera plus ensuite.
          </p>
          <div className="space-y-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500">Identifiant</p>
            <p className="font-mono text-base font-semibold break-all">{compte.identifiant}</p>
            <p className="pt-1 text-xs text-slate-500">Mot de passe à usage unique</p>
            <p className="flex items-center gap-2 font-mono text-2xl font-bold tracking-wider">
              <KeyRound className="h-5 w-5 text-slate-400" /> {compte.mot_de_passe}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            À la première connexion, le parent choisira son propre mot de passe.
          </p>
          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button type="button" className="bouton-secondaire" onClick={onFermer}>Fermer</button>
            <button type="button" className="bouton-primaire"
                    onClick={() => imprimerFiche({ etablissement, eleve, compte })}>
              <Printer className="h-4 w-4" /> Imprimer la fiche
            </button>
          </div>
        </div>
      )}
    </Modale>
  );
}
