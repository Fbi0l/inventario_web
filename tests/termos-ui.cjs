// Requer Playwright, pdf-lib e @pdf-lib/fontkit nas dependencias de teste.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const root=process.cwd();const pdf=await require('pdf-lib').PDFDocument.create();pdf.addPage([612,792]);const template=await pdf.save();
 const stub=`window.rpcCalls=[];window.testReturned=false;window.testUser={id:'10000000-0000-0000-0000-000000000001',email:'teste@example.invalid'};
 window.testTerm={id:'20000000-0000-0000-0000-000000000001',retirante:{nome:'Pessoa Teste',cpf:'52998224725',telefone:''},equipamento:{descricao:'Notebook',patrimonio:'PAT-01'},local_acao:'Marituba',retirada_em:'2026-10-23T12:00Z',devolucao_em:'2026-10-23T15:00Z',estado_retirada:'Bom',estado_devolucao:'Bom',ocorrencia_devolucao:'Sem alterações aparentes',conferente:'Conferente Teste'};
 const eq={id:'30000000-0000-0000-0000-000000000001',descricao:'Notebook',situacao:'Disponível',tag:'TI-01',estado:'Bom'};
 const movement=()=>({id:testTerm.id,equipamento_id:eq.id,responsavel:'Pessoa Teste',tipo:'Retirada',retirada_em:'2026-10-23T12:00Z',devolucao_em:testReturned?'2026-10-23T15:00Z':null,termo_versao:1,equipamentos:eq});
 window.supabase={createClient:()=>({storage:{from:bucket=>({download:async name=>({data:new Blob([new Uint8Array(${JSON.stringify(Array.from(template))})],{type:'application/pdf'})})})},auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},functions:{invoke:async(_,{body})=>({data:body.action==='list'?{users:[{id:testUser.id,email:testUser.email,perfil:'administrador',dados_retirante:{nome:'Pessoa Teste',cpf:'52998224725',telefone:''}}]}:{}})},
 from:table=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:table==='equipamentos'?[eq]:table==='movimentacoes'?[movement()]:[]}),maybeSingle:async()=>({data:{perfil:'administrador'}}),then:r=>Promise.resolve({data:table==='equipamentos'?[eq]:table==='movimentacoes'?[movement()]:[]}).then(r)};return q;},
 rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='listar_retirantes')return{data:[{usuario_id:testUser.id,nome:'Pessoa Teste'}]};if(name==='registrar_devolucao_termo')testReturned=true;return{data:name==='obter_termo_equipamento'?testTerm:null};}
 })};`;
 await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('@supabase/'))return route.fulfill({contentType:'text/javascript',body:stub});
   if(url.includes('pdf-lib@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(require.resolve('pdf-lib/dist/pdf-lib.min.js'))});
   if(url.includes('@pdf-lib/fontkit'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(require.resolve('@pdf-lib/fontkit/dist/fontkit.umd.min.js'))});
   if(url.includes('cdn.jsdelivr'))return route.fulfill({contentType:'text/javascript',body:''});
   const pathname=new URL(url).pathname;const file=path.join(root,pathname==='/'?'index.html':pathname);
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
 });
 await page.goto('http://inventario.test/');
 await page.evaluate(async()=>{await showApp({user:testUser});goto('movements');});
 await page.click('#newMovementBtn');await page.waitForFunction(()=>document.querySelector('#movementResponsible option[value^="1000"]'));
 assert.equal(await page.locator('#movementResponsible').evaluate(e=>e.tagName),'SELECT');
 await page.selectOption('#movementEquipment','30000000-0000-0000-0000-000000000001');
 await page.fill('#movementLocation','Marituba');await page.click('#movementForm button[type=submit]');
 await page.waitForFunction(()=>rpcCalls.some(c=>c.name==='registrar_retirada_termo'));
 const out=await page.evaluate(()=>rpcCalls.find(c=>c.name==='registrar_retirada_termo').args);
 assert.equal(out.p_retirante_id,'10000000-0000-0000-0000-000000000001');assert.equal(out.p_responsavel,undefined);
 await page.waitForFunction(()=>!document.querySelector('#movementDialog').open);
 await page.click('[data-action=return]');await page.fill('#returnAt','2026-10-23T13:00');await page.click('#returnForm button[type=submit]');
 await page.waitForFunction(()=>document.querySelector('#termDialog').open&&!document.querySelector('#downloadTermBtn').disabled,{timeout:30000});
 const downloadPromise=page.waitForEvent('download');await page.click('#downloadTermBtn');const dl=await downloadPromise;assert.match(dl.suggestedFilename(),/^termo_.*\.pdf$/);
 const downloadPath=await dl.path();assert.ok(fs.readFileSync(downloadPath).subarray(0,4).equals(Buffer.from('%PDF')));
 await page.click('#termDialog [data-close]');await page.click('[data-term-id]');await page.waitForFunction(()=>!document.querySelector('#downloadTermBtn').disabled);
 await page.click('#termDialog [data-close]');
 await page.evaluate(()=>goto('users'));await page.waitForSelector('[data-user-action=details]');await page.click('[data-user-action=details]');
 assert.equal(await page.inputValue('#borrowerCpf'),'52998224725');await page.fill('#borrowerName','Nome Atualizado');await page.click('#borrowerForm button[type=submit]');
 await page.waitForFunction(()=>!document.querySelector('#borrowerDialog').open);
 await page.evaluate(()=>{state.perfil='consulta';applyPermissions();});assert.equal(await page.locator('[data-page=users]').isVisible(),false);
 await page.evaluate(()=>showLogin());assert.equal(await page.inputValue('#borrowerCpf'),'');assert.equal(await page.evaluate(()=>state.users.length),0);
 assert.deepEqual(errors,[]);await browser.close();console.log('UI mobile aprovada: selecao, retirada, devolucao, download PDF, reemissao, cadastro existente, permissoes e limpeza de dados.');
})().catch(e=>{console.error(e);process.exit(1)});
