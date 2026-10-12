import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { get, fcfa, dateFr } from '../lib/api';
import { Chargement, Erreur } from '../components/ui';

/**
 * Fiche d inscription imprimable : identite de l eleve, classe, tuteurs,
 * reglement des frais d inscription et acces du parent au portail.
 *
 * Page a part (nouvel onglet) pour que seule la fiche sorte sur le papier,
 * comme le recu de paiement. Le mot de passe du parent n y figure que tant
 * qu il n a pas ete remplace par le sien.
 */
export default function FicheInscription() {
  const { id } = useParams();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [eleve, etablissement, annees, situation, recus] = await Promise.all([
          get(`/eleves/${id}`),
          get('/etablissement').catch(() => null),
          get('/scolarite/annees').catch(() => []),
          get(`/finances/situation/${id}`).catch(() => null),
          // Reserve a la caisse : la direction imprime la fiche sans les recus
          get(`/finances/recus?eleve_id=${id}`).catch(() => []),
        ]);
        setDonnees({ eleve, etablissement, annee: annees.find((a) => a.active), situation, recus });
        document.title = `Fiche d'inscription — ${eleve.prenom} ${eleve.nom}`;
      } catch (e) {
        setErreur(e.message);
      }
    })();
  }, [id]);

  if (erreur) return <div className="mx-auto max-w-xl p-6"><Erreur message={erreur} /></div>;
  if (!donnees) return <div className="flex min-h-screen items-center justify-center"><Chargement /></div>;

  const { eleve, etablissement: etab, annee, situation, recus } = donnees;
  const compte = eleve.compte_parent;
  // Inscription = frais ponctuels obligatoires + premier mois de mensualite
  const lignes = situation?.lignes || [];
  const ponctuels = lignes.filter((l) => !l.recurrent && l.obligatoire);
  const mensualite = lignes.find((l) => l.recurrent && l.obligatoire);
  const inscription = [
    ...ponctuels.map((l) => ({
      id: l.id, libelle: l.libelle, du: Number(l.montant), paye: Math.min(Number(l.paye), Number(l.montant)),
    })),
    ...(mensualite ? [{
      id: mensualite.id, libelle: `${mensualite.libelle} (1er mois)`,
      du: Number(mensualite.montant), paye: Math.min(Number(mensualite.paye), Number(mensualite.montant)),
    }] : []),
  ];
  const totalInscription = inscription.reduce((s, l) => s + l.du, 0);
  const payeInscription = inscription.reduce((s, l) => s + l.paye, 0);
  const recusInscription = recus;

  const champ = (libelle, valeur) => (
    <p><span className="text-slate-600">{libelle} :</span> <strong>{valeur || '—'}</strong></p>
  );

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-2xl justify-end gap-2 px-4 print:hidden">
        <button type="button" onClick={() => window.close()} className="bouton-secondaire">
          <X className="h-4 w-4" /> Fermer
        </button>
        <button type="button" onClick={() => window.print()} className="bouton-primaire">
          <Printer className="h-4 w-4" /> Imprimer
        </button>
      </div>

      <article className="mx-auto max-w-2xl bg-white p-8 text-sm text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
          <div className="flex items-start gap-3">
            <img src="/logo-epsin.jpeg" alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
            <div>
              <p className="text-base font-bold">{etab?.nom}</p>
              {etab?.sigle && <p className="font-semibold">{etab.sigle}</p>}
              {etab?.adresse && <p>{etab.adresse}</p>}
              <p>{[etab?.telephone, etab?.email].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-wide">FICHE D'INSCRIPTION</p>
            <p>Année scolaire {annee?.libelle || '—'}</p>
            <p className="font-mono font-semibold">{eleve.matricule}</p>
          </div>
        </header>

        <section className="mt-5">
          <h2 className="mb-2 border-b border-slate-300 pb-1 font-bold uppercase tracking-wide">Élève</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {champ('Prénom', eleve.prenom)}
            {champ('Nom', eleve.nom)}
            {champ('Sexe', eleve.sexe === 'F' ? 'Féminin' : eleve.sexe === 'M' ? 'Masculin' : null)}
            {champ('Date de naissance', eleve.date_naissance ? dateFr(eleve.date_naissance) : null)}
            {champ('Lieu de naissance', eleve.lieu_naissance)}
            {champ('Nationalité', eleve.nationalite)}
            {champ('Classe', eleve.classe || 'À affecter')}
            {champ('Niveau', eleve.niveau)}
            <div className="col-span-2">{champ('Adresse', eleve.adresse)}</div>
          </div>
        </section>

        <section className="mt-5">
          <h2 className="mb-2 border-b border-slate-300 pb-1 font-bold uppercase tracking-wide">Tuteurs</h2>
          {eleve.tuteurs?.length ? (
            <table className="w-full border-collapse">
              <tbody>
                {eleve.tuteurs.map((t) => (
                  <tr key={t.id} className="border-b border-slate-200">
                    <td className="py-1"><strong>{t.prenom} {t.nom}</strong>{t.principal && ' (principal)'}</td>
                    <td className="py-1 capitalize">{t.lien}</td>
                    <td className="py-1 text-right">{t.telephone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>Aucun tuteur enregistré.</p>}
        </section>

        <section className="mt-5">
          <h2 className="mb-2 border-b border-slate-300 pb-1 font-bold uppercase tracking-wide">Frais d'inscription</h2>
          {inscription.length ? (
            <table className="w-full border-collapse">
              <tbody>
                {inscription.map((l) => (
                  <tr key={l.id} className="border-b border-slate-200">
                    <td className="py-1">{l.libelle}</td>
                    <td className="py-1 text-right tabular-nums">{fcfa(l.du)}</td>
                    <td className="py-1 pl-3 text-right">{l.paye >= l.du ? 'réglé' : `reste ${fcfa(l.du - l.paye)}`}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-1">Total à l'inscription</td>
                  <td className="py-1 text-right tabular-nums">{fcfa(totalInscription)}</td>
                  <td className="py-1 pl-3 text-right">
                    {payeInscription >= totalInscription ? 'réglé' : `reste ${fcfa(totalInscription - payeInscription)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : <p>Aucun frais au barème pour cette classe.</p>}
          {recusInscription.length > 0 && (
            <p className="text-slate-600">
              Reçu(s) : {recusInscription.map((r) => `${r.numero_recu} du ${dateFr(r.date_paiement)}`).join(', ')}
            </p>
          )}
        </section>

        <section className="mt-5 border-2 border-dashed border-black p-4">
          <h2 className="mb-2 font-bold uppercase tracking-wide">Accès du parent au portail EPSIN</h2>
          {compte ? (
            <div className="space-y-1">
              <p>Adresse : <span className="font-mono font-semibold">{window.location.origin}</span></p>
              <p>Nom d'utilisateur : <span className="font-mono text-base font-bold">{compte.identifiant}</span></p>
              <p>
                Mot de passe :{' '}
                {compte.mot_de_passe
                  ? <span className="font-mono text-base font-bold tracking-wider">{compte.mot_de_passe}</span>
                  : <em>choisi par le parent (confidentiel)</em>}
              </p>
              {compte.mot_de_passe && (
                <p className="pt-1 text-xs">
                  À la première connexion, le parent choisit son propre mot de passe : celui-ci cessera
                  alors de fonctionner. Il pourra suivre notes, absences et paiements, et régler les
                  mensualités par Wave.
                </p>
              )}
            </div>
          ) : <p>Compte parent non créé.</p>}
        </section>

        <section className="mt-8 grid grid-cols-2 gap-8">
          <div>
            <p className="font-semibold">Le parent ou tuteur</p>
            <p className="text-xs text-slate-600">Lu et approuvé</p>
            <div className="mt-12 border-t border-dotted border-black" />
          </div>
          <div className="text-right">
            <p className="font-semibold">L'établissement (signature et cachet)</p>
            <div className="mt-16 border-t border-dotted border-black" />
          </div>
        </section>

        <footer className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Fiche éditée le {new Date().toLocaleDateString('fr-FR')} par EPSIN.
        </footer>
      </article>
    </div>
  );
}
