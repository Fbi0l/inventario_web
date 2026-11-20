// Acessibilidade de todas as telas no Chromium (Playwright + axe-core), com Supabase simulado e dados fictícios.
// Confere entrada, cadastro por convite, termo de uso, cada página e as janelas principais, no computador e no celular.
// Falha com problema sério ou crítico (WCAG 2.2 AA), com erro de JavaScript ou com rolagem lateral no celular.
// Prints em test-results/navegador/. Requer Playwright e axe-core.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const axe=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const root=process.cwd(),prints=path.join(root,'test-results/navegador');fs.mkdirSync(prints,{recursive:true});
const termoUso=fs.readFileSync(path.join(root,'app.js'),'utf8').match(/TERMO_USO_VERSAO = '([^']+)'/)[1];
const stub=termo=>`window.testUser={id:'10000000-0000-0000-0000-000000000001',email:'admin@example.invalid'};
 const eq=[{id:'30000000-0000-0000-0000-000000000001',tag:'TI-01',patrimonio:'PAT-01',descricao:'Notebook Exemplo',categoria:'Informática',marca:'Marca',modelo:'Modelo',situacao:'Em uso',estado:'Bom',responsavel:'Pessoa Exemplo',localizacao:'Sede',valor:3500,created_at:'2026-10-01T12:00:00Z'},
  {id:'30000000-0000-0000-0000-000000000002',tag:'TI-02',patrimonio:'PAT-02',descricao:'Projetor Exemplo',categoria:'Audiovisual',situacao:'Disponível',estado:'Bom',localizacao:'Sede',valor:2000,created_at:'2026-10-02T12:00:00Z'}];
 const mov=[{id:'20000000-0000-0000-0000-000000000001',equipamento_id:eq[0].id,responsavel:'Pessoa Exemplo',tipo:'Retirada',local_acao:'Município Exemplo',retirada_em:'2026-11-18T12:00:00Z',previsao_devolucao:'2026-11-19T12:00:00Z',devolucao_em:null,termo_versao:1,created_at:'2026-11-18T12:00:00Z',equipamentos:{tag:'TI-01',patrimonio:'PAT-01',descricao:'Notebook Exemplo'}}];
 const audit=[{id:1,ocorrido_em:'2026-11-18T12:00:00Z',autor_email:'admin@example.invalid',acao:'editou',entidade:'equipamento',entidade_id:eq[0].id,descricao:'TI-01',detalhes:{}}];
 const dados=t=>t==='equipamentos'?eq:t==='movimentacoes'?mov:t==='auditoria'?audit:[];
 window.supabase={createClient:()=>({storage:{from:()=>({download:async()=>({data:null})})},
  auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},
  functions:{invoke:async(_,{body})=>({data:body.action==='list'?{users:[{id:testUser.id,email:testUser.email,perfil:'administrador',created_at:'2026-10-01T00:00:00Z',dados_retirante:{nome:'Pessoa Exemplo',cpf:'52998224725',telefone:''}}]}:body.action==='list_invites'?{invites:[]}:{}})},
  from:t=>{const q={select:()=>q,is:()=>q,eq:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:dados(t)}),
   maybeSingle:async()=>({data:{perfil:'administrador',termo_uso_versao:${JSON.stringify(termo)}}}),then:r=>Promise.resolve({data:dados(t)}).then(r)};return q;},
  rpc:async n=>({data:n==='listar_retirantes'?[{usuario_id:testUser.id,nome:'Pessoa Exemplo'}]:n==='aceitar_termo_uso'?true:[]})})};`;
const problemas=[];let passos=0;const ok=m=>{passos++;console.log('  ✓ '+m);};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 async function abrir(viewport,termo=termoUso,url='http://inventario.test/'){
  // bypassCSP só para injetar o axe; o site publicado continua com a política normal.
  const ctx=await browser.newContext({viewport,bypassCSP:true,serviceWorkers:'block',locale:'pt-BR'});const page=await ctx.newPage();const erros=[];
  page.on('pageerror',e=>erros.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',async route=>{
   const u=route.request().url();
   if(u.includes('@supabase/'))return route.fulfill({contentType:'text/javascript',body:stub(termo)});
   if(u.includes('cdn.jsdelivr')||u.includes('cdn.sheetjs'))return route.fulfill({contentType:'text/javascript',body:''});
   const p=new URL(u).pathname,file=path.join(root,p==='/'?'index.html':p);
   if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory())return route.fulfill({status:404,body:''});
   // O teste troca a biblioteca do Supabase por um simulador; só a integridade (SRI) dessa tag é removida.
   const body=file.endsWith('.html')?fs.readFileSync(file,'utf8').replace(/(<script src="[^"]*@supabase\/[^"]*") integrity="[^"]*"/,'$1'):fs.readFileSync(file);
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.woff2')?'font/woff2':'text/html',body});
  });
  await page.goto(url);await page.waitForTimeout(200);return {ctx,page,erros};
 }
 async function a11y(page,onde,foto){
  await page.addScriptTag({content:axe});
  const r=await page.evaluate(async()=>(await axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'],resultTypes:['violations']})).violations
   .map(v=>({id:v.id,impacto:v.impact,ajuda:v.help,alvos:v.nodes.slice(0,3).map(n=>n.target.join(' '))})));
  for(const v of r)if(['serious','critical'].includes(v.impacto))problemas.push({onde,...v});
  const leves=r.filter(v=>!['serious','critical'].includes(v.impacto));if(leves.length)console.log(`    (aviso, ${onde}) `+leves.map(v=>v.id).join(', '));
  if(foto)await page.screenshot({path:path.join(prints,foto+'.png'),fullPage:true});
 }
 const semRolagemLateral=async(page,onde)=>{const w=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(w<=392,`${onde}: rolagem lateral no celular (largura ${w})`);};
 const paginas=['dashboard','equipment','movements','reports','users','archives','audit','about','privacy'];
 try{
  for(const [nome,vp] of [['pc',{width:1366,height:900}],['celular',{width:390,height:844}]]){
   console.log(nome==='pc'?'Computador':'Celular');
   let {ctx,page,erros}=await abrir(vp);
   await page.locator('#loginView').waitFor({state:'visible'});await a11y(page,`${nome} entrada`,`${nome}-entrada`);ok('entrada');
   await ctx.close();
   ({ctx,page,erros}=await abrir(vp,termoUso,'http://inventario.test/?cadastro='+'A'.repeat(43)));
   await page.locator('#registerView').waitFor({state:'visible'});await a11y(page,`${nome} cadastro`,`${nome}-cadastro`);ok('cadastro por convite');
   await ctx.close();
   ({ctx,page,erros}=await abrir(vp,null));
   await page.evaluate(async()=>{await showApp({user:testUser});});await page.locator('#termsUseView').waitFor({state:'visible'});
   await a11y(page,`${nome} termo de uso`,`${nome}-termo-de-uso`);ok('termo de uso');
   await ctx.close();
   ({ctx,page,erros}=await abrir(vp));
   await page.evaluate(async()=>{await showApp({user:testUser});});await page.locator('#appView').waitFor({state:'visible'});
   for(const pg of paginas){
    await page.evaluate(p=>goto(p),pg);await page.locator(`#${pg}Page`).waitFor({state:'visible'});await page.waitForTimeout(250);
    if(nome==='celular')await semRolagemLateral(page,pg);
    await a11y(page,`${nome} ${pg}`,`${nome}-${pg}`);ok(`página ${pg}`);
   }
   await page.evaluate(()=>goto('equipment'));await page.click('#newEquipmentBtn');await page.locator('#equipmentDialog[open]').waitFor();
   await a11y(page,`${nome} janela novo equipamento`,`${nome}-janela-equipamento`);ok('janela de novo equipamento');
   await page.keyboard.press('Escape');
   await page.evaluate(()=>goto('movements'));await page.click('#newMovementBtn');await page.locator('#movementDialog[open]').waitFor();
   await a11y(page,`${nome} janela retirada`,`${nome}-janela-retirada`);ok('janela de retirada');
   await page.keyboard.press('Escape');
   assert.deepEqual(erros,[],'erros de JavaScript: '+erros.join(' | '));ok('nenhum erro de JavaScript');
   await ctx.close();
  }
  if(problemas.length){
   console.error('\nProblemas de acessibilidade (sérios ou críticos):');
   for(const p of problemas)console.error(`  - [${p.onde}] ${p.id} (${p.impacto}): ${p.ajuda} → ${p.alvos.join(' ; ')}`);
   throw new Error(`${problemas.length} problema(s) de acessibilidade`);
  }
  console.log(`Acessibilidade aprovada: ${passos} verificações (computador e celular), sem problemas sérios. Prints em test-results/navegador/.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
