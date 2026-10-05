import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { get, fcfa, dateFr } from '../lib/api';
import { Chargement, Erreur } from '../components/ui';
import { libelleMois } from '../components/PaiementWave';

const MODES = {
  especes: 'Espèces', wave: 'Wave', om: 'Orange Money',
  cheque: 'Chèque', virement: 'Virement',
};

/**
 * Recu de paiement imprimable, sur une page a part (ouverte dans un nouvel
 * onglet) : imprimer depuis une fenetre de l application imprimerait aussi
 * la page en arriere-plan.
 *
 * Concu pour l impression : fond blanc, encre noire, pas d ombres. Une
 * ecriture annulee est barree d un filigrane « ANNULE ».
 */
export default function RecuPaiement() {
  const { id } = useParams();
  const [recu, setRecu] = useState(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    get(`/finances/recus/${id}`)
      .then((r) => {
        setRecu(r);
        document.title = `Reçu ${r.numeros[0]} — ${r.eleve?.prenom} ${r.eleve?.nom}`;
      })
      .catch((e) => setErreur(e.message));
  }, [id]);

  if (erreur) return <div className="mx-auto max-w-xl p-6"><Erreur message={erreur} /></div>;
  if (!recu) return <div className="flex min-h-screen items-center justify-center"><Chargement /></div>;

  const { etablissement: etab, eleve, wave } = recu;
  const numero = recu.numeros.length > 1
    ? `${recu.numeros[0]} à ${recu.numeros.at(-1)}`
    : recu.numeros[0];

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

      <article className="recu relative mx-auto max-w-2xl overflow-hidden bg-white p-8 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {recu.annule && (
          <p aria-hidden="true"
             className="pointer-events-none absolute inset-0 flex items-center justify-center text-8xl font-bold tracking-widest text-red-600/20 -rotate-12">
            ANNULÉ
          </p>
        )}

        {/* En-tete : l etablissement */}
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
          <div className="flex items-start gap-3">
            <img src="/logo-epsin.jpeg" alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
            <div className="text-sm">
              <p className="text-base font-bold">{etab?.nom}</p>
              {etab?.sigle && <p className="font-semibold">{etab.sigle}</p>}
              {etab?.adresse && <p>{etab.adresse}</p>}
              <p>{[etab?.telephone, etab?.email].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-bold tracking-wide">REÇU DE PAIEMENT</p>
            <p className="font-mono font-semibold">N° {numero}</p>
            <p>Date : {dateFr(recu.date_paiement)}</p>
          </div>
        </header>

        {/* Eleve et payeur */}
        <section className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <p><span className="text-slate-600">Élève :</span> <strong>{eleve?.prenom} {eleve?.nom}</strong></p>
          <p><span className="text-slate-600">Matricule :</span> <span className="font-mono">{eleve?.matricule}</span></p>
          <p><span className="text-slate-600">Classe :</span> {eleve?.classe || '—'}</p>
          <p><span className="text-slate-600">Année scolaire :</span> {eleve?.annee || '—'}</p>
          {recu.payeur && (
            <p className="col-span-2"><span className="text-slate-600">Reçu de :</span> {recu.payeur}</p>
          )}
        </section>

        {/* Detail */}
        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black">
              <th className="py-2 text-left font-semibold">Désignation</th>
              <th className="py-2 text-left font-semibold">N° de reçu</th>
              <th className="py-2 text-right font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            {recu.lignes.map((l) => (
              <tr key={l.numero_recu} className={`border-b border-slate-300 ${l.annule ? 'line-through text-slate-500' : ''}`}>
                <td className="py-1.5">
                  {l.frais || 'Versement'}
                  {l.mois && <span className="capitalize"> — {libelleMois(l.mois)}</span>}
                </td>
                <td className="py-1.5 font-mono text-xs">{l.numero_recu}</td>
                <td className="py-1.5 text-right tabular-nums">{fcfa(l.montant)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-b-2 border-black">
              <td colSpan={2} className="py-2 font-bold">TOTAL PAYÉ</td>
              <td className="py-2 text-right text-base font-bold tabular-nums">{fcfa(recu.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-4 text-sm">
          Arrêté le présent reçu à la somme de :{' '}
          <strong>{recu.total_lettres.charAt(0).toUpperCase() + recu.total_lettres.slice(1)}</strong>.
        </p>

        {/* Mode de paiement et validation */}
        <section className="mt-4 space-y-0.5 text-sm">
          <p>
            <span className="text-slate-600">Mode de paiement :</span> {MODES[recu.mode] || recu.mode}
            {recu.reference && <> — réf. <span className="font-mono">{recu.reference}</span></>}
            {wave?.telephone_payeur && <> — n° {wave.telephone_payeur}</>}
          </p>
          {recu.valide_par && (
            <p>
              <span className="text-slate-600">{wave ? 'Paiement Wave confirmé par' : 'Encaissé par'} :</span>
              {' '}{recu.valide_par}, le {dateFr(recu.valide_le)}
            </p>
          )}
        </section>

        {/* Signatures */}
        <section className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="font-semibold">Le payeur</p>
            <div className="mt-14 border-t border-dotted border-black" />
          </div>
          <div className="text-right">
            <p className="font-semibold">La caisse (signature et cachet)</p>
            <div className="mt-14 border-t border-dotted border-black" />
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Reçu édité par EPSIN le {new Date().toLocaleDateString('fr-FR')} · Ce reçu fait foi du paiement
          {' '}des montants indiqués. Conservez-le.
        </footer>
      </article>
    </div>
  );
}
