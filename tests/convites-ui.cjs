// Testa a lista e o cancelamento de convites no Chromium com Supabase simulado. Requer Playwright.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const shots=process.env.AUDIT_SHOTS||'';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[];const root=process.cwd();
 const stub=`window.testUser={id:'10000000-0000-0000-0000-000000000001',email:'admin@example.invalid'};
 window.calls=[];
 window.testInvites=[{id:'c0000000-0000-0000-0000-000000000001',criado_em:'2026-10-28T22:00:00Z',expira_em:'2026-10-30T22:00:00Z',criado_por:testUser.id},
                     {id:'c0000000-0000-0000-0000-000000000002',criado_em:'2026-10-27T10:00:00Z',expira_em:'2026-10-29T10:00:00Z',criado_por:null}];
 window.supabase={createClient:()=>({storage:{from:()=>({download:async()=>({data:null})})},auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},
  functions:{invoke:async(_,{body})=>{calls.push(body);
   if(body.action==='list')return{data:{users:[{id:testUser.id,email:testUser.email,perfil:'administrador',created_at:'2026-10-01T00:00:00Z'}]}};
   if(body.action==='list_invites')return{data:{invites:testInvites}};
   if(body.action==='invite'){testInvites.unshift({id:'c0000000-0000-0000-0000-000000000003',criado_em:new Date().toISOString(),expira_em:new Date(Date.now()+172800000).toISOString(),criado_por:testUser.id});return{data:{token:'A'.repeat(43),id:'c0000000-0000-0000-0000-000000000003'}};}
   if(body.action==='revoke_invite'){testInvites=testInvites.filter(c=>c.id!==body.inviteId);return{data:{message:'ok'}};}
   return{data:{}};}},
  from:()=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:[]}),maybeSingle:async()=>({data:{perfil:'administrador'}}),then:r=>Promise.resolve({data:[]}).then(r)};return q;},
  rpc:async()=>({data:[]})})};`;
 const route=async route=>{
   const url=route.request().url();
   if(url.includes('@supabase/'))return route.fulfill({contentType:'text/javascript',body:stub});
   if(url.includes('cdn.jsdelivr')||url.includes('cdn.sheetjs'))return route.fulfill({contentType:'text/javascript',body:''});
   const pathname=new URL(url).pathname;const file=path.join(root,pathname==='/'?'index.html':pathname);
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
 };
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>errors.push(e.message));
 let dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
 await page.route('**/*',route);await page.goto('http://inventario.test/');
 await page.evaluate(async()=>{await showApp({user:testUser});goto('users');});
 await page.waitForFunction(()=>document.querySelectorAll('#invitesBody [data-invite-cancel]').length===2);
 let text=await page.locator('#invitesBody').innerText();
 assert.ok(text.includes('admin@example.invalid')&&text.includes('Conta excluída'),'mostra quem gerou');
 // Gerar convite: aparece na lista marcado como o link exibido.
 await page.click('#createInvitationBtn');await page.waitForFunction(()=>document.querySelectorAll('#invitesBody [data-invite-cancel]').length===3);
 assert.equal(await page.locator('#invitationResult').isVisible(),true);
 assert.ok((await page.locator('#invitesBody').innerText()).includes('Link exibido acima'));
 if(shots)await page.locator('#usersPage .user-create-box').first().screenshot({path:`${shots}/convites.png`});
 // Cancelar o convite recem-gerado: pede confirmacao, some da lista e esconde o link.
 await page.click('[data-invite-cancel="c0000000-0000-0000-0000-000000000003"]');
 await page.waitForFunction(()=>document.querySelectorAll('#invitesBody [data-invite-cancel]').length===2);
 assert.match(dialogs.at(-1),/deixará de funcionar/);
 assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.action==='revoke_invite')),[{action:'revoke_invite',inviteId:'c0000000-0000-0000-0000-000000000003'}]);
 assert.equal(await page.locator('#invitationResult').isVisible(),false,'link cancelado deixa de ser exibido');
 assert.equal(await page.inputValue('#invitationLink'),'');
 assert.match(await page.locator('#inviteMessage').innerText(),/cancelado/);
 // Cancelar outro convite mantem o link atual escondido e a lista atualizada.
 await page.click('[data-invite-cancel="c0000000-0000-0000-0000-000000000002"]');
 await page.waitForFunction(()=>document.querySelectorAll('#invitesBody [data-invite-cancel]').length===1);
 // Logout limpa a lista.
 await page.evaluate(()=>showLogin());assert.equal(await page.evaluate(()=>state.invites.length),0);assert.equal(await page.locator('#invitesBody tr').count(),0);
 assert.deepEqual(errors,[]);await browser.close();
 console.log('UI de convites aprovada: lista pendentes, gerar, cancelar com confirmacao, ocultar link cancelado e limpar no logout.');
})().catch(e=>{console.error(e);process.exit(1)});
