// Requer SheetJS 0.20.3 (caminho em SHEETJS_TEST_PATH). Dados sinteticos.
const fs=require('node:fs'),assert=require('node:assert/strict');
const X=require(process.env.SHEETJS_TEST_PATH||'xlsx');
const api=new Function('window','document',fs.readFileSync('importar-planilha.js','utf8')+';return window.InventoryImport;')({}, {addEventListener(){}});
// Constroi apenas uma estrutura de celulas em memoria para testar o parser, sem salvar planilha.
function workbook(rows){const sheet={};for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){const v=rows[r][c];if(v!=null)sheet[X.utils.encode_cell({r,c})]={v,t:typeof v==='number'?'n':'s'};}sheet['!ref']=`A1:${X.utils.encode_cell({r:rows.length-1,c:rows[0].length-1})}`;return {Sheets:{Cadastro:sheet}};}
const book=workbook([['ID','TAG','Patrimônio','Descrição','Nº Série','Estado','Situação','Data Aquisição','Valor'],['INV-0001','TI-001',0,'Notebook de teste','AB-1','Bom','Em uso',46302,'R$ 1.234,56'],['INV-0002','TI-002','00123','Outro equipamento',null,'Bom','Disponível','07/10/2026',null]]);
const rows=api.parseWorkbook(X,book,'Cadastro');assert.equal(rows.length,2);assert.equal(rows[0].item.patrimonio,null);assert.equal(rows[1].item.patrimonio,'00123');assert.equal(rows[0].item.numero_serie,'AB-1');assert.equal(rows[0].item.valor,1234.56);assert.equal(rows[1].item.data_aquisicao,'2026-10-07');
assert.equal(api.prepare(rows,[],'')[0].status,'pending');assert.equal(api.prepare(rows,[],'skip')[0].status,'ignored');assert.equal(api.prepare(rows,[],'available')[0].item.situacao,'Disponível');assert.match(api.prepare(rows,[],'available')[0].item.observacoes,/original Em uso/);
assert.equal(api.prepare(rows,[{tag:'ti-001',patrimonio:''}],'available')[0].status,'duplicate');assert.equal(api.prepare(rows,[{tag:'OUTRA',patrimonio:'123'}],'available')[1].status,'duplicate');
assert.equal(api.prepare([rows[1],rows[1]],[],'skip')[1].status,'duplicate');
assert.throws(()=>api.parseValue(-1));assert.throws(()=>api.parseValue('1.234'));assert.throws(()=>api.parseDate('31/02/2026',X));assert.throws(()=>api.parseWorkbook(X,workbook([['X'],['Y']]),'Cadastro'),/TAG e Descrição/);
book.Sheets.Cadastro.B2.w='000123';book.Sheets.Cadastro.B2.t='n';book.Sheets.Cadastro.B2.v=123;assert.equal(api.parseWorkbook(X,book,'Cadastro')[0].item.tag,'000123');
const exported=workbook([['id','codigo_origem','tag','descricao'],['uuid-ficticio','INV-42','TI-42','Equipamento']]);assert.equal(api.parseWorkbook(X,exported,'Cadastro')[0].item.codigo_origem,'INV-42');
console.log('Parser aprovado: colunas, identificadores, datas, valores, Em uso e duplicidades.');
const app=fs.readFileSync('app.js','utf8');const helper=app.slice(app.indexOf('async function fetchActiveEquipment('),app.indexOf('async function fetchActiveMovements('));
let batches=0;const equipment=Array.from({length:1001},(_,id)=>({id}));
const db={from:()=>{const q={select:()=>q,is:()=>q,order:()=>q,range:async(a,b)=>{batches++;return{data:equipment.slice(a,b+1)}}};return q}};
(async()=>{const fetchAll=new Function('db',helper+';return fetchActiveEquipment;')(db);const result=await fetchAll();assert.equal(result.data.length,1001);assert.equal(batches,3);console.log('Carregamento aprovado: inventario com mais de 1000 equipamentos.');})().catch(e=>{console.error(e);process.exit(1)});

const held=[{item:{linha:2,tag:'H-1',descricao:'Teste',situacao:'Em uso',responsavel:'Pessoa Exemplo'},errors:[]}];
const holders=[{usuario_id:'id1',nome:'Pessoa Exemplo'}];
assert.equal(api.prepare(held,[],'linked',holders)[0].status,'pending');
let out=api.prepare(held,[],'linked',holders,{2:{retirada_em:'2026-01-01T12:00:00Z',local_acao:'Local',avarias_retirada:false}})[0];
assert.equal(out.status,'ready');assert.equal(out.item.retirante_id,'id1');assert.equal(out.item.situacao,'Em uso');
assert.equal(api.prepare(held,[],'linked',[...holders,{usuario_id:'id2',nome:'Pessoa Exemplo'}])[0].item.retirante_id,'');
assert.equal(api.prepare(held,[],'linked',holders,{2:{retirante_id:''}})[0].item.retirante_id,'');
