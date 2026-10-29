// Execute com PGlite instalado: node tests/auditoria-db.cjs
// Valida ATUALIZACAO_1_5_0_AUDITORIA.sql em banco ficticio, sem credenciais reais.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,banned_until timestamptz,deleted_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE TABLE public.perfis_usuarios(usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,perfil text);
 CREATE FUNCTION public.meu_perfil() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT perfil FROM public.perfis_usuarios WHERE usuario_id=auth.uid()$$;
 REVOKE ALL ON FUNCTION public.meu_perfil() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.meu_perfil() TO authenticated;`);
 await db.exec(fs.readFileSync('supabase_schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON public.equipamentos,public.movimentacoes TO authenticated;');
 for(const f of ['ATUALIZACAO_ARQUIVAMENTO_CICLOS','ATUALIZACAO_EXCLUSAO_CICLOS','ATUALIZACAO_TERMOS_PDF','ATUALIZACAO_PRIVACIDADE_TERMOS',
  'ATUALIZACAO_IMPORTACAO_PLANILHA','ATUALIZACAO_IMPORTACAO_EM_USO','ATUALIZACAO_1_4_4_INTEGRIDADE','ATUALIZACAO_1_5_0_AUDITORIA','ATUALIZACAO_1_5_0_AUDITORIA'])
  await db.exec(fs.readFileSync(f+'.sql','utf8'));
 const [A,O,C]=['50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003'];
 for(const [id,perfil] of [[A,'administrador'],[O,'operador'],[C,'consulta']]){
  await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[id,`${perfil}@example.invalid`]);
  await db.query('INSERT INTO perfis_usuarios VALUES($1,$2)',[id,perfil]);
 }
 for(const id of [A,O])await db.query("INSERT INTO dados_retirantes(usuario_id,nome,cpf)VALUES($1,'Pessoa Teste','52998224725')",[id]);
 const as=async(id,role='authenticated')=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`SET ROLE ${role}`);};
 const rows=async()=>{await db.exec('RESET ROLE');return (await db.query('SELECT * FROM auditoria ORDER BY id')).rows;};
 const val=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];

 // Edicoes diretas do administrador: criar, alterar (antes/depois), excluir; update sem mudanca e ignorado.
 await as(A);
 const e1=await val("INSERT INTO equipamentos(descricao,tag)VALUES('Notebook','AUD-1') RETURNING id");
 const e2=await val("INSERT INTO equipamentos(descricao,tag)VALUES('Mouse','AUD-2') RETURNING id");
 await db.query("UPDATE equipamentos SET descricao='Notebook 14',localizacao='Sala 2' WHERE id=$1",[e1]);
 await db.query("UPDATE equipamentos SET descricao='Notebook 14' WHERE id=$1",[e1]);
 await db.query('DELETE FROM equipamentos WHERE id=$1',[e2]);
 let r=await rows();
 assert.deepEqual(r.map(x=>x.acao),['criou','criou','alterou','excluiu']);
 assert.equal(r[2].detalhes.alteracoes.descricao.antes,'Notebook');assert.equal(r[2].detalhes.alteracoes.localizacao.depois,'Sala 2');
 assert.ok(!('updated_at' in r[2].detalhes.alteracoes));
 assert.ok(r.every(x=>x.autor_id===A&&x.autor_email==='administrador@example.invalid'));

 // Retirada e devolucao pelo fluxo normal nao duplicam registros.
 await as(O);
 const m=await val("SELECT registrar_retirada_termo($1,$2,'Sala',now()-interval '1 hour',null,'Bom',null,'Almox',false)",[e1,O]);
 await db.query("SELECT registrar_devolucao_termo($1,now(),'Bom',null,'Sem alterações aparentes')",[m]);
 assert.equal((await rows()).length,4);

 // Ciclos e importacao, com autor identificado.
 await as(A);
 const c1=await val("SELECT arquivar_inventario('Ciclo A')");await db.query('SELECT restaurar_inventario($1)',[c1]);
 const c2=await val("SELECT arquivar_inventario('Ciclo B')");await db.query('SELECT excluir_ciclo_arquivado($1)',[c2]);
 await db.query(`SELECT importar_equipamentos(gen_random_uuid(),'[{"linha":2,"tag":"IMP-9","descricao":"Projetor"},{"linha":3,"tag":"IMP-9","descricao":"Duplicado"}]'::jsonb)`);
 r=await rows();
 assert.deepEqual(r.filter(x=>x.entidade==='ciclo').map(x=>x.acao),['arquivou','restaurou','arquivou','excluiu']);
 assert.equal(r.filter(x=>['equipamento','movimentacao'].includes(x.entidade)).length,4,'exclusao de periodo nao gera um registro por item');
 assert.equal(r.find(x=>x.acao==='importou').descricao,'1 importado(s), 1 ignorado(s)');
 assert.ok(r.filter(x=>['ciclo','planilha'].includes(x.entidade)).every(x=>x.autor_id===A));

 // Seguranca: ninguem forja, altera ou apaga; so administrador le.
 await as(A);
 assert.equal(await val('SELECT count(*)::int FROM auditoria'),9);
 await assert.rejects(()=>db.query("SELECT registrar_auditoria('falso','x',null,'forjado','{}')"),/Uso interno/);
 await assert.rejects(()=>db.query("INSERT INTO auditoria(acao,entidade)VALUES('falso','x')"),/permission denied/);
 await assert.rejects(()=>db.query("UPDATE auditoria SET descricao='x'"),/permission denied/);
 await assert.rejects(()=>db.query('DELETE FROM auditoria'),/permission denied/);
 for(const id of [O,C]){await as(id);assert.equal(await val('SELECT count(*)::int FROM auditoria'),0);}
 await as('', 'anon');await assert.rejects(()=>db.query('SELECT * FROM auditoria'),/permission denied/);
 await as('', 'service_role');
 await db.query("INSERT INTO auditoria(autor_id,autor_email,acao,entidade,entidade_id,descricao)VALUES($1,'administrador@example.invalid','alterou_perfil','usuario',$2,'operador@example.invalid')",[A,O]);
 await assert.rejects(()=>db.query('DELETE FROM auditoria'),/auditoria/);
 await db.exec('RESET ROLE');
 await assert.rejects(()=>db.query("UPDATE auditoria SET descricao='x'"),/nao pode ser alterada/);
 await assert.rejects(()=>db.query('TRUNCATE auditoria'),/nao pode ser alterada/);

 // Excluir uma conta preserva os registros dela.
 await db.query('DELETE FROM auth.users WHERE id=$1',[O]);
 assert.equal((await rows()).length,10);
 await db.close();console.log('Auditoria aprovada: edicoes diretas, ciclos, importacao, sem duplicar retiradas, somente-inclusao e leitura so do administrador.');
})().catch(e=>{console.error(e);process.exit(1)});
