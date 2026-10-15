import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, MessageCircle, Check, Printer } from 'lucide-react';
import { get, fcfa } from '../lib/api';
import { adressePublique, lienWhatsApp, NUMERO_ENVOI } from '../lib/whatsapp';
import { libelleMois } from './PaiementWave';
import { Chargement, Erreur, Puce, Statistique, Vide } from './ui';

const STATUTS = {
  paye: { ton: 'succes', texte: 'Payé' },
  en_verification: { ton: 'info', texte: 'Wave à vérifier' },
  partiel: { ton: 'alerte', texte: 'Partiel' },
  non_paye: { ton: 'danger', texte: 'Non payé' },
  sans_mensualite: { ton: 'neutre', texte: 'Pas de mensualité' },
  cas_social: { ton: 'neutre', texte: 'Cas social' },
};
/** Eleves sans mensualite due ce mois : ni comptes ni relances. */
const HORS_SUIVI = ['sans_mensualite', 'cas_social'];
const A_RELANCER = ['non_paye', 'partiel'];

/** "2026-10" -> "octobre 2026" */
const moisLong = (m) => {
  const [a, n] = m.split('-').map(Number);
  return new Date(a, n - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Rappel de paiement envoye au tuteur par WhatsApp. */
function messageRappel({ eleve, classe, mois, ecole }) {
  const autres = eleve.mois_retard.filter((m) => m !== mois);
  const lignes = [
    `Bonjour${eleve.tuteur ? ` ${eleve.tuteur}` : ''},`,
    '',
    `${ecole?.nom || 'L\'école'} vous rappelle que la mensualité de *${moisLong(mois)}* `
      + `pour *${eleve.prenom} ${eleve.nom}* (${classe}) `
      + (eleve.statut === 'partiel'
        ? `n'est que partiellement réglée : il reste *${fcfa(eleve.reste)}*.`
        : `n'est pas encore réglée : *${fcfa(eleve.reste)}*.`),
  ];
  if (autres.length) {
    lignes.push(`Mois précédents non réglés : ${autres.map(libelleMois).join(', ')}. `
      + `Total à régler à ce jour : *${fcfa(eleve.retard)}*.`);
  }
  lignes.push(
    '',
    `Vous pouvez payer au secrétariat, ou par Wave depuis le portail des parents : ${adressePublique()}`,
    'Si vous avez déjà payé, merci de ne pas tenir compte de ce message.',
    '',
    `${ecole?.nom || 'EPSIN'}${ecole?.telephone ? ` — ${ecole.telephone}` : ''}`,
  );
  return lignes.join('\n');
}

/** Rappels deja envoyes ce mois-ci, retenus sur ce poste (simple aide-memoire). */
function useRelances(mois) {
  const cle = `epsin-relances-${mois}`;
  const [faits, setFaits] = useState(() => new Set());
  useEffect(() => {
    try { setFaits(new Set(JSON.parse(localStorage.getItem(cle) || '[]'))); } catch { setFaits(new Set()); }
  }, [cle]);
  const marquer = (id) => setFaits((avant) => {
    const apres = new Set(avant).add(id);
    try { localStorage.setItem(cle, JSON.stringify([...apres])); } catch { /* stockage indisponible */ }
    return apres;
  });
  return [faits, marquer];
}

/**
 * Suivi du mois pour la caisse : classe par classe, qui a paye la
 * mensualite du mois et qui ne l a pas payee, avec un rappel WhatsApp pret
 * pour chaque parent a relancer.
 */
export default function SuiviMois() {
  const [mois, setMois] = useState('');
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');
  const [classeId, setClasseId] = useState('');
  const [filtre, setFiltre] = useState('a_relancer');
  const [ecole, setEcole] = useState(null);
  const [relances, marquer] = useRelances(donnees?.mois || mois);

  useEffect(() => { get('/etablissement').then(setEcole).catch(() => {}); }, []);
  useEffect(() => {
    setDonnees(null);
    get(`/finances/suivi-mois${mois ? `?mois=${mois}` : ''}`)
      .then((d) => { setDonnees(d); if (!mois) setMois(d.mois); })
      .catch((e) => setErreur(e.message));
  }, [mois]);

  const classes = useMemo(() => (donnees?.classes || [])
    .filter((c) => !classeId || String(c.id) === classeId), [donnees, classeId]);

  const tous = classes.flatMap((c) => c.eleves.filter((e) => !HORS_SUIVI.includes(e.statut)));
  const payes = tous.filter((e) => e.statut === 'paye' || e.statut === 'en_verification');
  const aRelancer = tous.filter((e) => A_RELANCER.includes(e.statut));
  const attendu = tous.reduce((s, e) => s + e.du, 0);
  const encaisse = tous.reduce((s, e) => s + e.verse, 0);

  const visible = (e) => (filtre === 'a_relancer' ? A_RELANCER.includes(e.statut)
    : filtre === 'payes' ? !A_RELANCER.includes(e.statut) : true);

  if (erreur) return <Erreur message={erreur} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="etiquette" htmlFor="suivi-mois">Mois</label>
          <select id="suivi-mois" className="champ w-auto capitalize" value={mois} onChange={(e) => setMois(e.target.value)}>
            {(donnees?.mois_disponibles || (mois ? [mois] : [])).map((m) => (
              <option key={m} value={m} className="capitalize">{moisLong(m)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiquette" htmlFor="suivi-classe">Classe</label>
          <select id="suivi-classe" className="champ w-auto" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {(donnees?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </select>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1" role="tablist" aria-label="Afficher">
          {[['a_relancer', 'À relancer'], ['payes', 'Payés'], ['tous', 'Tous']].map(([cle, texte]) => (
            <button key={cle} type="button" role="tab" aria-selected={filtre === cle}
                    onClick={() => setFiltre(cle)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${filtre === cle
                      ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {texte}
            </button>
          ))}
        </div>
        <button type="button" className="bouton-secondaire ml-auto" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer la liste
        </button>
      </div>

      {!donnees ? <Chargement /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Statistique titre={`Ont payé ${moisLong(donnees.mois)}`} valeur={`${payes.length} / ${tous.length}`}
                         icone={CheckCircle2} ton="succes" />
            <Statistique titre="À relancer" valeur={aRelancer.length} icone={AlertTriangle} ton="alerte" />
            <Statistique titre="Encaissé sur le mois" valeur={`${fcfa(encaisse)} / ${fcfa(attendu)}`}
                         icone={CheckCircle2} ton="info" />
          </div>
          <p className="text-xs text-slate-500 print:hidden">
            « Rappel » ouvre WhatsApp avec le message prêt pour le parent : vérifiez qu'il s'agit du compte de
            l'école ({NUMERO_ENVOI}), puis appuyez sur Envoyer. Les rappels envoyés sont cochés sur cet ordinateur.
          </p>

          {classes.length === 0 ? <Vide titre="Aucun élève inscrit" /> : classes.map((c) => {
            const eleves = c.eleves.filter((e) => !HORS_SUIVI.includes(e.statut));
            const ok = eleves.filter((e) => !A_RELANCER.includes(e.statut)).length;
            // « Tous » montre aussi les cas sociaux, sans les compter
            const lignes = (filtre === 'tous' ? c.eleves.filter((e) => e.statut !== 'sans_mensualite') : eleves)
              .filter(visible);
            return (
              <section key={c.id} className="carte overflow-hidden break-inside-avoid">
                <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5">
                  <h3 className="font-semibold">{c.libelle}</h3>
                  <span className="text-sm text-slate-500">{ok} / {eleves.length} ont payé</span>
                  <div className="ml-auto h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full bg-emerald-500" style={{ width: `${eleves.length ? (ok / eleves.length) * 100 : 0}%` }} />
                  </div>
                </header>
                {lignes.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-500">
                    {filtre === 'a_relancer' ? 'Tout le monde a payé ce mois-ci.' : 'Aucun élève.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {lignes.map((e) => {
                      const lien = A_RELANCER.includes(e.statut)
                        ? lienWhatsApp(e.telephone, messageRappel({ eleve: e, classe: c.libelle, mois: donnees.mois, ecole }))
                        : null;
                      const fait = relances.has(e.id);
                      return (
                        <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{e.prenom} {e.nom}</span>
                            <span className="ml-2 font-mono text-xs text-slate-400">{e.matricule}</span>
                            <span className="block text-xs text-slate-500">
                              {e.tuteur || 'Tuteur non renseigné'}{e.telephone ? ` · ${e.telephone}` : ''}
                              {e.mois_retard.length > 1 && (
                                <span className="text-red-600"> · {e.mois_retard.length} mois en retard ({fcfa(e.retard)})</span>
                              )}
                            </span>
                          </span>
                          <Puce ton={STATUTS[e.statut].ton}>{STATUTS[e.statut].texte}</Puce>
                          <span className="w-28 text-right tabular-nums">
                            {A_RELANCER.includes(e.statut)
                              ? <strong className="text-red-600">{fcfa(e.reste)}</strong>
                              : e.statut === 'cas_social'
                                ? <span className="text-slate-400">Dispensé</span>
                                : <span className="text-emerald-600">{fcfa(e.verse + e.en_verification)}</span>}
                          </span>
                          {A_RELANCER.includes(e.statut) && (
                            <span className="w-28 text-right print:hidden">
                              {lien ? (
                                <a href={lien} target="_blank" rel="noopener noreferrer" onClick={() => marquer(e.id)}
                                   className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${fait
                                     ? 'border border-emerald-300 text-emerald-700 dark:text-emerald-400'
                                     : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                                   title={fait ? 'Rappel déjà envoyé — renvoyer' : 'Envoyer un rappel par WhatsApp'}>
                                  {fait ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                                  {fait ? 'Relancé' : 'Rappel'}
                                </a>
                              ) : (
                                <span className="text-xs text-slate-400">Pas de numéro</span>
                              )}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
