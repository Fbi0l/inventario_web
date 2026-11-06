// Padrao de exportacao (1.8.0), sem rede: o mesmo documento sai em CSV, Excel e PDF
// com as mesmas colunas, datas no fuso de Belem, valores numericos e texto que nunca vira formula.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs'),PDFLib=require('pdf-lib'),fontkit=require('@pdf-lib/fontkit');

const window={};new Function('window',fs.readFileSync('exportacoes.js','utf8'))(window);
const fonts={};new Function('window',fs.readFileSync('termo-fontes.js','utf8'))(fonts);
const X=window.InventoryExport;

const columns=[
 {key:'tag',label:'TAG',pdf:5},
 {key:'descricao',label:'Descrição',pdf:14,wrap:true},
 {key:'valor',label:'Valor (R$)',type:'money',pdf:6},
 {key:'data_aquisicao',label:'Data de aquisição',type:'date'},
 {key:'retirada_em',label:'Retirada em',type:'datetime',pdf:7},
 {key:'observacoes',label:'Observações',pdf:12,wrap:true}];
const rows=[
 {tag:'NB-001',descricao:'Notebook Dell Latitude 5440',valor:'4599.9',data_aquisicao:'2026-01-31',retirada_em:'2026-11-06T02:30:00Z',observacoes:'=HYPERLINK("http://x","clique")'},
 {tag:'PJ-002',descricao:'Projetor',valor:null,data_aquisicao:'',retirada_em:null,observacoes:'Texto longo '.repeat(80)+'NUMERODESERIESEMESPACOS'.repeat(6)}];
for(let i=0;i<120;i++)rows.push({tag:`EQ-${i}`,descricao:`Equipamento ${i}`,valor:i,data_aquisicao:'2025-12-01',retirada_em:'2026-03-10T15:05:00Z',observacoes:''});
const doc={subject:'relatório equipamentos',title:'Relatório de equipamentos',sheet:'Equipamentos',columns,rows,issuer:'teste@exemplo.com',filters:[['Situação','Todas']],summary:'Valor total: R$ 1,00'};
const now=new Date('2026-11-06T14:07:00Z');

(async()=>{
 // Formatos de texto (tela, PDF): data sem mudar de dia, hora em Belem (UTC-3), valor com virgula.
 const cells=X.cells(doc);
 assert.deepEqual(cells[0].slice(0,5),['NB-001','Notebook Dell Latitude 5440','4.599,90','31/01/2026','05/11/2026 23:30']);
 assert.deepEqual(cells[1].slice(2,5),['—','—','—']);
 assert.equal(X.fileName(doc,'pdf',now),'inventario_relatorio-equipamentos_2026-11-06_11h07.pdf');

 // CSV: mesmos rotulos; valor numerico com virgula; o escritor de app.js recebe texto ja formatado.
 let csv;await X.save('csv',doc,(h,r,n)=>{csv={h,r,n};});
 assert.deepEqual(csv.h,columns.map(c=>c.label));
 assert.deepEqual(csv.r[0].slice(2,5),['4599,90','31/01/2026','05/11/2026 23:30']);
 assert.match(csv.n,/^inventario_relatorio-equipamentos_\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.csv$/);

 // Excel: cabecalho fixo e com filtro, datas e valores como numeros, formula vira texto.
 const buf=await X.buildXlsx(doc,ExcelJS,now);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buf);
 const ws=wb.getWorksheet('Equipamentos');assert.ok(ws,'aba de dados');
 assert.deepEqual(ws.getRow(1).values.slice(1),columns.map(c=>c.label));
 assert.equal(ws.getRow(1).getCell(1).font.bold,true);
 assert.equal(ws.views[0].state,'frozen');assert.equal(ws.views[0].ySplit,1);
 assert.ok(ws.autoFilter,'filtro no cabecalho');
 assert.equal(ws.rowCount,rows.length+1);
 const r2=ws.getRow(2);
 assert.equal(r2.getCell(3).value,4599.9);assert.equal(r2.getCell(3).numFmt,'#,##0.00');
 assert.equal(r2.getCell(4).value.toISOString(),'2026-01-31T00:00:00.000Z');assert.equal(r2.getCell(4).numFmt,'dd/mm/yyyy');
 assert.equal(r2.getCell(5).value.toISOString(),'2026-11-05T23:30:00.000Z');assert.equal(r2.getCell(5).numFmt,'dd/mm/yyyy hh:mm');
 assert.equal(r2.getCell(6).type,ExcelJS.ValueType.String,'texto com = continua texto');
 assert.equal(r2.getCell(6).formula,undefined);
 assert.equal(ws.getRow(3).getCell(3).value,null);
 const info=wb.getWorksheet('Informações');assert.ok(info,'aba de informacoes');
 const meta=Object.fromEntries(info.getSheetValues().filter(Boolean).map(v=>[v[1],v[2]]));
 assert.equal(meta['Documento'],'Relatório de equipamentos');assert.equal(meta['Emitido por'],'teste@exemplo.com');
 assert.equal(meta['Emitido em'],'06/11/2026 11:07');assert.equal(meta['Registros'],String(rows.length));assert.equal(meta['Situação'],'Todas');
 // O XML gravado nao contem formula.
 const JSZip=require('jszip');const zip=await JSZip.loadAsync(buf);
 const sheetXml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.ok(!/<f>/.test(sheetXml),'nenhuma formula no xlsx');

 // PDF: paisagem A4, varias paginas com cabecalho repetido e numeracao; texto longo nao quebra a geracao.
 const logo=fs.readFileSync('assets/logo-relatorio.png');
 const bytes=await X.buildPdf(doc,{PDFLib,fontkit,regular:fonts.TERMO_FONT_REGULAR,bold:fonts.TERMO_FONT_BOLD,logo},now);
 const pdf=await PDFLib.PDFDocument.load(bytes);
 assert.ok(pdf.getPageCount()>=3,'varias paginas');
 const {width,height}=pdf.getPage(0).getSize();assert.ok(width>height,'paisagem');assert.equal(Math.round(width),842);
 assert.equal(pdf.getTitle(),'Relatório de equipamentos');assert.equal(pdf.getAuthor(),'teste@exemplo.com');
 // Documento vazio tambem gera, com aviso.
 const empty=await X.buildPdf({...doc,rows:[]},{PDFLib,fontkit,regular:fonts.TERMO_FONT_REGULAR,bold:fonts.TERMO_FONT_BOLD,logo:null},now);
 assert.equal((await PDFLib.PDFDocument.load(empty)).getPageCount(),1);

 if(process.env.SALVAR_AMOSTRAS){const dir=process.env.SALVAR_AMOSTRAS;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'amostra.pdf'),bytes);fs.writeFileSync(path.join(dir,'amostra.xlsx'),Buffer.from(buf));}
 console.log(`Exportacoes: CSV, Excel e PDF no mesmo padrao (${pdf.getPageCount()} paginas no PDF de teste).`);
})().catch(e=>{console.error(e);process.exit(1);});
