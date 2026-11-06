/* Padrão único de exportação (1.8.0).
   Relatórios, cadastro, auditoria e arquivos saem com as mesmas colunas, datas, valores e nomes
   de arquivo, em PDF, Excel (.xlsx) ou CSV. Tudo é gerado no próprio aparelho: nenhum dado
   é enviado a outro serviço. As colunas de cada documento são definidas em app.js. */
'use strict';
window.InventoryExport=(()=>{
 const TZ='America/Belem';
 const BRAND={name:'Inventário',tagline:'Gestão de equipamentos'};
 const EXCELJS={src:'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',integrity:'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz'};
 const LOGO='assets/logo-relatorio.png?v=1.8.0';
 const pad=n=>String(n).padStart(2,'0');

 /* ---------- Valores: um formato só para tela, CSV, Excel e PDF ---------- */
 let clock;
 // Data e hora no fuso de Belém, o mesmo dos termos, em qualquer aparelho.
 function wall(value){
  if(value==null||value==='')return null;
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  clock??=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const p=Object.fromEntries(clock.formatToParts(d).map(x=>[x.type,x.value]));
  return {y:+p.year,m:+p.month,d:+p.day,h:+p.hour%24,mi:+p.minute};
 }
 // Datas sem hora (AAAA-MM-DD) ficam no mesmo dia, sem ajuste de fuso.
 function day(value){
  if(value==null||value==='')return null;
  const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?{y:+m[1],m:+m[2],d:+m[3],h:0,mi:0}:wall(value);
 }
 const dateText=p=>p?`${pad(p.d)}/${pad(p.m)}/${p.y}`:'';
 const dateTimeText=p=>p?`${dateText(p)} ${pad(p.h)}:${pad(p.mi)}`:'';
 const toNumber=v=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
 const moneyText=n=>n==null?'':n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 function value(col,row){
  const v=col.get?col.get(row):row[col.key];
  if(col.type==='datetime')return wall(v);
  if(col.type==='date')return day(v);
  if(col.type==='money')return toNumber(v);
  return v==null?'':String(v);
 }
 function text(col,v){
  if(col.type==='datetime')return dateTimeText(v);
  if(col.type==='date')return dateText(v);
  if(col.type==='money')return moneyText(v);
  return v;
 }
 // CSV: valor com vírgula decimal e sem separador de milhar, que o Excel em português lê como número.
 const csvText=(col,v)=>col.type==='money'?(v==null?'':v.toFixed(2).replace('.',',')):text(col,v);
 const values=doc=>doc.rows.map(r=>doc.columns.map(c=>value(c,r)));
 const cells=(doc,empty='—')=>values(doc).map(r=>r.map((v,i)=>text(doc.columns[i],v)||empty));
 const slug=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'dados';
 function fileName(doc,ext,now=new Date()){
  const p=wall(now);
  return `inventario_${slug(doc.subject)}_${p.y}-${pad(p.m)}-${pad(p.d)}_${pad(p.h)}h${pad(p.mi)}.${ext}`;
 }
 const details=(doc,now)=>[['Documento',doc.title],...(doc.filters||[]),...(doc.summary?[['Resumo',doc.summary]]:[]),['Registros',String(doc.rows.length)],['Emitido em',dateTimeText(wall(now))],['Emitido por',doc.issuer||'—'],['Sistema',`${BRAND.name} — ${BRAND.tagline}`]];

 /* ---------- Excel ---------- */
 const sheetName=s=>String(s||'Dados').replace(/[\[\]:*?/\\]/g,' ').slice(0,31).trim()||'Dados';
 async function buildXlsx(doc,ExcelJS,now=new Date()){
  const wb=new ExcelJS.Workbook();
  wb.creator=doc.issuer||BRAND.name;wb.lastModifiedBy=wb.creator;wb.title=doc.title;wb.company=BRAND.name;wb.created=now;wb.modified=now;
  const ws=wb.addWorksheet(sheetName(doc.sheet||doc.title),{views:[{state:'frozen',ySplit:1}]});
  const formats={datetime:'dd/mm/yyyy hh:mm',date:'dd/mm/yyyy',money:'#,##0.00'};
  ws.columns=doc.columns.map(c=>({header:c.label,key:c.key,width:c.width||Math.max(12,c.label.length+3)}));
  for(const row of values(doc)){
   ws.addRow(row.map((v,i)=>{
    const c=doc.columns[i];
    if(c.type==='datetime'||c.type==='date')return v?new Date(Date.UTC(v.y,v.m-1,v.d,v.h,v.mi)):null;
    if(c.type==='money')return v;
    return v===''?null:v; // texto entra como texto: nunca vira fórmula
   }));
  }
  doc.columns.forEach((c,i)=>{
   const col=ws.getColumn(i+1);
   if(formats[c.type])col.numFmt=formats[c.type];
   col.alignment={vertical:'top',wrapText:!!c.wrap,horizontal:c.type==='money'?'right':undefined};
  });
  const head=ws.getRow(1);head.height=22;
  head.eachCell(cell=>{
   cell.font={bold:true,color:{argb:'FFFFFFFF'}};
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF14243A'}};
   cell.alignment={vertical:'middle',wrapText:true};
   cell.numFmt='@';
  });
  if(doc.columns.length)ws.autoFilter={from:{row:1,column:1},to:{row:1,column:doc.columns.length}};
  const about=wb.addWorksheet('Informações');
  about.columns=[{width:18},{width:90}];
  details(doc,now).forEach(([k,v])=>{const r=about.addRow([k,v]);r.getCell(1).font={bold:true};r.getCell(2).alignment={wrapText:true,vertical:'top'};});
  return wb.xlsx.writeBuffer();
 }

 /* ---------- PDF ---------- */
 async function buildPdf(doc,{PDFLib,fontkit,regular,bold,logo},now=new Date()){
  const {PDFDocument,rgb}=PDFLib;
  const pdf=await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(doc.title);pdf.setAuthor(doc.issuer||BRAND.name);pdf.setCreator(BRAND.name);pdf.setProducer(BRAND.name);pdf.setCreationDate(now);pdf.setLanguage('pt-BR');
  const F=await pdf.embedFont(regular,{subset:true}),B=await pdf.embedFont(bold,{subset:true});
  let img=null;try{if(logo)img=await pdf.embedPng(logo);}catch{img=null;}
  const W=841.89,H=595.28,M=32,FOOT=26,FS=7.2,LH=9,PAD=4,MAXLINES=14;
  const C={ink:rgb(.09,.13,.2),muted:rgb(.36,.42,.5),line:rgb(.85,.88,.92),head:rgb(.078,.141,.227),zebra:rgb(.965,.973,.988),accent:rgb(.153,.392,.906),white:rgb(1,1,1)};
  const known=new Map();
  const clean=(f,s)=>Array.from(String(s??'')).map(ch=>{
   if(ch==='\n')return ch;if(ch==='\t')return ' ';
   const k=(f===B?'b':'r')+ch;
   if(!known.has(k)){try{f.encodeText(ch);known.set(k,true);}catch{known.set(k,false);}}
   return known.get(k)?ch:'?';
  }).join('');
  const width=(s,f,size)=>f.widthOfTextAtSize(s,size);
  // Quebra o texto na largura da coluna; palavras longas (números de série, e-mails) também quebram.
  function wrap(s,f,size,max,limit=MAXLINES){
   const out=[];
   for(const para of clean(f,s).split('\n')){
    let line='';
    for(const word of para.split(/\s+/).filter(Boolean)){
     let w=word;
     while(width(w,f,size)>max){
      let n=w.length-1;while(n>1&&width(w.slice(0,n),f,size)>max)n--;
      if(line){out.push(line);line='';}
      out.push(w.slice(0,n));w=w.slice(n);
     }
     const tryLine=line?line+' '+w:w;
     if(width(tryLine,f,size)<=max)line=tryLine;else{out.push(line);line=w;}
    }
    out.push(line);
   }
   if(out.length>limit){out.length=limit;let last=out[limit-1];while(last&&width(last+'…',f,size)>max)last=last.slice(0,-1);out[limit-1]=last+'…';}
   return out.length?out:[''];
  }
  const right=(page,s,f,size,xRight,y,color)=>{const t=clean(f,s);page.drawText(t,{x:xRight-width(t,f,size),y,size,font:f,color});};

  const cols=doc.columns.filter(c=>c.pdf);
  const avail=W-2*M,sum=cols.reduce((s,c)=>s+c.pdf,0)||1;
  const idx=cols.map(c=>doc.columns.indexOf(c));
  const rows=cells(doc);
  // Largura: o peso de cada coluna, mas nunca menor que a maior palavra dela (até um limite),
  // para "Patrimônio", "Disponível" ou uma data não quebrarem no meio.
  const longest=(s,f,size)=>clean(f,s).split(/\s+/).reduce((m,w)=>Math.max(m,width(w,f,size)),0);
  const minW=cols.map((c,i)=>{
   let m=longest(c.label,B,6.8);
   for(const r of rows){m=Math.max(m,longest(r[idx[i]],F,FS));if(m>=avail*.18)break;}
   return Math.min(m,avail*.18)+2*PAD+1;
  });
  let widths=cols.map((c,i)=>Math.max(minW[i],c.pdf/sum*avail));
  const over=widths.reduce((s,w)=>s+w,0)-avail;
  if(over>0){
   const spare=widths.map((w,i)=>w-minW[i]),total=spare.reduce((s,w)=>s+w,0);
   const minSum=minW.reduce((s,w)=>s+w,0);
   widths=total>=over?widths.map((w,i)=>w-spare[i]/total*over):minW.map(w=>w*avail/minSum);
  }
  const issued=dateTimeText(wall(now));
  let page,y;

  function header(first){
   page=pdf.addPage([W,H]);y=H-M;
   const logoSize=first?28:20;
   if(img)page.drawImage(img,{x:M,y:y-logoSize,width:logoSize,height:logoSize});
   const tx=M+(img?logoSize+8:0);
   if(first){
    page.drawText(BRAND.name,{x:tx,y:y-12,size:12,font:B,color:C.ink});
    page.drawText(BRAND.tagline,{x:tx,y:y-24,size:7.5,font:F,color:C.muted});
    right(page,`Emitido em ${issued}`,F,7.5,W-M,y-12,C.muted);
    right(page,doc.issuer?`por ${doc.issuer}`:'',F,7.5,W-M,y-24,C.muted);
    y-=36;
    page.drawRectangle({x:M,y,width:avail,height:1.5,color:C.accent});
    y-=22;
    page.drawText(clean(B,doc.title),{x:M,y,size:15,font:B,color:C.ink});
    y-=14;
    const filters=(doc.filters||[]).map(([k,v])=>`${k}: ${v}`).join('   ·   ');
    for(const l of wrap(filters,F,8,avail,4)){if(l){page.drawText(l,{x:M,y,size:8,font:F,color:C.muted});y-=11;}}
    const summary=[`${doc.rows.length} registro${doc.rows.length===1?'':'s'}`,doc.summary].filter(Boolean).join('   ·   ');
    page.drawText(clean(B,summary),{x:M,y,size:8,font:B,color:C.ink});
    y-=14;
   }else{
    page.drawText(clean(B,doc.title),{x:tx,y:y-9,size:10,font:B,color:C.ink});
    page.drawText('continuação',{x:tx,y:y-19,size:7,font:F,color:C.muted});
    right(page,`Emitido em ${issued}`,F,7,W-M,y-9,C.muted);
    y-=logoSize+8;
   }
   tableHead();
  }
  function tableHead(){
   const lines=cols.map((c,i)=>wrap(c.label,B,6.8,widths[i]-2*PAD,3));
   const h=Math.max(...lines.map(l=>l.length))*8.5+2*PAD;
   page.drawRectangle({x:M,y:y-h,width:avail,height:h,color:C.head});
   let x=M;
   lines.forEach((ls,i)=>{
    ls.forEach((l,j)=>{const ty=y-PAD-6.8-j*8.5;if(cols[i].type==='money')right(page,l,B,6.8,x+widths[i]-PAD,ty,C.white);else page.drawText(l,{x:x+PAD,y:ty,size:6.8,font:B,color:C.white});});
    x+=widths[i];
   });
   y-=h;
  }

  header(true);
  if(!rows.length){
   y-=24;page.drawText('Nenhum registro para os filtros aplicados.',{x:M+PAD,y,size:9,font:F,color:C.muted});
  }
  rows.forEach((row,r)=>{
   const lines=idx.map((k,i)=>wrap(row[k],F,FS,widths[i]-2*PAD));
   const h=Math.max(...lines.map(l=>l.length))*LH+2*PAD;
   if(y-h<M+FOOT)header(false);
   if(r%2)page.drawRectangle({x:M,y:y-h,width:avail,height:h,color:C.zebra});
   let x=M;
   lines.forEach((ls,i)=>{
    ls.forEach((l,j)=>{const ty=y-PAD-FS-j*LH+1;if(cols[i].type==='money')right(page,l,F,FS,x+widths[i]-PAD,ty,C.ink);else page.drawText(l,{x:x+PAD,y:ty,size:FS,font:F,color:C.ink});});
    x+=widths[i];
   });
   y-=h;
   page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.5,color:C.line});
  });

  const pages=pdf.getPages();
  pages.forEach((p,i)=>{
   p.drawLine({start:{x:M,y:M+12},end:{x:W-M,y:M+12},thickness:.5,color:C.line});
   p.drawText(clean(F,`${BRAND.name} · ${doc.title}`),{x:M,y:M,size:7,font:F,color:C.muted});
   right(p,`Página ${i+1} de ${pages.length}`,F,7,W-M,M,C.muted);
  });
  return pdf.save();
 }

 /* ---------- No navegador ---------- */
 function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 let excelPromise,logoPromise;
 function loadExcel(){
  if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
  if(!excelPromise)excelPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=EXCELJS.src;script.integrity=EXCELJS.integrity;script.crossOrigin='anonymous';
   script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(Error('Gerador de planilha indisponível.'));
   script.onerror=()=>{script.remove();reject(Error('Não foi possível carregar o gerador de planilha. Confira sua conexão e tente novamente.'));};
   document.head.appendChild(script);
  }).catch(e=>{excelPromise=null;throw e;});
  return excelPromise;
 }
 function loadLogo(){
  logoPromise??=fetch(LOGO).then(r=>r.ok?r.arrayBuffer():null).catch(()=>null);
  return logoPromise;
 }
 // Gera e baixa o arquivo; o CSV usa o escritor de app.js, que neutraliza fórmulas.
 async function save(format,doc,writeCsv){
  const now=new Date();
  if(format==='csv'){
   const name=fileName(doc,'csv',now);
   writeCsv(doc.columns.map(c=>c.label),values(doc).map(r=>r.map((v,i)=>csvText(doc.columns[i],v))),name);
   return name;
  }
  if(format==='xlsx'){
   const X=await loadExcel(),name=fileName(doc,'xlsx',now);
   download(new Blob([await buildXlsx(doc,X,now)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name);
   return name;
  }
  if(format==='pdf'){
   if(!window.PDFLib||!window.fontkit||!window.TERMO_FONT_REGULAR||!window.TERMO_FONT_BOLD)throw Error('Não foi possível carregar o gerador PDF. Atualize a página e tente novamente.');
   const name=fileName(doc,'pdf',now);
   const bytes=await buildPdf(doc,{PDFLib:window.PDFLib,fontkit:window.fontkit,regular:window.TERMO_FONT_REGULAR,bold:window.TERMO_FONT_BOLD,logo:await loadLogo()},now);
   download(new Blob([bytes],{type:'application/pdf'}),name);
   return name;
  }
  throw Error('Formato de arquivo desconhecido.');
 }

 /* ---------- Menu Exportar (PDF, Excel, CSV) ---------- */
 function bindMenus(onPick){
  const menus=[...document.querySelectorAll('.export-menu')];
  const close=(m,focus)=>{const t=m.querySelector('.export-toggle');m.querySelector('.export-options').hidden=true;t.setAttribute('aria-expanded','false');if(focus)t.focus();};
  menus.forEach(m=>{
   const toggle=m.querySelector('.export-toggle'),list=m.querySelector('.export-options'),items=[...list.querySelectorAll('[data-format]')];
   toggle.addEventListener('click',()=>{
    const open=list.hidden;menus.forEach(o=>o!==m&&close(o));
    list.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(open)items[0]?.focus();
   });
   list.addEventListener('keydown',e=>{
    const i=items.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();close(m,true);}
    else if(e.key==='ArrowDown'){e.preventDefault();items[(i+1)%items.length].focus();}
    else if(e.key==='ArrowUp'){e.preventDefault();items[(i-1+items.length)%items.length].focus();}
    else if(e.key==='Tab')close(m);
   });
   items.forEach(b=>b.addEventListener('click',async()=>{
    close(m,true);
    const label=toggle.querySelector('span'),before=label.textContent;
    toggle.disabled=true;label.textContent='Gerando…';
    try{await onPick(m.dataset.export,b.dataset.format);}
    finally{toggle.disabled=false;label.textContent=before;}
   }));
  });
  document.addEventListener('click',e=>menus.forEach(m=>{if(!m.contains(e.target))close(m);}));
 }

 return {save,bindMenus,cells,fileName,buildXlsx,buildPdf,dateTime:v=>dateTimeText(wall(v)),date:v=>dateText(day(v)),money:v=>moneyText(toNumber(v))};
})();
