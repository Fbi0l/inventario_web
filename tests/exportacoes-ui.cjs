// Menu Exportar (1.8.0) no Chromium, com a politica CSP real e as bibliotecas reais de PDF e Excel
// (servidas do node_modules, com a mesma integridade). Supabase simulado. Requer Playwright.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs'),{PDFDocument}=require('pdf-lib');
const shots=process.env.EXPORT_SHOTS||'';
const libs={'pdf-lib@1.17.1/dist/pdf-lib.min.js':'node_modules/pdf-lib/dist/pdf-lib.min.js',
 '@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js':'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js',
 'exceljs@4.4.0/dist/exceljs.min.js':'node_modules/exceljs/dist/exceljs.min.js'};
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const errors=[],root=process.cwd();
 const stub=`window.testUser={id:'10000000-0000-0000-0000-000000000001',email:'admin@example.invalid'};
 window.supabase={createClient:()=>({storage:{from:()=>({download:async()=>({data:null})})},auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signOut:async()=>({})},functions:{invoke:async()=>({data:{users:[]}})},
  from:()=>{const q={select:()=>q,is:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>({data:[]}),maybeSingle:async()=>({data:{perfil:'administrador'}}),then:r=>Promise.resolve({data:[]}).then(r)};return q;},
  rpc:async()=>({data:[]})})};`;
 const route=async route=>{
  const url=route.request().url();
  if(url.includes('@supabase/'))return route.fulfill({contentType:'text/javascript',body:stub});
  const lib=Object.keys(libs).find(k=>url.includes(k));
  if(lib)return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:fs.readFileSync(libs[lib])});
  if(url.includes('cdn.jsdelivr')||url.includes('cdn.sheetjs'))return route.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:''});
  const pathname=new URL(url).pathname;const file=path.join(root,pathname==='/'?'index.html':pathname);
  if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
  const body=file.endsWith('.html')?fs.readFileSync(file,'utf8').replace(/(<script src="[^"]*@supabase\/[^"]*") integrity="[^"]*"/,'$1'):fs.readFileSync(file);
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.woff2')?'font/woff2':'text/html';
  return route.fulfill({contentType:type,body});
 };
 for(const viewport of [{width:1366,height:820},{width:390,height:844}]){
  const page=await browser.newPage({viewport,acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{// Os leitores de QR Code nao fazem parte deste teste e sao trocados por arquivos vazios.
  if(m.type()==='error'&&!/Failed to load resource|qrcode/.test(m.text()))errors.push(m.text());});
  await page.route('**/*',route);await page.goto('http://inventario.test/');
  await page.evaluate(async()=>{
   await showApp({user:testUser});
   state.equipment=[
    {id:'e1',tag:'TI-01',patrimonio:'00123',descricao:'Notebook Dell Latitude',categoria:'Informática',marca:'Dell',modelo:'5440',numero_serie:'ABC123',pertencimento:'TI',responsavel:'Ana',localizacao:'Sala 2',estado:'Bom',situacao:'Em uso',valor:'4599.90',data_aquisicao:'2026-01-31',codigo_origem:'77',observacoes:'=1+1',created_at:'2026-10-01T12:00:00Z'},
    {id:'e2',tag:'TI-02',patrimonio:'',descricao:'Projetor',categoria:'Audiovisual',situacao:'Disponível',valor:null,created_at:'2026-10-02T12:00:00Z'}];
   state.movements=[{id:'m1',equipamento_id:'e1',tipo:'Retirada',responsavel:'Ana',destino:'Auditório',retirada_em:'2026-11-05T13:00:00Z',previsao_devolucao:'2026-11-05T20:00:00Z',created_at:'2026-11-05T13:00:00Z'}];
  });
  const go=async p=>{if(await page.locator('#navMoreBtn').isVisible())await page.click('#navMoreBtn');await page.click(`[data-page=${p}]`);};
  await go('reports');await page.evaluate(()=>renderReport());
  // A previa usa as mesmas colunas da exportacao.
  const head=await page.locator('#reportHead').textContent();
  for(const s of ['Número de série','Valor (R$)','Data de aquisição','Código de origem'])assert.ok(head.includes(s),'previa com coluna '+s);
  assert.ok((await page.locator('#reportBody').innerText()).includes('4.599,90'));
  assert.ok((await page.locator('#reportSummary').innerText()).includes('Valor total: R$ 4.599,90'));
  // Menu: abre, fecha com Esc e devolve o foco ao botao.
  await page.click('#exportReportBtn');
  assert.equal(await page.getAttribute('#exportReportBtn','aria-expanded'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.format),'pdf','foco no primeiro formato');
  if(shots)await page.screenshot({path:`${shots}/menu-${viewport.width}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#exportReportBtnOptions').isHidden(),true);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'exportReportBtn');
  const pick=async(btn,format)=>{await page.click('#'+btn);const dl=page.waitForEvent('download');await page.click(`#${btn}Options [data-format=${format}]`);const f=await dl;return {name:f.suggestedFilename(),data:fs.readFileSync(await f.path())};};
  // PDF do relatorio
  let f=await pick('exportReportBtn','pdf');
  assert.match(f.name,/^inventario_relatorio-equipamentos_\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.pdf$/);
  const pdf=await PDFDocument.load(f.data);assert.equal(pdf.getTitle(),'Relatório de equipamentos');assert.equal(pdf.getAuthor(),'admin@example.invalid');
  if(shots&&viewport.width>1000)fs.writeFileSync(`${shots}/relatorio.pdf`,f.data);
  // Excel do relatorio de movimentacoes (ExcelJS carregada sob demanda, com integridade)
  await page.selectOption('#reportType','movements');await page.evaluate(()=>renderReport());
  assert.ok((await page.locator('#reportBody').innerText()).includes('Atrasada'),'situacao calculada');
  f=await pick('exportReportBtn','xlsx');
  assert.match(f.name,/^inventario_relatorio-movimentacoes_.*\.xlsx$/);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(f.data);const ws=wb.getWorksheet('Movimentações');
  assert.equal(ws.getRow(2).getCell(3).value,'Notebook Dell Latitude');assert.equal(ws.getRow(2).getCell(5).value,'Atrasada');
  assert.equal(ws.getRow(2).getCell(8).value.toISOString(),'2026-11-05T10:00:00.000Z','retirada no horario de Belem');
  if(shots&&viewport.width>1000)fs.writeFileSync(`${shots}/movimentacoes.xlsx`,f.data);
  // CSV do cadastro: rotulos legiveis, sem id interno, formula neutralizada
  await go('equipment');
  f=await pick('exportBtn','csv');
  assert.match(f.name,/^inventario_cadastro-equipamentos_.*\.csv$/);
  const csv=f.data.toString('utf8');
  assert.ok(csv.startsWith('﻿"TAG";"Patrimônio";"Descrição"'),'cabecalho legivel');
  assert.ok(!/"e1"/.test(csv),'sem id interno');assert.ok(csv.includes('"\'=1+1"'),'formula neutralizada');assert.ok(csv.includes('"4599,90"'));
  assert.ok((await page.locator('#globalMessage').innerText()).includes('Arquivo gerado'));
  if(shots)await page.screenshot({path:`${shots}/equipamentos-${viewport.width}.png`});
  await page.close();
 }
 assert.deepEqual(errors,[]);await browser.close();
 console.log('Menu Exportar aprovado: previa igual a exportacao, PDF, Excel e CSV gerados sob a CSP real, teclado e celular.');
})().catch(e=>{console.error(e);process.exit(1)});
