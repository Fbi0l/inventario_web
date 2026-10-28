// Execute com PGlite instalado: node tests/integridade-db.cjs
// Valida ATUALIZACAO_1_4_4_INTEGRIDADE.sql em banco ficticio, sem credenciais reais.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,banned_until timestamptz,deleted_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
 CREATE TABLE public.perfis_usuarios(usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,perfil text);
 CREATE FUNCTION public.meu_perfil() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT perfil FROM public.perfis_usuarios WHERE usuario_id=auth.uid()$$;`);
 await db.exec('REVOKE ALL ON FUNCTION public.meu_perfil() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.meu_perfil() TO authenticated;');
 await db.exec(fs.readFileSync('supabase_schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON public.equipamentos,public.movimentacoes TO authenticated;');
 await db.exec(fs.readFileSync('ATUALIZACAO_ARQUIVAMENTO_CICLOS.sql','utf8'));
 await db.exec(fs.readFileSync('ATUALIZACAO_TERMOS_PDF.sql','utf8'));
 await db.exec(fs.readFileSync('ATUALIZACAO_1_4_4_INTEGRIDADE.sql','utf8'));
 const [admin,operador]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'];
 for(const [id,perfil,nome] of [[admin,'administrador','Administrador Teste'],[operador,'operador','Operador Teste']]){
  await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[id,`${perfil}@example.invalid`]);
  await db.query('INSERT INTO perfis_usuarios VALUES($1,$2)',[id,perfil]);
  await db.query("INSERT INTO dados_retirantes(usuario_id,nome,cpf)VALUES($1,$2,'52998224725')",[id,nome]);
 }
 const asUser=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
 const out="SELECT registrar_retirada_termo($1,$2,'Sala 1','2026-10-28T12:00Z',null,'Bom',null,'Almoxarifado',false) AS id";
 const back="SELECT registrar_devolucao_termo($1,'2026-10-28T15:00Z','Bom',null,'Sem alterações aparentes')";

 // Situacao: troca manual bloqueada com retirada aberta; demais edicoes e fluxo normal preservados.
 await asUser(admin);
 const eq=(await db.query("INSERT INTO equipamentos(descricao,tag,criado_por)VALUES('Notebook','TI-100',$1) RETURNING id",[admin])).rows[0].id;
 await asUser(operador);
 const mov=(await db.query(out,[eq,operador])).rows[0].id;
 await asUser(admin);
 for(const s of ['Disponível','Manutenção','Baixado'])
  await assert.rejects(()=>db.query('UPDATE equipamentos SET situacao=$2 WHERE id=$1',[eq,s]),/retirada em aberto/);
 await db.query("UPDATE equipamentos SET descricao='Notebook 14',situacao='Em uso' WHERE id=$1",[eq]);
 await asUser(operador);
 await db.query(back,[mov]);
 await asUser(admin);
 assert.equal((await db.query('SELECT situacao FROM equipamentos WHERE id=$1',[eq])).rows[0].situacao,'Disponível');
 await db.query("UPDATE equipamentos SET situacao='Manutenção' WHERE id=$1",[eq]);
 await db.query("UPDATE equipamentos SET situacao='Disponível' WHERE id=$1",[eq]);

 // Arquivamento e restauracao continuam funcionando com o gatilho instalado.
 const ciclo=(await db.query("SELECT arquivar_inventario('Ciclo teste') AS id")).rows[0].id;
 await db.query('SELECT restaurar_inventario($1)',[ciclo]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM equipamentos WHERE ciclo_arquivado_id IS NULL')).rows[0].n,1);

 // Exclusao de conta com registros: dados preservados, referencia vazia.
 await asUser(operador);
 const mov2=(await db.query(out,[eq,operador])).rows[0].id;
 await db.query(back,[mov2]);
 await db.exec('RESET ROLE');
 await db.query('DELETE FROM auth.users WHERE id=$1',[operador]);
 const movs=(await db.query('SELECT responsavel,registrado_por FROM movimentacoes WHERE equipamento_id=$1',[eq])).rows;
 assert.equal(movs.length,4);
 assert.ok(movs.every(m=>m.registrado_por===null&&m.responsavel==='Operador Teste'));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM termos_equipamentos')).rows[0].n,2);
 await db.query('DELETE FROM auth.users WHERE id=$1',[admin]);
 assert.equal((await db.query('SELECT criado_por FROM equipamentos WHERE id=$1',[eq])).rows[0].criado_por,null);

 await db.close();console.log('Integridade 1.4.4: exclusao de contas com historico e protecao da situacao Em uso OK.');
})().catch(e=>{console.error(e);process.exit(1)});
