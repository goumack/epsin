-- ============================================================
-- EPSIN — Synchronisation entre le poste de l ecole et le serveur en ligne
--
-- Le poste de l ecole (programme Windows) fait foi et fonctionne sans
-- internet. Le serveur en ligne est une copie, sur laquelle seuls les
-- parents agissent (declaration Wave, absence signalee, messages, mot de
-- passe). Quand la connexion revient :
--   - le poste ENVOIE ses modifications au serveur en ligne ;
--   - il RECOIT ce que les parents ont fait en ligne.
--
-- Chaque base note dans `sync_journal` les lignes modifiees (table, cle,
-- operation). Les ecritures faites PAR la synchronisation ne sont pas
-- notees (variable de session epsin.sync_en_cours) : sans cela, une
-- modification ferait l aller-retour a l infini.
--
-- Le journal n est tenu que par les connexions qui le demandent
-- (epsin.journal = on) : le poste et le serveur en ligne en mode copie.
-- Une base qui ne se synchronise pas ne le remplit pas inutilement.
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_journal (
  id         BIGSERIAL PRIMARY KEY,
  table_nom  TEXT NOT NULL,
  cle        JSONB NOT NULL,          -- {"id": 12} ou {"eleve_id": 3, "tuteur_id": 7}
  operation  CHAR(1) NOT NULL,        -- I (ajout), U (modification), D (suppression)
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Curseurs et reglages de la synchronisation (dernier envoi, derniere reception...)
CREATE TABLE IF NOT EXISTS sync_etat (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
);

-- Note une modification. Les colonnes de la cle primaire sont passees en
-- arguments du declencheur.
CREATE OR REPLACE FUNCTION sync_tracer() RETURNS trigger AS $$
DECLARE
  ligne JSONB;
  cle JSONB;
BEGIN
  IF current_setting('epsin.sync_en_cours', true) = 'on'
     OR COALESCE(current_setting('epsin.journal', true), '') <> 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN ligne := to_jsonb(OLD); ELSE ligne := to_jsonb(NEW); END IF;
  SELECT jsonb_object_agg(k, ligne -> k) INTO cle FROM unnest(TG_ARGV) AS k;
  INSERT INTO sync_journal (table_nom, cle, operation) VALUES (TG_TABLE_NAME, cle, left(TG_OP, 1));
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

-- Pose le declencheur sur toutes les tables de donnees. Rappelee apres
-- chaque migration : une table ajoutee plus tard est suivie aussi.
CREATE OR REPLACE FUNCTION sync_installer_declencheurs() RETURNS void AS $$
DECLARE
  t RECORD;
  colonnes TEXT;
BEGIN
  FOR t IN
    SELECT c.relname AS nom, c.oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN ('migration', 'sync_journal', 'sync_etat')
  LOOP
    SELECT string_agg(quote_literal(a.attname), ', ' ORDER BY array_position(i.indkey, a.attnum))
      INTO colonnes
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = t.oid AND i.indisprimary;
    IF colonnes IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS sync_tracer ON %I', t.nom);
    EXECUTE format(
      'CREATE TRIGGER sync_tracer AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_tracer(%s)',
      t.nom, colonnes);
  END LOOP;
END
$$ LANGUAGE plpgsql;

SELECT sync_installer_declencheurs();
