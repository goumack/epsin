import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Check, X, Clock, CalendarDays, MessageSquareText,
} from 'lucide-react';
import { get, post, patch, dateFr } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Chargement, Vide, Modale, Puce, useToast,
} from '../components/ui';

/** Libelles lisibles des types de demande. */
const TYPES = {
  absence: 'Absence',
  conge_annuel: 'Congé annuel',
  maladie: 'Maladie',
  maternite: 'Maternité',
  formation: 'Formation',
  autre: 'Autre',
};

const TONS_STATUT = {
  soumise: 'alerte',
  approuvee: 'succes',
  refusee: 'danger',
  annulee: 'neutre',
};

const LIBELLES_STATUT = {
  soumise: 'En attente',
  approuvee: 'Approuvée',
  refusee: 'Refusée',
  annulee: 'Annulée',
};

export default function Personnel() {
  const { aRole } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();

  const [demandes, setDemandes] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [decision, setDecision] = useState(null);   // demande en cours d arbitrage

  const estEnseignant = aRole('enseignant');

  const charger = useCallback(() => {
    get('/personnel/demandes-absence')
      .then(setDemandes)
      .catch(() => setDemandes([]));
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const enAttente = (demandes || []).filter((d) => d.statut === 'soumise');

  return (
    <div className="animer space-y-4">
      <Toast />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {estEnseignant ? 'Mes demandes d’absence' : 'Demandes du personnel'}
          </h2>
          <p className="text-sm text-slate-500">
            {estEnseignant
              ? 'Vos demandes sont adressées au chef de votre entité.'
              : `${enAttente.length} demande${enAttente.length > 1 ? 's' : ''} en attente de votre décision.`}
          </p>
        </div>
        {estEnseignant && (
          <button onClick={() => setOuvert(true)} className="bouton-primaire">
            <Plus className="h-4 w-4" /> Nouvelle demande
          </button>
        )}
      </div>

      {!demandes ? <Chargement /> : demandes.length === 0 ? (
        <div className="carte">
          <Vide
            titre="Aucune demande"
            texte={estEnseignant
              ? 'Déposez une demande pour la soumettre à votre chef.'
              : 'Aucune demande d’absence n’a été déposée dans votre entité.'}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {demandes.map((d) => (
            <CarteDemande
              key={d.id}
              demande={d}
              estEnseignant={estEnseignant}
              onDecider={() => setDecision(d)}
              onAnnuler={async () => {
                try {
                  await patch(`/personnel/demandes-absence/${d.id}/annuler`, {});
                  succes('Demande retirée');
                  charger();
                } catch (e) { toastErreur(e.message); }
              }}
            />
          ))}
        </div>
      )}

      <FormulaireDemande
        ouvert={ouvert}
        onFermer={() => setOuvert(false)}
        onCree={() => { setOuvert(false); succes('Demande transmise à votre chef'); charger(); }}
        onErreur={toastErreur}
      />

      <ModaleDecision
        demande={decision}
        onFermer={() => setDecision(null)}
        onStatue={(msg) => { setDecision(null); succes(msg); charger(); }}
        onErreur={toastErreur}
      />
    </div>
  );
}

/** Une demande, avec ses actions selon qui regarde. */
function CarteDemande({ demande: d, estEnseignant, onDecider, onAnnuler }) {
  return (
    <div className="carte space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{TYPES[d.type] || d.type}</span>
            <Puce ton={TONS_STATUT[d.statut]}>{LIBELLES_STATUT[d.statut]}</Puce>
            {!estEnseignant && (
              <span className="text-sm text-slate-500">
                {d.prenom} {d.nom}
                {d.specialite && ` · ${d.specialite}`}
              </span>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            du {dateFr(d.date_debut)} au {dateFr(d.date_fin)}
            <span className="text-slate-400">· {d.nb_jours} jour{d.nb_jours > 1 ? 's' : ''}</span>
          </p>
        </div>

        {/* Actions : le chef tranche, le demandeur peut retirer */}
        {d.statut === 'soumise' && (
          <div className="flex gap-2">
            {estEnseignant ? (
              <button onClick={onAnnuler} className="bouton-secondaire text-sm">
                Retirer
              </button>
            ) : (
              <button onClick={onDecider} className="bouton-primaire text-sm">
                Statuer
              </button>
            )}
          </div>
        )}
      </div>

      <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5 text-sm">
        {d.motif}
      </p>

      {/* Reponse du chef, une fois la decision prise */}
      {d.statut !== 'soumise' && d.decideur_nom && (
        <div className="flex items-start gap-2 border-t border-slate-100 dark:border-slate-800 pt-2.5 text-sm">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="text-slate-500">
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {d.decideur_prenom} {d.decideur_nom}
            </span>
            {' · '}{dateFr(d.date_decision)}
            {d.commentaire && <span className="block">{d.commentaire}</span>}
          </p>
        </div>
      )}

      {d.statut === 'soumise' && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="h-3 w-3" /> Déposée le {dateFr(d.cree_le)}
        </p>
      )}
    </div>
  );
}

/** Depot d une demande par l enseignant. */
function FormulaireDemande({ ouvert, onFermer, onCree, onErreur }) {
  const vide = { type: 'absence', date_debut: '', date_fin: '', motif: '' };
  const [f, setF] = useState(vide);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { if (ouvert) setF(vide); }, [ouvert]);

  const maj = (champ) => (e) => setF((v) => ({ ...v, [champ]: e.target.value }));

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    try {
      await post('/personnel/demandes-absence', f);
      onCree();
    } catch (err) {
      onErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale ouverte={ouvert} onFermer={onFermer} titre="Demander une absence" taille="sm">
      <form onSubmit={soumettre} className="space-y-3">
        <div>
          <label className="etiquette">Motif de l'absence *</label>
          <select className="champ" value={f.type} onChange={maj('type')}>
            {Object.entries(TYPES).map(([cle, lib]) => (
              <option key={cle} value={cle}>{lib}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="etiquette">Du *</label>
            <input type="date" className="champ" value={f.date_debut}
                   onChange={maj('date_debut')} required />
          </div>
          <div>
            <label className="etiquette">Au *</label>
            <input type="date" className="champ" value={f.date_fin}
                   onChange={maj('date_fin')} min={f.date_debut} required />
          </div>
        </div>
        <div>
          <label className="etiquette">Précisions *</label>
          <textarea className="champ" rows={3} value={f.motif} onChange={maj('motif')}
                    placeholder="Expliquez brièvement la raison de votre demande" required />
        </div>
        <p className="text-xs text-slate-500">
          Votre demande sera transmise au chef de votre entité (directeur ou proviseur).
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
          <button type="button" onClick={onFermer} className="bouton-secondaire">Annuler</button>
          <button type="submit" className="bouton-primaire" disabled={envoi}>
            {envoi ? 'Envoi…' : 'Transmettre'}
          </button>
        </div>
      </form>
    </Modale>
  );
}

/** Arbitrage du chef : approuver ou refuser, avec un mot au demandeur. */
function ModaleDecision({ demande, onFermer, onStatue, onErreur }) {
  const [commentaire, setCommentaire] = useState('');
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => { setCommentaire(''); }, [demande]);

  const statuer = async (statut) => {
    setEnvoi(true);
    try {
      await patch(`/personnel/demandes-absence/${demande.id}`, { statut, commentaire });
      onStatue(statut === 'approuvee' ? 'Demande approuvée' : 'Demande refusée');
    } catch (e) {
      onErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modale
      ouverte={Boolean(demande)}
      onFermer={onFermer}
      titre="Statuer sur la demande"
      taille="sm"
    >
      {demande && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <p className="font-medium">{demande.prenom} {demande.nom}</p>
            <p className="text-sm text-slate-500">
              {TYPES[demande.type] || demande.type} · {demande.nb_jours} jour
              {demande.nb_jours > 1 ? 's' : ''}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              du {dateFr(demande.date_debut)} au {dateFr(demande.date_fin)}
            </p>
            <p className="mt-2 text-sm">{demande.motif}</p>
          </div>

          <div>
            <label className="etiquette">Mot au demandeur (facultatif)</label>
            <textarea
              className="champ" rows={2} value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder="Conditions, remplacement prévu, motif du refus…"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            <button onClick={() => statuer('refusee')} disabled={envoi}
                    className="bouton-secondaire text-red-600 dark:text-red-400">
              <X className="h-4 w-4" /> Refuser
            </button>
            <button onClick={() => statuer('approuvee')} disabled={envoi}
                    className="bouton-primaire">
              <Check className="h-4 w-4" /> Approuver
            </button>
          </div>
        </div>
      )}
    </Modale>
  );
}
