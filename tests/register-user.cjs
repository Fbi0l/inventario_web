// Testa a funcao Edge register-user sem acessar o Supabase real.
// Usa TypeScript quando instalado; senao, o removedor de tipos nativo do Node (22.13+).
const fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('supabase/functions/register-user/index.ts','utf8').replace(/^import .*\n/,'');
let code;
try{
 const ts=require('typescript');
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
 assert.equal(js.diagnostics.length,0);code=js.outputText;
}catch(e){
 if(e.code!=='MODULE_NOT_FOUND')throw e;
 code=require('node:module').stripTypeScriptTypes(src);
}
let handler,reserveOk,failOn,inserted,deleted,rpcs;
const reset=()=>{reserveOk=true;failOn=null;inserted=[];deleted=[];rpcs=[];};
const createClient=()=>({
 rpc:async(name,args)=>{rpcs.push(name);return{data:name==='reservar_convite_cadastro'?reserveOk:true,error:null};},
 from:table=>({insert:async data=>{inserted.push({table,data});return{error:failOn===table?{message:'Falha simulada'}:null};}}),
 auth:{admin:{
  createUser:async({email})=>({data:{user:{id:'novo-usuario',email}},error:null}),
  deleteUser:async id=>{deleted.push(id);return{error:null};}
 }}
});
new Function('createClient','Deno',code)(createClient,{env:{get:()=>'test-env'},serve:fn=>handler=fn});
const call=async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
const valid={token:'A'.repeat(43),name:'Pessoa Convidada',cpf:'529.982.247-25',phone:'',email:'convite@example.invalid',password:'senha-teste-123'};
(async()=>{
 // Cadastro valido: perfil Consulta, dados do retirante salvos e convite finalizado.
 reset();let r=await call(valid);
 assert.equal(r.status,201);
 assert.deepEqual(inserted.find(x=>x.table==='perfis_usuarios').data,{usuario_id:'novo-usuario',perfil:'consulta'});
 assert.equal(inserted.find(x=>x.table==='dados_retirantes').data.cpf,'52998224725');
 assert.ok(rpcs.includes('finalizar_convite_cadastro'));
 assert.equal(deleted.length,0);
 const audit=inserted.find(x=>x.table==='auditoria').data;
 assert.equal(audit.acao,'cadastrou_por_convite');assert.equal(audit.autor_id,'novo-usuario');assert.equal(audit.detalhes.perfil,'consulta');
 assert.ok(!JSON.stringify(audit).includes('52998224725')&&!JSON.stringify(audit).includes(valid.password),'auditoria sem CPF nem senha');
 // Campos enviados pelo navegador nao elevam o perfil.
 reset();r=await call({...valid,perfil:'administrador'});
 assert.equal(r.status,201);assert.equal(inserted.find(x=>x.table==='perfis_usuarios').data.perfil,'consulta');
 // Convite com formato invalido ou ja utilizado.
 reset();r=await call({...valid,token:'curto'});assert.equal(r.status,400);assert.equal(inserted.length,0);
 reset();reserveOk=false;r=await call(valid);assert.equal(r.status,409);assert.equal(inserted.length,0);
 // Falha ao salvar dados pessoais: conta revertida e reserva liberada.
 reset();failOn='dados_retirantes';r=await call(valid);
 assert.equal(r.status,500);assert.deepEqual(deleted,['novo-usuario']);assert.ok(!inserted.some(x=>x.table==='auditoria'),'cadastro desfeito nao gera auditoria');assert.ok(rpcs.includes('liberar_convite_cadastro'));
 console.log('Convites aprovados: perfil Consulta imposto pelo servidor, convite invalido/usado recusado e rollback de cadastro incompleto.');
})().catch(e=>{console.error(e);process.exit(1)});
