// Testa os registros de auditoria da funcao Edge manage-users, sem acessar o Supabase real.
const fs=require('fs'),assert=require('node:assert/strict');
// Consulta de senhas vazadas simulada: nenhum teste acessa a internet.
globalThis.fetch=async()=>new Response('',{status:200});
const src=fs.readFileSync('supabase/functions/manage-users/index.ts','utf8').replace(/^import .*\n/,'');
let code;
try{
 const ts=require('typescript');
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
 assert.equal(js.diagnostics.length,0);code=js.outputText;
}catch(e){
 if(e.code!=='MODULE_NOT_FOUND')throw e;
 code=require('node:module').stripTypeScriptTypes(src);
}
const ADMIN='aaaaaaaa-0000-0000-0000-000000000001',ALVO='bbbbbbbb-0000-0000-0000-000000000002';
let requesterRole,audits,failUpsert,invites;
const reset=()=>{requesterRole='administrador';audits=[];failUpsert=false;
 invites=[{id:'cccccccc-0000-0000-0000-000000000001',criado_em:'2026-10-28T20:00:00Z',expira_em:'2099-01-01T00:00:00Z',criado_por:ADMIN,usado_em:null,token_hash:'segredo'}];};
const rows={perfis_usuarios:{[ALVO]:{perfil:'consulta'}},dados_retirantes:{[ALVO]:{nome:'Pessoa Alvo',cpf:'52998224725',telefone:''}}};
// Simula o query builder do supabase-js para as chamadas usadas pela funcao.
const table=name=>{let id=null,filters=[],patch=null,cols=null;const q={
 select(c){cols=c;return q},eq(c,v){id=v;filters.push(r=>r[c]===v);return q},is(c,v){filters.push(r=>r[c]===v);return q},
 gt(c,v){filters.push(r=>r[c]>v);return q},order(){return q},limit(){return q},
 update(p){patch=p;return q},
 single:async()=>name==='convites_cadastro'?{data:{id:'novo-convite'},error:null}:{data:{perfil:id===ADMIN?requesterRole:rows[name]?.[id]?.perfil}},
 maybeSingle:async()=>{if(name==='convites_cadastro'){const hit=invites.find(r=>filters.every(f=>f(r)));if(hit&&patch)Object.assign(hit,patch);return{data:hit?{id:hit.id,criado_em:hit.criado_em}:null,error:null};}return{data:rows[name]?.[id]??null};},
 insert(data){if(name==='auditoria')audits.push(data);return q},
 upsert:async()=>({error:failUpsert?{message:'Falha simulada'}:null}),
 then(res,rej){const data=name==='convites_cadastro'&&cols?invites.filter(r=>filters.every(f=>f(r))).map(({token_hash,usado_em,...r})=>r):null;return Promise.resolve({data,error:null}).then(res,rej);}
};return q;};
const createClient=()=>({from:table,auth:{getUser:async()=>({data:{user:{id:ADMIN,email:'admin@example.invalid'}}}),admin:{
 createUser:async({email})=>({data:{user:{id:'novo',email}}}),
 getUserById:async id=>({data:{user:{id,email:'alvo@example.invalid'}}}),
 deleteUser:async()=>({}),updateUserById:async()=>({})}}});
let handler;new Function('createClient','Deno',code)(createClient,{env:{get:()=>'test-env'},serve:fn=>handler=fn});
const call=async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()}};
const last=()=>audits.at(-1);
const INV='cccccccc-0000-0000-0000-000000000001';
(async()=>{
 reset();let r=await call({action:'invite'});assert.equal(r.status,200);assert.equal(last().acao,'gerou_convite');assert.equal(last().entidade_id,'novo-convite');assert.equal(r.body.id,'novo-convite');assert.equal(last().autor_id,ADMIN);assert.equal(last().autor_email,'admin@example.invalid');
 assert.ok(!JSON.stringify(last()).includes(r.body.token),'token do convite nao vai para a auditoria');
 reset();r=await call({action:'create',email:'novo@example.invalid',password:'senha-secreta-1',name:'Pessoa Nova',cpf:'52998224725',perfil:'operador'});
 assert.equal(r.status,201);assert.deepEqual([last().acao,last().entidade_id,last().descricao,last().detalhes],['criou','novo','novo@example.invalid',{perfil:'operador'}]);
 assert.ok(!JSON.stringify(audits).includes('senha-secreta-1')&&!JSON.stringify(audits).includes('52998224725'),'sem senha nem CPF');
 reset();r=await call({action:'role',userId:ALVO,perfil:'operador'});assert.equal(r.status,200);assert.deepEqual(last().detalhes,{antes:'consulta',depois:'operador'});assert.equal(last().descricao,'alvo@example.invalid');
 reset();r=await call({action:'details',userId:ALVO,name:'Pessoa Alvo',cpf:'111.444.777-35',phone:''});assert.equal(r.status,200);
 assert.deepEqual(last().detalhes,{campos:['cpf']});assert.ok(!JSON.stringify(last()).includes('11144477735'),'so o nome do campo, sem o valor');
 reset();r=await call({action:'access',userId:ALVO,blocked:true});assert.equal(last().acao,'bloqueou');
 reset();r=await call({action:'access',userId:ALVO,blocked:false});assert.equal(last().acao,'desbloqueou');
 reset();r=await call({action:'password',userId:ALVO,password:'nova-senha-123'});assert.equal(r.status,200);assert.equal(last().acao,'alterou_senha');assert.ok(!JSON.stringify(last()).includes('nova-senha-123'));
 reset();r=await call({action:'delete',userId:ALVO});assert.equal(r.status,200);assert.deepEqual([last().acao,last().descricao,last().detalhes],['excluiu','alvo@example.invalid',{perfil:'consulta'}]);
 // Convites pendentes: lista sem token; cancelar vence o convite e registra.
 reset();r=await call({action:'list_invites'});assert.equal(r.status,200);assert.equal(r.body.invites.length,1);assert.ok(!('token_hash' in r.body.invites[0]),'lista nao expoe hash');
 r=await call({action:'revoke_invite',inviteId:INV});assert.equal(r.status,200);assert.deepEqual([last().acao,last().entidade,last().entidade_id],['cancelou_convite','convite',INV]);
 assert.ok(invites[0].expira_em<=new Date().toISOString(),'convite vencido na hora');
 r=await call({action:'list_invites'});assert.equal(r.body.invites.length,0,'cancelado sai da lista');
 const n=audits.length;r=await call({action:'revoke_invite',inviteId:INV});assert.equal(r.status,404);assert.equal(audits.length,n,'cancelar de novo nao registra');
 r=await call({action:'revoke_invite',inviteId:'nao-e-uuid'});assert.equal(r.status,400);
 reset();invites[0].usado_em='2026-10-28T21:00:00Z';r=await call({action:'revoke_invite',inviteId:INV});assert.equal(r.status,404,'convite ja usado nao e cancelado');
 reset();requesterRole='operador';r=await call({action:'revoke_invite',inviteId:INV});assert.equal(r.status,403);assert.equal(audits.length,0);
 // Acao que falha ou e negada nao gera registro.
 reset();failUpsert=true;r=await call({action:'role',userId:ALVO,perfil:'operador'});assert.equal(r.status,400);assert.equal(audits.length,0);
 reset();requesterRole='operador';r=await call({action:'invite'});assert.equal(r.status,403);assert.equal(audits.length,0);
 console.log('Auditoria de usuarios aprovada: convite (gerar, listar, cancelar), criacao, perfil, dados, bloqueio, senha e exclusao, sem dados sensiveis.');
})().catch(e=>{console.error(e);process.exit(1)});
