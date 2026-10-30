// Testa a tela de auditoria no Chromium com Supabase simulado. Requer Playwright.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const shots=process.env.AUDIT_SHOTS||'';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];const root=process.cwd();
 const stub=`window.testUser={id:'10000000-0000-0000-0000-000000000001',email:'admin@example.invalid'};
 window.testAuditRows=[
  {id:6,ocorrido_em:'2026-10-28T23:40:00Z',autor_email:'admin@example.invalid',acao:'alterou',entidade:'equipamento',entidade_id:'e1',descricao:'TI-01 — Notebook 14',detalhes:{alteracoes:{descricao:{antes:'Notebook',depois:'Notebook 14'},localizacao:{antes:null,depois:'Sala 2'}}}},
  {id:5,ocorrido_em:'2026-10-28T23:30:00Z',autor_email:'admin@example.invalid',acao:'alterou_perfil',entidade:'usuario',entidade_id:'u2',descricao:'pessoa@example.invalid',detalhes:{antes:'consulta',depois:'operador'}},
  {id:4,ocorrido_em:'2026-10-28T23:20:00Z',autor_email:'pessoa@example.invalid',acao:'cadastrou_por_convite',entidade:'usuario',entidade_id:'u2',descricao:'pessoa@example.invalid',detalhes:{perfil:'consulta'}},
  {id:3,ocorrido_em:'2026-10-28T23:10:00Z',autor_email:'admin@example.invalid',acao:'gerou_convite',entidade:'convite',entidade_id:null,descricao:'Convite de cadastro válido por 48 horas',detalhes:{}},
  {id:2,ocorrido_em:'2026-10-28T22:00:00Z',autor_email:null,acao:'arquivou',entidade:'ciclo',entidade_id:'c1',descricao:'Inventário de outubro',detalhes:{equipamentos:12,movimentacoes:30}},
  {id:1,ocorrido_em:'2026-10-28T21:00:00Z',autor_email:'admin@example.invalid',acao:'excluiu',entidade:'equipamento',entidade_id:'e9',descricao:'<img src=x onerror=window.xss=1>',detalhes:{registro:{}}}];
 window.supabase={createClient:()=>({storage:{from:()=>({download:async()=>({data:null})})},auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},functions:{invoke:async()=>({data:{users:[]}})},
  from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:[]}),maybeSingle:async()=>({data:{perfil:'administrador'}}),then:r=>Promise.resolve({data:table==='auditoria'?testAuditRows:[]}).then(r)};return q;},
  rpc:async()=>({data:[]})})};`;
 const route=async route=>{
   const url=route.request().url();
   if(url.includes('@supabase/'))return route.fulfill({contentType:'text/javascript',body:stub});
   if(url.includes('cdn.jsdelivr')||url.includes('cdn.sheetjs'))return route.fulfill({contentType:'text/javascript',body:''});
   const pathname=new URL(url).pathname;const file=path.join(root,pathname==='/'?'index.html':pathname);
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   // O teste troca a biblioteca do Supabase por um simulador; so a integridade (SRI) dessa tag e removida.
   const body=file.endsWith('.html')?fs.readFileSync(file,'utf8').replace(/(<script src="[^"]*@supabase\/[^"]*") integrity="[^"]*"/,'$1'):fs.readFileSync(file);
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body});
 };
 for(const viewport of [{width:1366,height:820},{width:390,height:844}]){
  const page=await browser.newPage({viewport,acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route);await page.goto('http://inventario.test/');
  await page.evaluate(async()=>{await showApp({user:testUser});});
  assert.equal(await page.locator('[data-page=audit]').isVisible(),true,'administrador ve o menu Auditoria');
  await page.click('[data-page=audit]');await page.waitForFunction(()=>document.querySelectorAll('#auditBody tr').length===6);
  const text=await page.locator('#auditBody').innerText();
  for(const s of ['Descrição: Notebook → Notebook 14','Localização: vazio → Sala 2','Consulta → Operador','Cadastro por convite','Gerou convite','12 equipamento(s), 30 movimentação(ões)','Conta excluída'])assert.ok(text.includes(s),'mostra: '+s);
  assert.equal(await page.evaluate(()=>window.xss),undefined,'texto do banco e escapado');
  assert.equal(await page.locator('#pageTitle').innerText(),'Auditoria');
  if(shots)await page.screenshot({path:`${shots}/auditoria-${viewport.width}.png`,fullPage:true});
  await page.fill('#searchAudit','perfil');assert.equal(await page.locator('#auditBody tr').count(),1);
  await page.fill('#searchAudit','');await page.selectOption('#auditEntityFilter','usuario');assert.equal(await page.locator('#auditBody tr').count(),2);
  const dl=page.waitForEvent('download');await page.click('#exportAuditBtn');const file=await dl;assert.match(file.suggestedFilename(),/^auditoria_.*\.csv$/);
  const csv=fs.readFileSync(await file.path(),'utf8');assert.ok(csv.includes('Alterou perfil')&&csv.split('\r\n').length===3,'CSV com os registros filtrados');
  await page.evaluate(()=>{state.perfil='operador';applyPermissions();});
  assert.equal(await page.locator('[data-page=audit]').isVisible(),false,'operador nao ve Auditoria');
  assert.equal(await page.locator('#auditPage').isVisible(),false,'pagina fecha ao perder permissao');
  await page.evaluate(()=>showLogin());assert.equal(await page.evaluate(()=>state.audit.length),0,'logout limpa os registros');
  await page.close();
 }
 assert.deepEqual(errors,[]);await browser.close();
 console.log('UI de auditoria aprovada: menu so para administrador, registros legiveis, filtros, CSV, escape de HTML e limpeza no logout (desktop e celular).');
})().catch(e=>{console.error(e);process.exit(1)});
