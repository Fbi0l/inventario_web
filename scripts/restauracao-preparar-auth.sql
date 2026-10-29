-- Preparacao do banco DESCARTAVEL antes de restaurar o schema public.
-- Usado somente por scripts/testar-restauracao-local.sh e pelo teste do CI.
-- NUNCA executar no Supabase oficial.
--
-- O backup do schema public referencia objetos do Supabase que nao fazem parte dele:
-- auth.users (chaves estrangeiras), auth.uid()/auth.role() (politicas e funcoes)
-- e os papeis anon/authenticated/service_role (politicas RLS).
-- Aqui sao criados apenas substitutos minimos para que a estrutura e os dados
-- possam ser restaurados e conferidos de forma isolada.

DO $papeis$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$papeis$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  banned_until timestamptz,
  deleted_at timestamptz
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

-- O schema storage e referenciado apenas por politicas fora do public; criado vazio
-- para o caso de alguma funcao ou politica futura mencionar storage.objects.
CREATE SCHEMA IF NOT EXISTS storage;
