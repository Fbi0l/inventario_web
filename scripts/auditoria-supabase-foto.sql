-- "Foto" da configuracao de seguranca do Supabase, SOMENTE LEITURA.
-- Le apenas catalogos do PostgreSQL (nenhuma linha de dados das tabelas).
-- Usado por scripts/auditoria-supabase.sh; o resultado e comparado com
-- docs/auditoria-supabase-esperado.txt. Cada linha: tipo | objeto | detalhe.
WITH
tabelas AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner,
         coalesce(c.relacl, acldefault('r', c.relowner)) AS acl
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
),
funcoes AS (
  SELECT p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS nome,
         p.prosecdef, p.proconfig, coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
),
linhas(tipo, objeto, detalhe) AS (
  -- ::text evita que a coluna herde o tipo name (63 caracteres) e corte nomes longos.
  SELECT 'tabela'::text, relname::text, 'rls=' || relrowsecurity || ' force=' || relforcerowsecurity
  FROM tabelas
  UNION ALL
  SELECT 'permissao-tabela', t.relname || ' ' || r.rolname,
         string_agg(a.privilege_type, ',' ORDER BY a.privilege_type COLLATE "C")
  FROM tabelas t, aclexplode(t.acl) a JOIN pg_roles r ON r.oid = a.grantee
  WHERE r.rolname IN ('anon', 'authenticated')
  GROUP BY t.relname, r.rolname
  UNION ALL
  SELECT 'politica', pol.schemaname || '.' || pol.tablename || ' :: ' || pol.policyname,
         pol.permissive || ' ' || pol.cmd || ' ' || pol.roles::text
         || ' using=' || coalesce(regexp_replace(pol.qual, '\s+', ' ', 'g'), '-')
         || ' check=' || coalesce(regexp_replace(pol.with_check, '\s+', ' ', 'g'), '-')
  FROM pg_policies pol
  WHERE pol.schemaname IN ('public', 'storage')
  UNION ALL
  SELECT 'funcao', f.nome,
         'definer=' || f.prosecdef
         || ' config=' || coalesce(array_to_string(f.proconfig, ';'), '-')
         || ' executa=' || coalesce((
              SELECT string_agg(x.nome, ',' ORDER BY x.nome COLLATE "C") FROM (
                SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname::text END AS nome
              FROM aclexplode(f.acl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
              WHERE a.privilege_type = 'EXECUTE'
                AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))) x), '-')
  FROM funcoes f
  UNION ALL
  SELECT 'chave-auth', (SELECT relname FROM pg_class WHERE oid = c.conrelid) || '.' || att.attname,
         'on_delete=' || CASE c.confdeltype WHEN 'a' THEN 'no_action' WHEN 'r' THEN 'restrict'
           WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set_null' WHEN 'd' THEN 'set_default' END
  FROM pg_constraint c
  JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.confrelid = (SELECT c2.oid FROM pg_class c2 WHERE c2.relname = 'users' AND c2.relnamespace = 'auth'::regnamespace)
    AND c.connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'gatilho', (SELECT relname FROM pg_class WHERE oid = tg.tgrelid) || ' :: ' || tg.tgname,
         'ativo=' || (tg.tgenabled <> 'D') || ' funcao=' || (SELECT proname FROM pg_proc WHERE oid = tg.tgfoid)
  FROM pg_trigger tg
  WHERE NOT tg.tgisinternal
    AND tg.tgrelid IN (SELECT oid FROM tabelas)
  UNION ALL
  SELECT 'bucket', b.id, 'public=' || b.public
  FROM auditoria_seguranca.buckets() b
)
SELECT tipo || ' | ' || objeto || ' | ' || detalhe
FROM linhas
ORDER BY tipo, objeto, detalhe;
