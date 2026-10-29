// Testa os registros de auditoria da funcao Edge manage-users, sem acessar o Supabase real.
const fs=require('fs'),assert=require('node:assert/strict');
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
let requesterRole,audits,failUpsert;
const reset=()=>{requesterRole='administrador';audits=[];failUpsert=false;};
const rows={perfis_usuarios:{[ALVO]:{perfil:'consulta'}},dados_retirantes:{[ALVO]:{nome:'Pessoa Alvo',cpf:'52998224725',telefone:''}}};
const table=name=>{let id=null;return{
 select(){return this},eq(_c,v){id=v;return this},
 single:async()=>({data:{perfil:id===ADMIN?requesterRole:rows[name]?.[id]?.perfil}}),
 maybeSingle:async()=>({data:rows[name]?.[id]??null}),
 insert:async data=>{if(name==='auditoria')audits.push(data);return{error:null}},
 upsert:async()=>({error:failUpsert?{message:'Falha simulada'}:null})
};};
const createClient=()=>({from:table,auth:{getUser:async()=>({data:{user:{id:ADMIN,email:'admin@example.invalid'}}}),admin:{
 createUser:async({email})=>({data:{user:{id:'novo',email}}}),
 getUserById:async id=>({data:{user:{id,email:'alvo@example.invalid'}}}),
 deleteUser:async()=>({}),updateUserById:async()=>({})}}});
let handler;new Function('createClient','Deno',code)(createClient,{env:{get:()=>'test-env'},serve:fn=>handler=fn});
const call=async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()}};
const last=()=>audits.at(-1);
(async()=>{
 reset();let r=await call({action:'invite'});assert.equal(r.status,200);assert.equal(last().acao,'gerou_convite');assert.equal(last().autor_id,ADMIN);assert.equal(last().autor_email,'admin@example.invalid');
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
 // Acao que falha ou e negada nao gera registro.
 reset();failUpsert=true;r=await call({action:'role',userId:ALVO,perfil:'operador'});assert.equal(r.status,400);assert.equal(audits.length,0);
 reset();requesterRole='operador';r=await call({action:'invite'});assert.equal(r.status,403);assert.equal(audits.length,0);
 console.log('Auditoria de usuarios aprovada: convite, criacao, perfil, dados, bloqueio, senha e exclusao, sem dados sensiveis.');
})().catch(e=>{console.error(e);process.exit(1)});
