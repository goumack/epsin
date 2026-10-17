import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageCircle, Printer, X } from 'lucide-react';
import { get, fcfa, dateFr } from '../lib/api';
import { lienWhatsApp, NUMERO_ENVOI } from '../lib/whatsapp';
import { useAuth } from '../context/AuthContext';
import { Chargement, Erreur } from '../components/ui';
import { libelleMois } from '../components/PaiementWave';

const MODES = {
  especes: 'Espèces', wave: 'Wave', om: 'Orange Money',
  cheque: 'Chèque', virement: 'Virement',
};

/** Mois en toutes lettres, avec majuscule : « Oct. 2025 ». */
const moisMaj = (m) => { const t = libelleMois(m); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Le recu en texte, pour WhatsApp : detail, total, situation de l eleve. */
export function messageRecu(recu, numero) {
  const { etablissement: etab, eleve } = recu;
  const ecole = etab?.nom || 'EPSIN';
  const lignes = [
    `Bonjour${eleve?.tuteur ? ` ${eleve.tuteur}` : ''},`,
    '',
    `${ecole} confirme le paiement reçu le ${dateFr(recu.date_paiement)} pour `
      + `*${eleve?.prenom} ${eleve?.nom}*${eleve?.classe ? ` (${eleve.classe})` : ''} :`,
    ...recu.lignes.filter((l) => !l.annule).map((l) =>
      `• ${l.frais || 'Contribution volontaire'}${l.mois ? ` — ${moisMaj(l.mois)}` : ''} : ${fcfa(l.montant)}`),
    `*Total payé : ${fcfa(recu.total)}*`,
    `Mode : ${MODES[recu.mode] || recu.mode}${recu.reference ? ` (réf. ${recu.reference})` : ''}`,
    `Reçu N° ${numero}`,
  ];
  if (recu.situation?.cas_social) {
    lignes.push('', "Scolarité prise en charge par l'établissement : aucun frais n'est dû. Merci pour cette contribution.");
  } else if (recu.situation) {
    lignes.push('', "*Situation de l'élève*");
    for (const m of recu.situation.mensualites) {
      lignes.push(`${m.libelle} : ${m.regle_jusqu_a ? `réglée jusqu'à ${moisMaj(m.regle_jusqu_a)}` : 'aucun mois réglé'}`);
    }
    lignes.push(recu.situation.reste > 0
      ? `Reste à payer à ce jour : ${fcfa(recu.situation.reste)}`
      : 'À jour de ses paiements. Merci !');
  }
  lignes.push('', `${ecole}${etab?.telephone ? ` — ${etab.telephone}` : ''}`);
  return lignes.join('\n');
}

/** Envoi du recu au tuteur par WhatsApp, depuis le compte de l ecole. */
function EnvoiWhatsApp({ recu, numero }) {
  const [telephone, setTelephone] = useState(recu.eleve?.tuteur_telephone || '');
  const lien = lienWhatsApp(telephone, messageRecu(recu, numero));
  return (
    <div className="mx-auto mb-4 max-w-2xl px-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <label htmlFor="wa-recu" className="text-sm font-medium text-slate-700">Envoyer au tuteur par WhatsApp :</label>
        <input id="wa-recu" className="champ w-44" inputMode="tel" placeholder="77 123 45 67"
               value={telephone} onChange={(e) => setTelephone(e.target.value)} />
        <a href={lien || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!lien}
           className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white ${
             lien ? 'bg-emerald-600 hover:bg-emerald-700' : 'pointer-events-none bg-slate-300'}`}>
          <MessageCircle className="h-4 w-4" /> Envoyer par WhatsApp
        </a>
        <p className="w-full text-xs text-slate-500">
          {telephone && !lien ? 'Numéro incomplet. ' : ''}
          WhatsApp s'ouvre avec le reçu prêt : vérifiez qu'il s'agit du compte de l'école ({NUMERO_ENVOI}),
          puis appuyez sur Envoyer.
        </p>
      </div>
    </div>
  );
}

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
  const { aRole } = useAuth();

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
      {/* Le personnel envoie le recu ; le parent, lui, le consulte */}
      {!recu.annule && aRole('admin', 'comptable') && <EnvoiWhatsApp recu={recu} numero={numero} />}

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

        {/* Eleve : identite, classe, tuteur */}
        <section className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <p><span className="text-slate-600">Élève :</span> <strong>{eleve?.prenom} {eleve?.nom}</strong></p>
          <p><span className="text-slate-600">Matricule :</span> <span className="font-mono">{eleve?.matricule}</span></p>
          {(eleve?.date_naissance || eleve?.lieu_naissance) && (
            <p>
              <span className="text-slate-600">{eleve?.sexe === 'F' ? 'Née' : 'Né'} :</span>
              {eleve?.date_naissance && <> le {dateFr(eleve.date_naissance)}</>}
              {eleve?.lieu_naissance && <> à {eleve.lieu_naissance}</>}
            </p>
          )}
          {eleve?.sexe && (
            <p><span className="text-slate-600">Sexe :</span> {eleve.sexe === 'F' ? 'Féminin' : 'Masculin'}</p>
          )}
          <p>
            <span className="text-slate-600">Classe :</span> <strong>{eleve?.classe || '—'}</strong>
            {eleve?.niveau && eleve.niveau !== eleve.classe && <> ({eleve.niveau})</>}
          </p>
          <p><span className="text-slate-600">Année scolaire :</span> {eleve?.annee || '—'}</p>
          {eleve?.tuteur && (
            <p className="col-span-2">
              <span className="text-slate-600">Tuteur :</span> {eleve.tuteur}
              {eleve.tuteur_lien && <> ({eleve.tuteur_lien})</>}
              {eleve.tuteur_telephone && <> — {eleve.tuteur_telephone}</>}
            </p>
          )}
          {recu.payeur && recu.payeur !== eleve?.tuteur && (
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
                  {l.frais || 'Contribution volontaire'}
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

        {recu.lignes.some((l) => l.annule) && (
          <div className="mt-2 text-xs text-slate-600">
            {recu.lignes.filter((l) => l.annule).map((l) => (
              <p key={l.numero_recu}>
                Ligne {l.numero_recu} annulée{l.annule_le ? ` le ${dateFr(l.annule_le)}` : ''}
                {l.annule_par ? ` par ${l.annule_par}` : ''}{l.motif_annulation ? ` — motif : ${l.motif_annulation}` : ''}.
              </p>
            ))}
          </div>
        )}

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

        {/* Situation de l eleve a la date d edition */}
        {recu.situation && !recu.annule && (
          <section className="mt-4 rounded border border-black p-3 text-sm">
            <p className="mb-1 font-semibold">Situation de l'élève au {new Date().toLocaleDateString('fr-FR')}</p>
            {recu.situation.cas_social && (
              <p>
                Scolarité prise en charge par l'établissement (cas social) : aucun frais n'est dû.
                Ce versement est enregistré en « Autres recettes ».
              </p>
            )}
            {recu.situation.mensualites.map((m) => (
              <p key={m.libelle}>
                {m.libelle} : {m.regle_jusqu_a
                  ? <>réglée jusqu'à <strong className="capitalize">{libelleMois(m.regle_jusqu_a)}</strong></>
                  : 'aucun mois réglé'}
                {m.mois_restants > 0
                  ? <> — {m.mois_restants} mois restant{m.mois_restants > 1 ? 's' : ''} sur l'année</>
                  : <> — année entièrement réglée</>}
              </p>
            ))}
            {!recu.situation.cas_social && <p className="mt-1">
              Dû à ce jour : {fcfa(recu.situation.total_du)} — Payé : {fcfa(recu.situation.total_paye)} —{' '}
              {recu.situation.reste > 0
                ? <strong>Reste à payer : {fcfa(recu.situation.reste)}</strong>
                : <strong>À jour de ses paiements</strong>}
            </p>}
          </section>
        )}

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
