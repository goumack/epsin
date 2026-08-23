import { dateFr } from '../lib/api';

/**
 * Bulletin au format officiel senegalais.
 *
 * Reproduit la maquette utilisee dans les etablissements : en-tete
 * administratif (IA / IEF / etablissement), tableau
 * Devoir | Comp | Moy/20 | Coef | Moy x C | Rang | Appreciation,
 * puis les deux grilles de decision du conseil de classe et la signature.
 *
 * Concu pour l impression : bordures noires, fond blanc, pas d ombres.
 */

const APPRECIATIONS = [
  ['satisfaisant', 'Satisfaisant doit continuer'],
  ['peut_mieux_faire', 'Peut Mieux Faire'],
  ['insuffisant', 'Insuffisant'],
  ['risque_redoubler', 'Risque de Redoubler'],
  ['risque_exclusion', "Risque l'exclusion"],
];

const DISTINCTIONS = [
  ['felicitations', 'Félicitations'],
  ['encouragement', 'Encouragement'],
  ['tableau_honneur', "Tableau d'honneur"],
  ['avertissement', 'Avertissement'],
  ['blame', 'Blâme'],
];

export default function BulletinOfficiel({ bulletin }) {
  if (!bulletin) return null;
  const { etablissement: etab, eleve, matieres, synthese, conseil } = bulletin;

  const nb = (v) => (v == null || v === '' ? '' : Number(v));

  return (
    <div className="bulletin-officiel mx-auto max-w-3xl bg-white p-6 text-black">
      {/* En-tete administratif, avec le sceau de l etablissement */}
      <div className="mb-3 flex items-start justify-between gap-3 text-[11px]">
        <div className="flex items-start gap-2.5">
          <img
            src="/logo-epsin.jpeg"
            alt=""
            className="h-14 w-14 shrink-0 rounded-full object-cover"
          />
          <div>
            <p>{etab?.inspection_academie}</p>
            <p>{etab?.inspection_ief}</p>
            <p className="font-semibold">{etab?.nom}</p>
          </div>
        </div>
        <div className="text-right">
          <p>Année Scolaire : {eleve.annee}</p>
          <p>{eleve.periode}</p>
        </div>
      </div>

      <h2 className="mb-3 text-center text-base font-bold tracking-wide">
        BULLETIN DE NOTES
      </h2>

      {/* Identite */}
      <div className="mb-2 grid grid-cols-2 gap-x-6 text-[11px]">
        <p><span className="text-slate-600">Prénoms :</span> <strong>{eleve.prenom}</strong></p>
        <p><span className="text-slate-600">Nom :</span> <strong>{eleve.nom}</strong></p>
        <p>
          <span className="text-slate-600">Né(e) le :</span> {dateFr(eleve.date_naissance)}
          {eleve.lieu_naissance && <> à {eleve.lieu_naissance}</>}
        </p>
        <p><span className="text-slate-600">Classe :</span> <strong>{eleve.classe}</strong></p>
        <p><span className="text-slate-600">Matricule :</span> {eleve.matricule}</p>
        <p>
          <span className="text-slate-600">Nbre d'élèves :</span> {eleve.effectif_classe}
          <span className="ml-3 text-slate-600">Classe Redoublée :</span> {eleve.redoublants_classe}
        </p>
      </div>

      {/* Tableau des disciplines */}
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            {['DISCIPLINES', 'Devoir', 'Comp', 'Moy /20', 'Coef', 'Moy x C', 'Rang', 'Appréciations']
              .map((t, i) => (
                <th
                  key={t}
                  className={`border border-black px-1 py-1 font-semibold ${
                    i === 0 ? 'text-left' : i === 7 ? 'text-left' : 'text-center'
                  }`}
                >
                  {t}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {matieres.map((m) => (
            <tr key={m.id}>
              <td className="border border-black px-1 py-0.5 uppercase">{m.matiere}</td>
              <td className="border border-black px-1 py-0.5 text-center tabular-nums">{nb(m.moyenne_devoir)}</td>
              <td className="border border-black px-1 py-0.5 text-center tabular-nums">{nb(m.moyenne_composition)}</td>
              <td className="border border-black px-1 py-0.5 text-center font-medium tabular-nums">{nb(m.moyenne)}</td>
              <td className="border border-black px-1 py-0.5 text-center tabular-nums">{nb(m.coefficient)}</td>
              <td className="border border-black px-1 py-0.5 text-center tabular-nums">{nb(m.points)}</td>
              <td className="border border-black px-1 py-0.5 text-center tabular-nums">{m.rang ?? ''}</td>
              <td className="border border-black px-1 py-0.5">{m.appreciation}</td>
            </tr>
          ))}

          <tr className="font-bold">
            <td className="border border-black px-1 py-1">TOTAL</td>
            <td className="border border-black" colSpan={3} />
            <td className="border border-black px-1 py-1 text-center tabular-nums">
              {synthese.total_coefficients}
            </td>
            <td className="border border-black px-1 py-1 text-center tabular-nums">
              {matieres.reduce((s, m) => s + Number(m.points || 0), 0).toFixed(2)}
            </td>
            <td className="border border-black" colSpan={2} />
          </tr>

          <tr className="font-semibold">
            <td className="border border-black px-1 py-1">
              Moyenne <span className="ml-1 text-sm font-bold">{synthese.moyenne}</span> /20
            </td>
            <td className="border border-black px-1 py-1 text-center" colSpan={2}>Rang</td>
            <td className="border border-black px-1 py-1 text-center tabular-nums">{synthese.rang}</td>
            <td className="border border-black px-1 py-1 text-center">Retards</td>
            <td className="border border-black px-1 py-1 text-center tabular-nums">{synthese.retards ?? 0}</td>
            <td className="border border-black px-1 py-1 text-center">Absences</td>
            <td className="border border-black px-1 py-1 text-center tabular-nums">{synthese.absences ?? 0}</td>
          </tr>
        </tbody>
      </table>

      {/* Grilles de decision du conseil */}
      <div className="mt-4 grid grid-cols-2 gap-6 text-[11px]">
        <table className="w-full border-collapse">
          <tbody>
            {APPRECIATIONS.map(([cle, libelle]) => (
              <tr key={cle}>
                <td className="border border-black px-1 py-0.5">{libelle}</td>
                <td className="w-10 border border-black px-1 py-0.5 text-center font-bold">
                  {conseil?.appreciation === cle ? 'X' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="w-full border-collapse">
          <tbody>
            {DISTINCTIONS.map(([cle, libelle]) => (
              <tr key={cle}>
                <td className="border border-black px-1 py-0.5">{libelle}</td>
                <td className="w-10 border border-black px-1 py-0.5 text-center font-bold">
                  {conseil?.distinction === cle ? 'X' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Observations et signature */}
      <div className="mt-4 grid grid-cols-2 gap-6 text-[11px]">
        <div>
          <p className="mb-1 font-semibold">Observations du conseil des professeurs</p>
          <div className="min-h-[60px] border border-black p-1.5">
            {conseil?.observations || ''}
          </div>
        </div>
        <div className="text-center">
          <p className="font-semibold">Le chef d'établissement</p>
          <div className="mt-10 border-t border-black pt-1 text-[10px] text-slate-600">
            Signature et cachet
          </div>
        </div>
      </div>

      {!conseil?.arrete && (
        <p className="mt-3 text-[10px] italic text-slate-500 print:hidden">
          Décisions proposées d'après la moyenne — à valider en conseil de classe.
        </p>
      )}
    </div>
  );
}
