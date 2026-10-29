-- Atualizacao 1.5.2: auditoria automatica SOMENTE LEITURA da configuracao de seguranca.
-- Executar uma vez no SQL Editor do Supabase, apos backup.
-- Nao altera nem le dados de equipamentos, movimentacoes, termos ou usuarios.
--
-- 1) Cria o usuario de banco auditoria_leitura, que so consegue ler catalogos do
--    PostgreSQL (estrutura, politicas, permissoes). Ele NAO tem acesso a nenhuma
--    tabela de dados; o final deste script confere isso e desfaz tudo se nao for verdade.
--    A senha NAO fica neste arquivo: defina-a depois, no SQL Editor (passo 3 do README).
-- 2) Cria auditoria_seguranca.buckets(), unica janela extra: informa apenas o nome
--    e se cada bucket do Storage e publico (nenhum arquivo e lido).
-- 3) Remove de anon/authenticated as permissoes TRUNCATE, TRIGGER, REFERENCES e
--    MAINTAIN em equipamentos e movimentacoes. O sistema nao usa nenhuma delas e
--    TRUNCATE ignora o RLS. SELECT/INSERT/UPDATE/DELETE continuam controlados pelo RLS.
BEGIN;

DO $papel$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditoria_leitura') THEN
    CREATE ROLE auditoria_leitura LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
  END IF;
END
$papel$;
ALTER ROLE auditoria_leitura SET default_transaction_read_only = on;
ALTER ROLE auditoria_leitura SET statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS auditoria_seguranca;
REVOKE ALL ON SCHEMA auditoria_seguranca FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA auditoria_seguranca TO auditoria_leitura;

CREATE OR REPLACE FUNCTION auditoria_seguranca.buckets()
RETURNS TABLE(id text, public boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT b.id::text, coalesce(b.public, false) FROM storage.buckets b
$fn$;
REVOKE ALL ON FUNCTION auditoria_seguranca.buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_seguranca.buckets() TO auditoria_leitura;

REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
  ON public.equipamentos, public.movimentacoes FROM anon, authenticated;

-- Conferencia obrigatoria: o usuario de auditoria nao pode ler nenhum dado.
DO $confere$
DECLARE v_tabela text;
BEGIN
  SELECT c.relnamespace::regnamespace::text || '.' || c.relname INTO v_tabela
  FROM pg_class c
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND c.relnamespace IN ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace)
    AND has_table_privilege('auditoria_leitura', c.oid, 'SELECT')
  LIMIT 1;
  IF v_tabela IS NOT NULL THEN
    RAISE EXCEPTION 'auditoria_leitura conseguiria ler %. Nada foi alterado.', v_tabela;
  END IF;
END
$confere$;

COMMIT;

-- Conferencia (somente leitura): deve listar o usuario sem acesso a dados e as
-- permissoes restantes de anon/authenticated em equipamentos e movimentacoes.
SELECT r.rolname, r.rolcanlogin, r.rolconfig
FROM pg_roles r WHERE r.rolname = 'auditoria_leitura';
SELECT c.relname, a.grantee::regrole AS papel, string_agg(a.privilege_type, ',' ORDER BY 1) AS permissoes
FROM pg_class c, aclexplode(c.relacl) a
WHERE c.oid IN ('public.equipamentos'::regclass, 'public.movimentacoes'::regclass)
  AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)
GROUP BY 1, 2 ORDER BY 1, 2;
