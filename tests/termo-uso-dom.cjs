// Requer jsdom. Sem acesso ao Supabase real.
// Valida o aviso de privacidade (entrada, cadastro, termo e página) e o aceite do termo de uso (1.11.0).
const {JSDOM}=require('jsdom'),fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.invalid',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();
const run=s=>new vm.Script(s).runInContext(ctx),$=id=>w.document.getElementById(id),tick=()=>new Promise(r=>setTimeout(r,10));
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
const user={id:'10000000-0000-0000-0000-000000000001',email:'teste@example.invalid'};
let versao=null,rpcs=[];
const db={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},
 from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:[]}),
  maybeSingle:async()=>({data:table==='perfis_usuarios'?{perfil:'consulta',termo_uso_versao:versao}:null}),then:r=>Promise.resolve({data:[]}).then(r)};return q},
 rpc:async(name,args)=>{rpcs.push({name,args});if(name==='aceitar_termo_uso'){versao=args.p_versao;return{data:true};}return{data:[]};},
 storage:{from:()=>({download:async()=>({data:null})})}};
w.supabase={createClient:()=>db};w.user=user;
for(const f of ['exportacoes.js','app.js'])run(fs.readFileSync(f,'utf8'));
(async()=>{
 await tick();
 // Aviso de privacidade: o mesmo texto em todos os lugares, vindo de um só modelo.
 const avisos=[...w.document.querySelectorAll('[data-privacy-notice]')];
 assert.equal(avisos.length,4,'entrada, cadastro, termo de uso e página Privacidade');
 for(const a of avisos){assert.match(a.textContent,/Embrag e a ASBRAS/);assert.match(a.textContent,/CPF e telefone, só administradores/);assert.match(a.textContent,/5 anos/);assert.match(a.textContent,/Estados Unidos/);}
 assert.match($('registerForm').textContent,/Seu CPF identifica você no termo de responsabilidade/,'o cadastro explica para que serve o CPF');

 // Primeiro acesso: o termo aparece antes do sistema.
 await run('showApp({user})');await tick();
 assert.equal($('termsUseView').classList.contains('hidden'),false,'termo de uso visível');
 assert.equal($('appView').classList.contains('hidden'),true,'sistema escondido até aceitar');
 assert.equal($('termsUseVersion').textContent,run('TERMO_USO_VERSAO'));
 // Sem marcar a caixa, não registra nada.
 $('termsUseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(rpcs.filter(r=>r.name==='aceitar_termo_uso').length,0);assert.match($('termsUseMessage').textContent,/marque que leu e aceita/);
 // Marcou e aceitou: grava a versão atual e abre o sistema.
 $('termsUseAccept').checked=true;$('termsUseForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
 assert.equal(rpcs.find(r=>r.name==='aceitar_termo_uso').args.p_versao,run('TERMO_USO_VERSAO'));
 assert.equal($('termsUseView').classList.contains('hidden'),true);assert.equal($('appView').classList.contains('hidden'),false);
 // Página Privacidade no menu e no rodapé.
 run("goto('privacy')");assert.equal($('privacyPage').classList.contains('hidden'),false);assert.equal($('pageTitle').textContent,'Privacidade');
 assert.ok(w.document.querySelector('.nav-item[data-page="privacy"]'));assert.ok(w.document.querySelector('.footer-link[data-page="privacy"]'));
 // Versão nova do termo: pede de novo.
 versao='2026-01-01';run('state.user=null');await run('showApp({user})');await tick();
 assert.equal($('termsUseView').classList.contains('hidden'),false,'versão antiga pede novo aceite');
 console.log('Termo de uso e aviso de privacidade aprovados: aviso nos 4 lugares, aceite obrigatório, versão nova pede de novo.');
})().catch(e=>{console.error(e);process.exit(1);});
