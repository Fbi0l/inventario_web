// Testa a funcao Edge sem acessar o Supabase real. Requer TypeScript.
const ts=require('typescript'),fs=require('fs'),assert=require('node:assert/strict');
// Consulta de senhas vazadas simulada: nenhum teste acessa a internet.
globalThis.fetch=async()=>new Response('',{status:200});
const src=fs.readFileSync('supabase/functions/manage-users/index.ts','utf8').replace(/^import .*\n/,'');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
assert.equal(js.diagnostics.length,0);
let handler,role='administrador',saved=[],deleted=[],personalFail=false;
const table=name=>({select(){return this},eq(){return this},single:async()=>({data:{perfil:role}}),maybeSingle:async()=>({data:null}),insert:async()=>({error:null}),upsert:async data=>{saved.push({table:name,data});return{error:name==='dados_retirantes'&&personalFail?{message:'Falha simulada'}:null}}});
const createClient=()=>({from:table,auth:{getUser:async()=>({data:{user:{id:'admin'}}}),admin:{createUser:async()=>({data:{user:{id:'novo',email:'teste@example.invalid'}}}),getUserById:async id=>({data:{user:{id}}}),deleteUser:async id=>{deleted.push(id);return {}}}}});
new Function('createClient','Deno',js.outputText)(createClient,{env:{get:()=> 'test-env'},serve:fn=>handler=fn});
const call=async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()}};
(async()=>{
 const input={action:'create',email:'teste@example.invalid',password:'senha-de-teste-longa',name:'Pessoa Teste',cpf:'529.982.247-25',phone:'(00) 0000-0000',perfil:'consulta'};
 let r=await call(input);assert.equal(r.status,201);assert.equal(saved.find(x=>x.table==='dados_retirantes').data.cpf,'52998224725');
 r=await call({...input,cpf:'11111111111'});assert.equal(r.status,400);
 r=await call({...input,name:''});assert.equal(r.status,400);
 role='operador';r=await call(input);assert.equal(r.status,403);role='administrador';
 r=await call({...input,action:'details',userId:'existente',name:'Nome Atualizado'});assert.equal(r.status,200);assert.equal(saved.at(-1).data.nome,'Nome Atualizado');
 personalFail=true;r=await call(input);assert.equal(r.status,500);assert.ok(deleted.includes('novo'));
 console.log('Usuarios aprovados: criacao, CPF, nome, permissao, edicao e rollback de cadastro incompleto.');
})().catch(e=>{console.error(e);process.exit(1)});
