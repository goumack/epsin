import { useEffect, useState, useCallback } from 'react';
import { Plus, Send, Pin, Mail, MailOpen } from 'lucide-react';
import { get, post, patch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Chargement, Vide, Modale, Puce, Onglets, useToast,
} from '../components/ui';

export default function Communication() {
  const [onglet, setOnglet] = useState('annonces');
  return (
    <div className="animer space-y-4">
      <Onglets
        onglets={[
          { cle: 'annonces', libelle: 'Annonces' },
          { cle: 'messages', libelle: 'Messagerie' },
        ]}
        actif={onglet}
        onChange={setOnglet}
      />
      {onglet === 'annonces' && <Annonces />}
      {onglet === 'messages' && <Messages />}
    </div>
  );
}

function Annonces() {
  const { aRole } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ titre: '', contenu: '', cible: 'tous', epingle: false });

  const charger = useCallback(() => {
    get('/communication/annonces').then(setListe).catch(() => setListe([]));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/communication/annonces', f);
      setOuvert(false);
      setF({ titre: '', contenu: '', cible: 'tous', epingle: false });
      succes('Annonce publiée');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  return (
    <div className="space-y-4">
      <Toast />
      {aRole('admin', 'censeur', 'enseignant') && (
        <div className="flex justify-end">
          <button onClick={() => setOuvert(true)} className="bouton-primaire">
            <Plus className="h-4 w-4" /> Nouvelle annonce
          </button>
        </div>
      )}

      {!liste ? <Chargement /> : liste.length === 0 ? (
        <div className="carte"><Vide titre="Aucune annonce" /></div>
      ) : (
        <div className="space-y-3">
          {liste.map((a) => (
            <article key={a.id} className={`carte p-5 ${a.epingle ? 'border-marine-300 dark:border-marine-800' : ''}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {a.epingle && <Pin className="h-4 w-4 text-marine-600" />}
                <h3 className="font-semibold">{a.titre}</h3>
                <Puce ton="info">{a.cible}</Puce>
                <span className="ml-auto text-xs text-slate-400">
                  {new Date(a.publie_le).toLocaleDateString('fr-FR', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{a.contenu}</p>
              {a.prenom && (
                <p className="mt-3 text-xs text-slate-400">Publié par {a.prenom} {a.nom}</p>
              )}
            </article>
          ))}
        </div>
      )}

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouvelle annonce" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Titre *</label>
            <input className="champ" value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} required />
          </div>
          <div>
            <label className="etiquette">Contenu *</label>
            <textarea className="champ" rows="5" value={f.contenu} onChange={(e) => setF({ ...f, contenu: e.target.value })} required />
          </div>
          <div>
            <label className="etiquette">Destinataires</label>
            <select className="champ" value={f.cible} onChange={(e) => setF({ ...f, cible: e.target.value })}>
              <option value="tous">Tout le monde</option>
              <option value="enseignants">Enseignants</option>
              <option value="eleves">Élèves</option>
              <option value="parents">Parents</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.epingle} onChange={(e) => setF({ ...f, epingle: e.target.checked })} />
            Épingler en haut de la liste
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Publier</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}

function Messages() {
  const { utilisateur } = useAuth();
  const { Toast, succes, erreur: toastErreur } = useToast();
  const [liste, setListe] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ destinataire_id: '', objet: '', contenu: '' });

  const charger = useCallback(() => {
    get('/communication/messages').then(setListe).catch(() => setListe([]));
  }, []);

  useEffect(() => {
    charger();
    get('/communication/contacts').then(setContacts).catch(() => {});
  }, [charger]);

  const soumettre = async (e) => {
    e.preventDefault();
    try {
      await post('/communication/messages', { ...f, destinataire_id: Number(f.destinataire_id) });
      setOuvert(false);
      setF({ destinataire_id: '', objet: '', contenu: '' });
      succes('Message envoyé');
      charger();
    } catch (err) { toastErreur(err.message); }
  };

  const marquerLu = async (m) => {
    if (m.lu || m.destinataire_id !== utilisateur.id) return;
    try { await patch(`/communication/messages/${m.id}/lu`); charger(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <Toast />
      <div className="flex justify-end">
        <button onClick={() => setOuvert(true)} className="bouton-primaire">
          <Send className="h-4 w-4" /> Nouveau message
        </button>
      </div>

      {!liste ? <Chargement /> : liste.length === 0 ? (
        <div className="carte"><Vide titre="Aucun message" /></div>
      ) : (
        <div className="carte divide-y divide-slate-100 dark:divide-slate-800">
          {liste.map((m) => {
            const recu = m.destinataire_id === utilisateur.id;
            return (
              <button
                key={m.id}
                onClick={() => marquerLu(m)}
                className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  recu && !m.lu ? 'bg-marine-50/50 dark:bg-marine-950/20' : ''
                }`}
              >
                <div className="mt-0.5 shrink-0 text-slate-400">
                  {recu && !m.lu ? <Mail className="h-4 w-4 text-marine-600" /> : <MailOpen className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm ${recu && !m.lu ? 'font-semibold' : 'font-medium'}`}>
                      {recu ? `${m.exp_prenom} ${m.exp_nom}` : `À ${m.dest_prenom} ${m.dest_nom}`}
                    </span>
                    <Puce>{recu ? 'Reçu' : 'Envoyé'}</Puce>
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(m.envoye_le).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  {m.objet && <p className="mt-0.5 truncate text-sm font-medium">{m.objet}</p>}
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{m.contenu}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modale ouverte={ouvert} onFermer={() => setOuvert(false)} titre="Nouveau message" taille="sm">
        <form onSubmit={soumettre} className="space-y-3">
          <div>
            <label className="etiquette">Destinataire *</label>
            <select className="champ" value={f.destinataire_id} onChange={(e) => setF({ ...f, destinataire_id: e.target.value })} required>
              <option value="">Choisir…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.prenom} {c.nom} ({c.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="etiquette">Objet</label>
            <input className="champ" value={f.objet} onChange={(e) => setF({ ...f, objet: e.target.value })} />
          </div>
          <div>
            <label className="etiquette">Message *</label>
            <textarea className="champ" rows="5" value={f.contenu} onChange={(e) => setF({ ...f, contenu: e.target.value })} required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOuvert(false)} className="bouton-secondaire">Annuler</button>
            <button type="submit" className="bouton-primaire">Envoyer</button>
          </div>
        </form>
      </Modale>
    </div>
  );
}
