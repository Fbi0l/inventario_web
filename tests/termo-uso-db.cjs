// Execute com PGlite instalado: node tests/termo-uso-db.cjs
// Valida, em banco fictício e sem credenciais reais, a ATUALIZACAO_1_11_0_TERMO_USO:
// cada usuário aceita só o próprio termo de uso; versão inválida, visitante e conta sem perfil são recusados;
// ninguém altera o aceite de outra pessoa; o script pode ser executado de novo.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 CREATE TABLE public.perfis_usuarios(usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,perfil text,atualizado_em timestamptz DEFAULT now());
 ALTER TABLE public.perfis_usuarios ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON public.perfis_usuarios TO authenticated;
 CREATE POLICY "visualizar proprio perfil" ON public.perfis_usuarios FOR SELECT TO authenticated USING (usuario_id=auth.uid());
 CREATE FUNCTION public.meu_perfil() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT perfil FROM public.perfis_usuarios WHERE usuario_id=auth.uid()$$;
 REVOKE ALL ON FUNCTION public.meu_perfil() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.meu_perfil() TO authenticated;`);
 const migracao=fs.readFileSync('ATUALIZACAO_1_11_0_TERMO_USO.sql','utf8');
 await db.exec(migracao);
 await db.exec(migracao); // reaplicar não pode falhar

 const [ADM,CON,SEM]=['70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000003'];
 for(const u of [ADM,CON,SEM])await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[u,u.slice(-1)+'@example.invalid']);
 await db.query("INSERT INTO perfis_usuarios(usuario_id,perfil) VALUES($1,'administrador'),($2,'consulta')",[ADM,CON]);
 const como=async(u,role='authenticated')=>{await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[u||'']);await db.exec(`SET ROLE ${role}`);};
 const falha=async(sql,params,trecho)=>{await assert.rejects(db.query(sql,params),e=>{assert.match(e.message,trecho);return true;});};

 await como(CON);
 const r=await db.query("SELECT public.aceitar_termo_uso('2026-11-20') AS ok");
 assert.equal(r.rows[0].ok,true,'consulta aceita o próprio termo');
 const p=await db.query('SELECT termo_uso_versao,termo_uso_aceito_em FROM perfis_usuarios');
 assert.equal(p.rows.length,1,'cada um lê só o próprio perfil');
 assert.equal(p.rows[0].termo_uso_versao,'2026-11-20');assert.ok(p.rows[0].termo_uso_aceito_em);
 await falha("UPDATE perfis_usuarios SET termo_uso_versao='2026-01-01' WHERE usuario_id=$1",[ADM],/permission denied/);
 await falha("SELECT public.aceitar_termo_uso('qualquer')",[],/Versão do termo inválida/);
 await falha("SELECT public.aceitar_termo_uso(null)",[],/Versão do termo inválida/);

 await como(SEM);
 await falha("SELECT public.aceitar_termo_uso('2026-11-20')",[],/Acesso negado/);
 await como('', 'anon');
 await falha("SELECT public.aceitar_termo_uso('2026-11-20')",[],/permission denied/);

 await db.exec('RESET ROLE');
 const adm=await db.query('SELECT termo_uso_versao FROM perfis_usuarios WHERE usuario_id=$1',[ADM]);
 assert.equal(adm.rows[0].termo_uso_versao,null,'o aceite de um não altera o de outro');
 await falha("UPDATE perfis_usuarios SET termo_uso_versao='20-11-2026' WHERE usuario_id=$1",[ADM],/termo_uso_versao_formato/);
 console.log('Termo de uso aprovado: aceite só do próprio perfil, versão validada, visitante e conta sem perfil recusados, script reaplicável.');
})().catch(e=>{console.error(e);process.exit(1);});
