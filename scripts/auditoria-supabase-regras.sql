-- Regras de seguranca que nunca podem ser violadas, SOMENTE LEITURA.
-- Cada linha retornada e uma violacao; nenhuma linha = tudo certo.
-- Usado por scripts/auditoria-supabase.sh.
WITH
tabelas AS (
  SELECT c.oid, c.relname::text AS relname, c.relrowsecurity,
         coalesce(c.relacl, acldefault('r', c.relowner)) AS acl
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
definer AS (
  SELECT p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS nome,
         p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
),
violacoes(regra, objeto) AS (
  SELECT 'Tabela sem RLS', relname FROM tabelas WHERE NOT relrowsecurity
  UNION ALL
  SELECT 'Bucket do Storage publico', b.id FROM auditoria_seguranca.buckets() b WHERE b.public
  UNION ALL
  SELECT 'Funcao SECURITY DEFINER sem search_path fixo', d.nome FROM definer d
  WHERE NOT coalesce(EXISTS (SELECT 1 FROM unnest(d.proconfig) cfg WHERE cfg LIKE 'search_path=%'), false)
  UNION ALL
  SELECT 'Funcao SECURITY DEFINER executavel sem login (anon/PUBLIC)', d.nome
  FROM definer d, aclexplode(d.acl) a
  WHERE a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'))
  UNION ALL
  SELECT 'Permissao que ignora o RLS (' || a.privilege_type || ') para ' || r.rolname, t.relname
  FROM tabelas t, aclexplode(t.acl) a JOIN pg_roles r ON r.oid = a.grantee
  WHERE r.rolname IN ('anon', 'authenticated')
    AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  UNION ALL
  SELECT 'Chave para auth.users que impede excluir contas',
         c.conrelid::regclass::text || ' (' || c.conname || ')'
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.confrelid = (SELECT c2.oid FROM pg_class c2 WHERE c2.relname = 'users' AND c2.relnamespace = 'auth'::regnamespace)
    AND c.connamespace = 'public'::regnamespace AND c.confdeltype IN ('a', 'r')
  UNION ALL
  -- O proprio usuario da auditoria nao pode enxergar dados.
  SELECT 'Usuario da auditoria consegue ler dados', c.relnamespace::regnamespace::text || '.' || c.relname
  FROM pg_class c
  WHERE c.relkind IN ('r', 'p', 'v', 'm')
    AND c.relnamespace IN ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace)
    AND has_table_privilege(current_user, c.oid, 'SELECT')
    AND current_user = 'auditoria_leitura'
)
SELECT regra || ': ' || objeto FROM violacoes ORDER BY 1;
