// Execute com PGlite instalado: node tests/auditoria-seguranca-db.cjs
// Valida ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql e as consultas da auditoria de seguranca
// (scripts/auditoria-supabase-*.sql) em banco ficticio, sem credenciais reais.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const sql=f=>fs.readFileSync(f,'utf8');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,banned_until timestamptz,deleted_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 INSERT INTO auth.users(id,email) VALUES ('80000000-0000-0000-0000-000000000001','usuario@inventariosys.com');`);
 for(const f of ['supabase_schema','ATUALIZACAO_PERFIS','ATUALIZACAO_ARQUIVAMENTO_CICLOS','ATUALIZACAO_EXCLUSAO_CICLOS',
  'ATUALIZACAO_TERMOS_PDF','ATUALIZACAO_PRIVACIDADE_TERMOS','ATUALIZACAO_CONVITES_CADASTRO','ATUALIZACAO_1_4_1_EXCLUSAO_USUARIOS',
  'ATUALIZACAO_1_4_2_SEGURANCA_RPCS','ATUALIZACAO_IMPORTACAO_PLANILHA','ATUALIZACAO_IMPORTACAO_EM_USO',
  'ATUALIZACAO_1_4_4_INTEGRIDADE','ATUALIZACAO_1_5_0_AUDITORIA'])
  await db.exec(sql(f+'.sql').replace('create extension if not exists pgcrypto;',''));
 // Como no Supabase: anon/authenticated recebem todas as permissoes nas tabelas criadas.
 await db.exec('GRANT ALL ON public.equipamentos,public.movimentacoes TO anon,authenticated;');
 await db.exec("INSERT INTO storage.buckets(id,name,public) VALUES('modelos-termos','modelos-termos',false) ON CONFLICT (id) DO UPDATE SET public=false");

 const regras=sql('scripts/auditoria-supabase-regras.sql'),foto=sql('scripts/auditoria-supabase-foto.sql');
 const violacoes=async()=>(await db.query(regras)).rows.map(r=>Object.values(r)[0]);
 const permissoes=async(t,r)=>(await db.query(`SELECT string_agg(privilege_type,',' ORDER BY privilege_type COLLATE "C") p FROM
   aclexplode((SELECT relacl FROM pg_class WHERE oid=$1::regclass)) a WHERE a.grantee=$2::regrole`,[t,r])).rows[0].p;

 // Antes da migracao a auditoria aponta as permissoes que ignoram o RLS.
 await db.exec(`CREATE SCHEMA auditoria_seguranca;
  CREATE FUNCTION auditoria_seguranca.buckets() RETURNS TABLE(id text, public boolean) LANGUAGE sql AS $$SELECT id,public FROM storage.buckets$$;`);
 const antes=await violacoes();
 assert.ok(antes.some(v=>v.includes('(TRUNCATE) para anon: equipamentos')),'detecta TRUNCATE para anon');
 assert.ok(antes.some(v=>v.includes('(TRUNCATE) para authenticated: movimentacoes')));
 await db.exec('DROP SCHEMA auditoria_seguranca CASCADE');

 // Migracao: cria o usuario e remove so as permissoes que ignoram o RLS.
 await db.exec(sql('ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql'));
 for(const t of ['public.equipamentos','public.movimentacoes'])for(const r of ['anon','authenticated'])
  assert.equal(await permissoes(t,r),'DELETE,INSERT,SELECT,UPDATE',`${t} ${r}`);
 assert.deepEqual(await violacoes(),[],'nenhuma violacao depois da migracao');
 // Reaplicar nao falha nem muda nada.
 await db.exec(sql('ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql'));
 assert.deepEqual(await violacoes(),[]);

 // O usuario da auditoria le a configuracao, mas nenhum dado.
 await db.exec('SET ROLE auditoria_leitura');
 const linhas=(await db.query(foto)).rows.map(r=>Object.values(r)[0]);
 assert.ok(linhas.includes('bucket | modelos-termos | public=false'));
 assert.ok(linhas.includes('permissao-tabela | equipamentos anon | DELETE,INSERT,SELECT,UPDATE'));
 assert.ok(linhas.some(l=>l.startsWith('funcao | registrar_retirada_termo(p_equipamento_id uuid, p_retirante_id uuid,')),'nomes longos nao sao cortados');
 assert.ok(linhas.some(l=>l.startsWith('politica | public.equipamentos :: ')));
 assert.deepEqual(await violacoes(),[],'regras rodam com o usuario da auditoria');
 for(const t of ['public.equipamentos','public.dados_retirantes','public.termos_equipamentos','public.auditoria','auth.users','storage.objects','storage.buckets'])
  await assert.rejects(()=>db.query(`SELECT 1 FROM ${t} LIMIT 1`),/permission denied/,`nao le ${t}`);
 await assert.rejects(()=>db.query("INSERT INTO auditoria_seguranca.x VALUES(1)"),/permission denied|does not exist/);
 await db.exec('RESET ROLE');

 // Cada regra detecta o problema correspondente.
 const detecta=async(quebra,conserta,trecho)=>{await db.exec(quebra);const v=await violacoes();await db.exec(conserta);
  assert.ok(v.some(x=>x.includes(trecho)),`esperado: ${trecho} | obtido: ${JSON.stringify(v)}`);};
 await detecta('ALTER TABLE public.convites_cadastro DISABLE ROW LEVEL SECURITY','ALTER TABLE public.convites_cadastro ENABLE ROW LEVEL SECURITY','Tabela sem RLS: convites_cadastro');
 await detecta("UPDATE storage.buckets SET public=true","UPDATE storage.buckets SET public=false",'Bucket do Storage publico: modelos-termos');
 await detecta('ALTER FUNCTION public.meu_perfil() RESET search_path','ALTER FUNCTION public.meu_perfil() SET search_path = \'\'','sem search_path fixo: meu_perfil()');
 await detecta('GRANT EXECUTE ON FUNCTION public.listar_retirantes() TO anon','REVOKE EXECUTE ON FUNCTION public.listar_retirantes() FROM anon','executavel sem login (anon/PUBLIC): listar_retirantes()');
 await detecta('GRANT TRUNCATE ON public.equipamentos TO authenticated','REVOKE TRUNCATE ON public.equipamentos FROM authenticated','(TRUNCATE) para authenticated: equipamentos');
 await detecta(`ALTER TABLE public.equipamentos DROP CONSTRAINT equipamentos_criado_por_fkey;
   ALTER TABLE public.equipamentos ADD CONSTRAINT equipamentos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id)`,
  `ALTER TABLE public.equipamentos DROP CONSTRAINT equipamentos_criado_por_fkey;
   ALTER TABLE public.equipamentos ADD CONSTRAINT equipamentos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL`,
  'impede excluir contas: equipamentos');
 await detecta('GRANT SELECT ON public.dados_retirantes TO auditoria_leitura; SET ROLE auditoria_leitura','RESET ROLE; REVOKE SELECT ON public.dados_retirantes FROM auditoria_leitura','Usuario da auditoria consegue ler dados: public.dados_retirantes');
 assert.deepEqual(await violacoes(),[],'tudo restaurado');

 // A migracao recusa e desfaz tudo se o usuario da auditoria puder ler dados.
 await db.exec('GRANT SELECT ON public.equipamentos TO auditoria_leitura');
 await assert.rejects(()=>db.exec(sql('ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql')),/auditoria_leitura conseguiria ler public.equipamentos/);
 await db.exec('ROLLBACK').catch(()=>{});

 await db.close();
 console.log('Auditoria de seguranca aprovada: usuario sem acesso a dados, permissoes que ignoram RLS removidas e 7 regras detectando violacoes.');
})().catch(e=>{console.error(e);process.exit(1)});
