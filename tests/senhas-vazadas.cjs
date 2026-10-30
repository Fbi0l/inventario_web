// Testa a regra de senhas (1.5.3) nas funcoes Edge register-user e manage-users,
// sem acessar o Supabase nem a internet: tamanho minimo de 8 caracteres e recusa
// de senhas vazadas via Have I Been Pwned (k-anonimato).
const fs=require('fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const carregar=(arquivo,createClient)=>{
 const src=fs.readFileSync(arquivo,'utf8').replace(/^import .*\n/,'');
 let code;
 try{
  const ts=require('typescript');
  code=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 }catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;code=require('node:module').stripTypeScriptTypes(src);}
 let handler;new Function('createClient','Deno',code)(createClient,{env:{get:()=>'test-env'},serve:fn=>handler=fn});
 return async body=>{const r=await handler(new Request('https://example.invalid',{method:'POST',
  headers:{Authorization:'Bearer t','Content-Type':'application/json'},body:JSON.stringify(body)}));return{status:r.status,body:await r.json()};};
};

// Servico HIBP simulado: responde a faixa pedida com a senha "vazada", outra entrada qualquer
// e uma linha de preenchimento (contagem 0), como faz a API real com Add-Padding.
const VAZADA='senha-que-vazou-123',SEGURA='uma-senha-unica-e-longa';
const sha1=s=>crypto.createHash('sha1').update(s).digest('hex').toUpperCase();
let pedidos,modo;
const reset=()=>{pedidos=[];modo='normal';criados=[];senhasAlteradas=[];reservas=0;};
globalThis.fetch=async(url,opts={})=>{
 pedidos.push({url:String(url),headers:opts.headers});
 if(modo==='fora')throw new Error('rede indisponivel');
 if(modo==='erro')return new Response('',{status:503});
 const prefixo=String(url).split('/').pop(),h=sha1(VAZADA),corpo=[];
 if(h.startsWith(prefixo))corpo.push(`${h.slice(5)}:42`);
 const seguro=sha1(SEGURA);
 if(seguro.startsWith(prefixo))corpo.push(`${seguro.slice(5)}:0`); // preenchimento nao conta
 corpo.push('0000000000000000000000000000000000A:3');
 return new Response(corpo.join('\r\n'),{status:200});
};

let criados,senhasAlteradas,reservas;
const clienteCadastro=()=>({
 rpc:async name=>{if(name==='reservar_convite_cadastro')reservas++;return{data:true,error:null};},
 from:()=>({insert:async()=>({error:null})}),
 auth:{admin:{createUser:async({email})=>{criados.push(email);return{data:{user:{id:'novo',email}},error:null};},deleteUser:async()=>({error:null})}}
});
const ADMIN='aaaaaaaa-0000-0000-0000-000000000001',ALVO='bbbbbbbb-0000-0000-0000-000000000002';
const tabela=()=>{const q={select:()=>q,eq:(c,v)=>{q.id=v;return q},single:async()=>({data:{perfil:'administrador'}}),
 maybeSingle:async()=>({data:null}),insert:()=>q,upsert:async()=>({error:null}),then:(a,b)=>Promise.resolve({data:null,error:null}).then(a,b)};return q;};
const clienteGestao=()=>({from:tabela,auth:{getUser:async()=>({data:{user:{id:ADMIN,email:'admin@example.invalid'}}}),admin:{
 createUser:async({email})=>{criados.push(email);return{data:{user:{id:'novo',email}}};},
 getUserById:async id=>({data:{user:{id,email:'alvo@example.invalid'}}}),
 updateUserById:async(id,{password})=>{senhasAlteradas.push(password);return{};},deleteUser:async()=>({})}}});

const cadastro=carregar('supabase/functions/register-user/index.ts',clienteCadastro);
const gestao=carregar('supabase/functions/manage-users/index.ts',clienteGestao);
const convite={token:'A'.repeat(43),name:'Pessoa Convidada',cpf:'529.982.247-25',phone:'',email:'convite@example.invalid'};
const novo={action:'create',email:'novo@example.invalid',name:'Pessoa Nova',cpf:'52998224725',perfil:'consulta'};

(async()=>{
 // Cadastro por convite: senha vazada recusada antes de reservar o convite ou criar a conta.
 reset();let r=await cadastro({...convite,password:VAZADA});
 assert.equal(r.status,400);assert.match(r.body.error,/vazamentos/);
 assert.equal(reservas,0,'convite nao foi reservado');assert.equal(criados.length,0);
 // Privacidade: so os 5 primeiros caracteres do hash saem do servidor.
 assert.equal(pedidos.length,1);
 assert.equal(pedidos[0].url,`https://api.pwnedpasswords.com/range/${sha1(VAZADA).slice(0,5)}`);
 assert.ok(!JSON.stringify(pedidos).includes(sha1(VAZADA).slice(5))&&!JSON.stringify(pedidos).includes(VAZADA),'nem a senha nem o hash completo sao enviados');
 assert.equal(pedidos[0].headers['Add-Padding'],'true');
 // Senha nao vazada e aceita, mesmo que apareca como linha de preenchimento (contagem 0).
 reset();r=await cadastro({...convite,password:SEGURA});assert.equal(r.status,201);assert.deepEqual(criados,['convite@example.invalid']);
 // Tamanho: 7 caracteres recusado sem consultar o servico; 129 tambem.
 reset();r=await cadastro({...convite,password:'a'.repeat(7)});assert.equal(r.status,400);assert.match(r.body.error,/8 a 128/);assert.equal(pedidos.length,0);
 reset();r=await cadastro({...convite,password:'a'.repeat(129)});assert.equal(r.status,400);
 // Servico fora do ar ou com erro: o cadastro segue (a verificacao nunca trava o sistema).
 for(const m of ['fora','erro']){reset();modo=m;const err=console.error;console.error=()=>{};
  r=await cadastro({...convite,password:VAZADA});console.error=err;assert.equal(r.status,201,`modo ${m}`);}

 // Administrador criando conta.
 reset();r=await gestao({...novo,password:VAZADA});assert.equal(r.status,400);assert.match(r.body.error,/vazamentos/);assert.equal(criados.length,0);
 reset();r=await gestao({...novo,password:'curta-7'});assert.equal(r.status,400);assert.match(r.body.error,/8 a 128/);
 reset();r=await gestao({...novo,password:SEGURA});assert.equal(r.status,201);
 // Administrador trocando senha.
 reset();r=await gestao({action:'password',userId:ALVO,password:VAZADA});assert.equal(r.status,400);assert.equal(senhasAlteradas.length,0);
 reset();r=await gestao({action:'password',userId:ALVO,password:'a'.repeat(7)});assert.equal(r.status,400);assert.equal(senhasAlteradas.length,0);
 reset();r=await gestao({action:'password',userId:ALVO,password:SEGURA});assert.equal(r.status,200);assert.deepEqual(senhasAlteradas,[SEGURA]);

 console.log('Senhas aprovadas: minimo de 8, recusa de senhas vazadas (k-anonimato, so 5 caracteres do hash) e servico fora do ar nao trava.');
})().catch(e=>{console.error(e);process.exit(1)});
