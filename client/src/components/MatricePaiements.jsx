import { useEffect, useMemo, useState } from 'react';
import { Check, MessageCircle, Printer } from 'lucide-react';
import { get, fcfa } from '../lib/api';
import { adressePublique, lienWhatsApp, NUMERO_ENVOI } from '../lib/whatsapp';
import { Chargement, Erreur, Vide } from './ui';

/** "2026-10" -> "oct." ; long : "octobre 2026" */
const moisCourt = (m) => {
  const [a, n] = m.split('-').map(Number);
  return new Date(a, n - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
};
const moisLong = (m) => {
  const [a, n] = m.split('-').map(Number);
  return new Date(a, n - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

/** Apparence de chaque case de la matrice. */
const CASES = {
  paye: { classe: 'bg-emerald-500 text-white', signe: '✓', texte: 'Payé' },
  partiel: { classe: 'bg-amber-400 text-white', signe: '½', texte: 'Partiel' },
  en_retard: { classe: 'bg-red-500 text-white', signe: '✗', texte: 'Non payé' },
  en_verification: { classe: 'bg-sky-500 text-white', signe: '…', texte: 'Wave à vérifier' },
  a_venir: { classe: 'bg-slate-100 text-slate-400 dark:bg-slate-800', signe: '·', texte: 'À venir' },
};

/** Rappel unique au parent : TOUT ce qui reste du a ce jour. */
function messageRelance(eleve, classe, ecole) {
  const lignes = [
    `Bonjour${eleve.tuteur ? ` ${eleve.tuteur}` : ''},`,
    '',
    `${ecole?.nom || 'L\'école'} vous rappelle que les paiements suivants pour *${eleve.prenom} ${eleve.nom}* `
      + `(${classe}) ne sont pas encore réglés :`,
  ];
  if (eleve.inscription?.reste > 0) {
    lignes.push(`• Frais d'inscription : ${eleve.inscription.detail
      .map((d) => `${d.libelle} ${fcfa(d.reste)}`).join(', ')}`);
  }
  for (const m of eleve.mois_en_retard) {
    lignes.push(`• Mensualité de ${moisLong(m.mois)} : ${fcfa(m.reste)}${m.partiel ? ' (reste)' : ''}`);
  }
  lignes.push(
    `*Total à régler à ce jour : ${fcfa(eleve.exigible)}*`,
    '',
    `Vous pouvez payer au secrétariat, ou par Wave depuis le portail des parents : ${adressePublique()}`,
    'Si vous avez déjà payé, merci de ne pas tenir compte de ce message.',
    '',
    `${ecole?.nom || 'EPSIN'}${ecole?.telephone ? ` — ${ecole.telephone}` : ''}`,
  );
  return lignes.join('\n');
}

/** Rappels deja envoyes (aide-memoire sur ce poste), par semaine. */
function useRelances() {
  const lundi = new Date();
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const cle = `epsin-relances-matrice-${lundi.toISOString().slice(0, 10)}`;
  const [faits, setFaits] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(cle) || '[]')); } catch { return new Set(); }
  });
  const marquer = (id) => setFaits((avant) => {
    const apres = new Set(avant).add(id);
    try { localStorage.setItem(cle, JSON.stringify([...apres])); } catch { /* stockage indisponible */ }
    return apres;
  });
  return [faits, marquer];
}

/**
 * Matrice des paiements : une ligne par eleve, une colonne pour les frais
 * d inscription puis une par mois. On voit d un coup d oeil qui n a pas
 * paye janvier mais a paye fevrier, et le rappel WhatsApp reprend tous les
 * impayes de l eleve en un seul message.
 */
export default function MatricePaiements() {
  const [classeId, setClasseId] = useState('');
  const [enRetardSeulement, setEnRetardSeulement] = useState(true);
  const [donnees, setDonnees] = useState(null);
  const [classes, setClasses] = useState([]);
  const [erreur, setErreur] = useState('');
  const [ecole, setEcole] = useState(null);
  const [relances, marquer] = useRelances();

  useEffect(() => { get('/etablissement').then(setEcole).catch(() => {}); }, []);
  useEffect(() => {
    setDonnees(null);
    get(`/finances/matrice${classeId ? `?classe_id=${classeId}` : ''}`)
      .then((d) => { setDonnees(d); if (!classeId) setClasses(d.classes.map((c) => ({ id: c.id, libelle: c.libelle }))); })
      .catch((e) => setErreur(e.message));
  }, [classeId]);

  const lignesParClasse = useMemo(() => (donnees?.classes || []).map((c) => ({
    ...c,
    eleves: c.eleves.filter((e) => !enRetardSeulement || e.exigible > 0),
  })).filter((c) => c.eleves.length), [donnees, enRetardSeulement]);

  if (erreur) return <Erreur message={erreur} />;

  const enRetard = (donnees?.classes || []).flatMap((c) => c.eleves).filter((e) => e.exigible > 0);
  const totalDu = enRetard.reduce((s, e) => s + e.exigible, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="etiquette" htmlFor="matrice-classe">Classe</label>
          <select id="matrice-classe" className="champ w-auto" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={enRetardSeulement} onChange={(e) => setEnRetardSeulement(e.target.checked)} />
          Seulement les élèves qui doivent un paiement
        </label>
        <button type="button" className="bouton-secondaire ml-auto" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer
        </button>
      </div>

      {/* Legende */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        {Object.values(CASES).map((c) => (
          <span key={c.texte} className="flex items-center gap-1.5">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${c.classe}`}>{c.signe}</span>
            {c.texte}
          </span>
        ))}
      </div>

      {!donnees ? <Chargement /> : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{enRetard.length}</strong> élève{enRetard.length > 1 ? 's' : ''} doi{enRetard.length > 1 ? 'vent' : 't'} un
            paiement à ce jour, pour un total de <strong className="text-red-600">{fcfa(totalDu)}</strong>.
            <span className="print:hidden"> Le rappel WhatsApp reprend tous les impayés de l'élève (compte de l'école : {NUMERO_ENVOI}).</span>
          </p>

          {lignesParClasse.length === 0 ? (
            <Vide titre="Personne ne doit de paiement" texte="Tous les élèves sont à jour à ce jour." />
          ) : lignesParClasse.map((c) => (
            <section key={c.id} className="carte overflow-hidden break-inside-avoid">
              <h3 className="border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 font-semibold">
                {c.libelle} <span className="text-sm font-normal text-slate-500">· {c.eleves.length} élève{c.eleves.length > 1 ? 's' : ''}</span>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500">
                      <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium dark:bg-slate-900">Élève</th>
                      <th className="px-1 py-2 font-medium" title="Frais d'inscription">Inscr.</th>
                      {donnees.mois.map((m) => (
                        <th key={m} className={`px-1 py-2 font-medium capitalize ${m === donnees.mois_courant ? 'text-marine-600' : ''}`}>
                          {moisCourt(m)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">À régler</th>
                      <th className="px-2 py-2 print:hidden" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {c.eleves.map((e) => {
                      const lien = e.exigible > 0 ? lienWhatsApp(e.telephone, messageRelance(e, c.libelle, ecole)) : null;
                      const fait = relances.has(e.id);
                      return (
                        <tr key={e.id}>
                          <td className="sticky left-0 z-10 bg-white px-3 py-1.5 dark:bg-slate-900">
                            <span className="block max-w-[11rem] truncate font-medium">{e.prenom} {e.nom}</span>
                            <span className="block text-xs text-slate-400">
                              {e.cas_social ? 'Cas social — dispensé' : (e.telephone || 'Aucun numéro de tuteur')}
                            </span>
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            {e.inscription && e.inscription.du > 0 && (
                              e.inscription.reste > 0 ? (
                                <span title={e.inscription.detail.map((d) => `${d.libelle} : ${fcfa(d.reste)}`).join('\n')}
                                      className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded bg-red-500 px-1 text-[11px] font-bold text-white">
                                  ✗
                                </span>
                              ) : (
                                <span title="Frais d'inscription réglés"
                                      className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-500 text-[11px] font-bold text-white">✓</span>
                              )
                            )}
                          </td>
                          {donnees.mois.map((m) => {
                            const x = e.mois[m];
                            if (!x) return <td key={m} className="px-1 py-1.5" />;
                            const apparence = CASES[x.statut];
                            return (
                              <td key={m} className="px-1 py-1.5 text-center">
                                <span title={`${moisLong(m)} : ${apparence.texte}${x.reste > 0 ? ` — reste ${fcfa(x.reste)}` : ''}`}
                                      className={`inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${apparence.classe}`}>
                                  {apparence.signe}
                                </span>
                              </td>
                            );
                          })}
                          <td className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${e.exigible > 0 ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                            {e.exigible > 0 ? fcfa(e.exigible) : '—'}
                          </td>
                          <td className="px-2 py-1.5 print:hidden">
                            {e.exigible > 0 && (lien ? (
                              <a href={lien} target="_blank" rel="noopener noreferrer" onClick={() => marquer(e.id)}
                                 title="Rappel de tous les impayés par WhatsApp"
                                 className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold ${fait
                                   ? 'border border-emerald-300 text-emerald-700 dark:text-emerald-400'
                                   : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                                {fait ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                                {fait ? 'Relancé' : 'Rappel'}
                              </a>
                            ) : (
                              <span className="text-xs text-amber-600">Pas de numéro</span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
