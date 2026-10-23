// Requer jsdom, qrcodejs@1, @napi-rs/canvas, pdf-lib e @pdf-lib/fontkit.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),{createCanvas}=require('@napi-rs/canvas'),PDFLib=require('pdf-lib');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
w.CanvasRenderingContext2D=function(){};
w.HTMLCanvasElement.prototype.getContext=function(type){this.nativeCanvas??=createCanvas(this.width,this.height);return this.nativeCanvas.getContext(type)};
w.HTMLCanvasElement.prototype.toDataURL=function(type){return this.nativeCanvas.toDataURL(type)};
vm.runInContext(fs.readFileSync(require.resolve('qrcodejs/qrcode.js'),'utf8'),dom.getInternalVMContext());
w.PDFLib=PDFLib;w.fontkit=require('@pdf-lib/fontkit');w.eval(fs.readFileSync('termo-fontes.js','utf8'));
let ranges=[];
const all=Array.from({length:501},(_,i)=>({id:`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,tag:`TI-${i+1}`,patrimonio:`PAT-${i+1}`,descricao:i===0?'Descrição com acentuação e palavras longas para testar a quebra de linha de uma etiqueta pequena':'Notebook de teste'}));
const db={from:table=>{assert.equal(table,'equipamentos');let filter;const q={select:()=>q,is:(field,value)=>{assert.equal(field,'ciclo_arquivado_id');assert.equal(value,null);filter=true;return q},order:()=>q,range:async(start,end)=>{assert.ok(filter);ranges.push([start,end]);return{data:all.slice(start,end+1)}}};return q}};
const api=new Function('window','document','QRCode','db','$',fs.readFileSync('qr-etiquetas.js','utf8')+';return {buildQrLabelsPdf,fetchEquipmentForQrLabels};')(w,w.document,w.QRCode,db,id=>w.document.getElementById(id));
(async()=>{
 const rows=await api.fetchEquipmentForQrLabels(()=>false);assert.equal(rows.length,501);assert.deepEqual(ranges,[[0,499],[500,999]]);assert.equal(rows[1].tag,'TI-2');
 await assert.rejects(()=>api.buildQrLabelsPdf([]),/Nenhum equipamento/);
 await assert.rejects(()=>api.buildQrLabelsPdf(rows,()=>{},()=>true),/cancelada/);
 const bytes=await api.buildQrLabelsPdf(rows.slice(0,13));const pdf=await PDFLib.PDFDocument.load(bytes);
 assert.equal(pdf.getPageCount(),2);for(const page of pdf.getPages()){assert.ok(Math.abs(page.getWidth()-595.2756)<.01);assert.ok(Math.abs(page.getHeight()-841.8898)<.01);}
 if(process.env.QR_LABELS_TEST_PDF)fs.writeFileSync(process.env.QR_LABELS_TEST_PDF,bytes);
 const src=fs.readFileSync('app.js','utf8');const matcher=src.slice(src.indexOf('function equipmentFromQr('),src.indexOf('async function stopQrReader('));
 const scan=new Function('state',matcher+';return equipmentFromQr;')({equipment:rows});
 assert.equal(scan(JSON.stringify({id:rows[0].id})).id,rows[0].id);
 dom.window.close();console.log('Etiquetas aprovadas: paginacao completa, A4, 12 por pagina, entrada vazia, cancelamento e compatibilidade do leitor.');
})().catch(e=>{console.error(e);dom.window.close();process.exit(1)});
