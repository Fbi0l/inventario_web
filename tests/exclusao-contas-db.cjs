// Execute com PGlite instalado: node tests/exclusao-contas-db.cjs
// Valida, em banco ficticio e sem credenciais reais:
//  1) exclusao de contas com convites (ATUALIZACAO_CONVITES_CADASTRO + ATUALIZACAO_1_4_1_EXCLUSAO_USUARIOS);
//  2) a migracao de privacidade dos termos (ATUALIZACAO_PRIVACIDADE_TERMOS), inclusive
//     o preenchimento da titularidade antiga, a reaplicacao e a exclusao do titular.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
const sql=f=>fs.readFileSync(f+'.sql','utf8');
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
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE TABLE public.perfis_usuarios(usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,perfil text);
 CREATE FUNCTION public.meu_perfil() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT perfil FROM public.perfis_usuarios WHERE usuario_id=auth.uid()$$;
 REVOKE ALL ON FUNCTION public.meu_perfil() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.meu_perfil() TO authenticated;`);
 await db.exec(sql('supabase_schema').replace('create extension if not exists pgcrypto;',''));
 await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON public.equipamentos,public.movimentacoes TO authenticated;');
 // Estado anterior a migracao de privacidade: termos ainda sem retirante_usuario_id.
 for(const f of ['ATUALIZACAO_ARQUIVAMENTO_CICLOS','ATUALIZACAO_EXCLUSAO_CICLOS','ATUALIZACAO_TERMOS_PDF',
  'ATUALIZACAO_CONVITES_CADASTRO','ATUALIZACAO_1_4_1_EXCLUSAO_USUARIOS','ATUALIZACAO_1_4_4_INTEGRIDADE'])
  await db.exec(sql(f));

 const id=n=>`60000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const [ADM,ADM2,OPE,UNICO,DUP1,DUP2,CONV,OUTRO]=[1,2,3,4,5,6,7,8].map(id);
 const CPF_UNICO='52998224725',CPF_DUP='11144477735';
 const contas=[[ADM,'administrador','Administrador Teste',null],[ADM2,'administrador','Segundo Administrador',null],
  [OPE,'operador','Operador Teste','12345678909'],[UNICO,'consulta','Titular Unico',CPF_UNICO],
  [DUP1,'consulta','Titular Duplicado A',CPF_DUP],[DUP2,'consulta','Titular Duplicado B',CPF_DUP],
  [OUTRO,'consulta','Outra Pessoa','39053344705']];
 for(const [u,perfil,nome,cpf] of contas){
  await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[u,`${u.slice(-2)}@example.invalid`]);
  await db.query('INSERT INTO perfis_usuarios VALUES($1,$2)',[u,perfil]);
  if(cpf)await db.query('INSERT INTO dados_retirantes(usuario_id,nome,cpf)VALUES($1,$2,$3)',[u,nome,cpf]);
 }
 const as=async(u,role='authenticated')=>{await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[u||'',role]);
  await db.exec(`SET ROLE ${role}`);};
 const root=async()=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false)");};
 const val=async(q,a=[])=>Object.values((await db.query(q,a)).rows[0])[0];
 const out="SELECT registrar_retirada_termo($1,$2,'Sala 1','2026-10-28T12:00Z',null,'Bom',null,'Almoxarifado',false) AS id";
 const back="SELECT registrar_devolucao_termo($1,'2026-10-28T15:00Z','Bom',null,'Sem alterações aparentes')";

 // ---------- Parte 1: exclusao de contas com convites ----------
 await root();
 const novoConvite=async(hash,criador,extra='')=>val(
  `INSERT INTO convites_cadastro(token_hash,criado_por,expira_em${extra?',usado_em,usado_por':''})
   VALUES($1,$2,now()+interval '1 day'${extra?",now(),$3":''}) RETURNING id`,extra?[hash,criador,extra]:[hash,criador]);
 await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[CONV,'convidado@example.invalid']);
 await db.query("INSERT INTO perfis_usuarios VALUES($1,'consulta')",[CONV]);
 const usado=await novoConvite('hash-usado',ADM,CONV);
 const pendenteAdm=await novoConvite('hash-pendente-adm',ADM);
 const pendenteAdm2=await novoConvite('hash-pendente-adm2',ADM2);

 // Convites so podem ser manipulados pela Edge Function (service_role).
 await as(OPE);
 await assert.rejects(()=>db.query('SELECT * FROM convites_cadastro'),/permission denied/);
 await assert.rejects(()=>db.query("SELECT reservar_convite_cadastro('hash-pendente-adm',gen_random_uuid())"),/permission denied|Acesso negado/);

 // Excluir quem USOU um convite: conta some, convite continua marcado como usado e nao reabre.
 await root();
 await db.query('DELETE FROM auth.users WHERE id=$1',[CONV]);
 let c=(await db.query('SELECT usado_em,usado_por,criado_por FROM convites_cadastro WHERE id=$1',[usado])).rows[0];
 assert.equal(c.usado_por,null,'usado_por fica vazio ao excluir o convidado');
 assert.ok(c.usado_em,'o convite continua registrado como usado');
 assert.equal(c.criado_por,ADM);
 await as(null,'service_role');
 assert.equal(await val("SELECT reservar_convite_cadastro('hash-usado',gen_random_uuid())"),false,'convite usado nao pode ser reutilizado');

 // Excluir o administrador que GEROU convites (usado e pendente): exclusao funciona, convites preservados.
 await root();
 await db.query('DELETE FROM auth.users WHERE id=$1',[ADM]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM convites_cadastro')).rows[0].n,3,'nenhum convite apagado');
 assert.equal(await val('SELECT criado_por FROM convites_cadastro WHERE id=$1',[usado]),null);
 assert.equal(await val('SELECT criado_por FROM convites_cadastro WHERE id=$1',[pendenteAdm]),null);
 assert.equal(await val('SELECT criado_por FROM convites_cadastro WHERE id=$1',[pendenteAdm2]),ADM2,'convite de outro administrador nao e afetado');

 // Ciclo completo de um convite pendente com reserva: reserva unica, finalizacao e exclusao posterior.
 await as(null,'service_role');
 const r1='70000000-0000-0000-0000-000000000001',r2='70000000-0000-0000-0000-000000000002';
 assert.equal(await val("SELECT reservar_convite_cadastro('hash-pendente-adm2',$1)",[r1]),true);
 assert.equal(await val("SELECT reservar_convite_cadastro('hash-pendente-adm2',$1)",[r2]),false,'reserva concorrente recusada');
 await root();
 const NOVO=id(9);
 await db.query("INSERT INTO auth.users(id,email)VALUES($1,'novo@example.invalid')",[NOVO]);
 await as(null,'service_role');
 assert.equal(await val("SELECT finalizar_convite_cadastro('hash-pendente-adm2',$1,$2)",[r1,NOVO]),true);
 await root();
 await db.query('DELETE FROM auth.users WHERE id=ANY($1)',[[NOVO,ADM2]]);
 c=(await db.query('SELECT usado_em,usado_por,criado_por FROM convites_cadastro WHERE id=$1',[pendenteAdm2])).rows[0];
 assert.ok(c.usado_em&&c.usado_por===null&&c.criado_por===null,'convite fica como historico anonimo');

 // ---------- Parte 2: migracao de privacidade dos termos ----------
 // Termos antigos, criados ANTES da migracao (sem titular registrado).
 await as(OPE);
 const eqs=[];
 for(const t of ['TI-1','TI-2','TI-3','TI-4'])eqs.push(await val("INSERT INTO equipamentos(descricao,tag)VALUES('Notebook',$1) RETURNING id",[t]));
 const termo=async(eq,ret)=>{await as(OPE);const m=await val(out,[eq,ret]);await db.query(back,[m]);return m;};
 const tUnico=await termo(eqs[0],UNICO),tDup=await termo(eqs[1],DUP1);
 // Termo cujo CPF nao corresponde a nenhum cadastro atual (cadastro corrigido depois).
 const tSemCad=await termo(eqs[2],OUTRO);
 await root();
 await db.query("UPDATE dados_retirantes SET cpf='86288366757' WHERE usuario_id=$1",[OUTRO]);

 await db.exec(sql('ATUALIZACAO_PRIVACIDADE_TERMOS'));
 const titular=async m=>{await root();return val('SELECT retirante_usuario_id FROM termos_equipamentos WHERE movimentacao_id=$1',[m]);};
 assert.equal(await titular(tUnico),UNICO,'CPF unico: titular preenchido');
 assert.equal(await titular(tDup),null,'CPF duplicado: titular NAO e presumido');
 assert.equal(await titular(tSemCad),null,'CPF sem cadastro correspondente: titular vazio');

 // Reaplicar a migracao nao altera nem duplica nada.
 await db.exec(sql('ATUALIZACAO_PRIVACIDADE_TERMOS'));
 assert.equal(await titular(tUnico),UNICO);
 assert.equal(await titular(tDup),null);

 // Termo novo grava o titular na mesma transacao.
 const tNovo=await termo(eqs[3],DUP2);
 assert.equal(await titular(tNovo),DUP2);

 // Acesso: titular ve o proprio termo; outra conta Consulta nao; administrador ve todos.
 const ADM3=id(10);
 await root();
 await db.query("INSERT INTO auth.users(id,email)VALUES($1,'adm3@example.invalid')",[ADM3]);
 await db.query("INSERT INTO perfis_usuarios VALUES($1,'administrador')",[ADM3]);
 const todos=[tUnico,tDup,tSemCad,tNovo];
 const visiveis=async u=>{await as(u);return (await db.query('SELECT movimentacao_id FROM listar_termos_visiveis($1)',[todos])).rows.map(r=>r.movimentacao_id).sort();};
 assert.deepEqual(await visiveis(UNICO),[tUnico]);
 assert.deepEqual(await visiveis(DUP1),[],'titular nao confirmado nao ve termo antigo');
 assert.deepEqual(await visiveis(ADM3),[...todos].sort());
 await as(UNICO);
 assert.equal((await val('SELECT obter_termo_equipamento($1)',[tUnico])).retirante.nome,'Titular Unico');
 await as(OUTRO);
 await assert.rejects(()=>db.query('SELECT obter_termo_equipamento($1)',[tUnico]),/nao autorizado/);

 // Excluir o titular: dados pessoais do cadastro somem, termo e movimentacao permanecem.
 await root();
 await db.query('DELETE FROM auth.users WHERE id=$1',[UNICO]);
 assert.equal(await val('SELECT count(*)::int FROM dados_retirantes WHERE usuario_id=$1',[UNICO]),0,'cadastro pessoal removido');
 assert.equal(await titular(tUnico),null,'titular fica vazio');
 assert.equal(await val('SELECT count(*)::int FROM movimentacoes WHERE id=$1',[tUnico]),1,'movimentacao preservada');
 assert.deepEqual(await visiveis(ADM3),[...todos].sort(),'administrador continua acessando o termo');
 // Ninguem herda o termo do titular excluido.
 assert.deepEqual(await visiveis(OUTRO),[]);
 // Conta excluida nao pode mais ser usada como retirante.
 await root();
 const eqLivre=await val("INSERT INTO equipamentos(descricao,tag)VALUES('Monitor','TI-5') RETURNING id");
 await as(OPE);
 await assert.rejects(()=>db.query(out,[eqLivre,UNICO]),/sem cadastro completo/);

 await db.close();
 console.log('Exclusao de contas aprovada: convites (usado, pendente, reservado) e migracao de privacidade dos termos (titularidade, reaplicacao, acesso e exclusao do titular).');
})().catch(e=>{console.error(e);process.exit(1)});
