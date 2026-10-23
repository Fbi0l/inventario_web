/* Leitura local de planilhas; macros nao sao executadas. */
window.InventoryImport=(()=>{
 const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const pat=v=>{const s=String(v??'').trim().toUpperCase();return !s||/^0+$/.test(s)?'':/^\d+$/.test(s)?s.replace(/^0+/,''):s;};
 const aliases={codigo_origem:['id','codigo origem','codigo de origem'],tag:['tag'],patrimonio:['patrimonio'],descricao:['descricao','equipamento','descricao equipamento'],categoria:['categoria'],marca:['marca'],modelo:['modelo'],numero_serie:['n serie','nº serie','numero serie','numero de serie'],pertencimento:['pertencimento','setor'],responsavel:['responsavel','responsavel habitual'],localizacao:['localizacao','local'],estado:['estado','estado de conservacao'],situacao:['situacao','status'],data_aquisicao:['data aquisicao','data de aquisicao'],valor:['valor','valor rs'],observacoes:['observacoes','observacao']};
 const limits={tag:80,patrimonio:100,descricao:200,categoria:100,marca:100,modelo:100,numero_serie:150,pertencimento:120,responsavel:150,localizacao:150,observacoes:2000,codigo_origem:80};
 const iso=(y,m,d)=>{if(y<1900||y>2100)return null;const dt=new Date(Date.UTC(y,m-1,d));return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;};
 function parseDate(value,X){
  if(value==null||value==='')return null;
  if(typeof value==='number'){const d=X.SSF.parse_date_code(value);if(!d)throw Error('Data de aquisição inválida');const s=iso(d.y,d.m,d.d);if(!s)throw Error('Data de aquisição inválida');return s;}
  const s=String(value).trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/),out;
  if(m)out=iso(+m[1],+m[2],+m[3]);else{m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)out=iso(+m[3],+m[2],+m[1]);}
  if(!out)throw Error('Data de aquisição inválida');return out;
 }
 function parseValue(value){
  if(value==null||String(value).trim()==='')return null;
  let s=String(value).trim().replace(/R\$|\s/g,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  if(!/^\d+(?:\.\d+)?$/.test(s))throw Error('Valor inválido');const n=Number(s);if(!Number.isFinite(n)||n>9999999999.99||Math.abs(n*100-Math.round(n*100))>0.0001)throw Error('Valor inválido');return n;
 }
 function parseWorkbook(X,book,name){
  const sheet=book.Sheets[name];if(!sheet)throw Error('Selecione uma aba.');
  const full=sheet['!fullref']||sheet['!ref'];if(!full)return[];
  if(X.utils.decode_range(full).e.r>2021)throw Error('A aba excede 2000 registros. Separe em arquivos menores.');
  const grid=X.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:true});let header=-1,map={};
  for(let r=0;r<Math.min(grid.length,20);r++){
   const found={};grid[r].forEach((v,c)=>{for(const [field,names]of Object.entries(aliases))if(names.some(a=>normalize(a)===normalize(v))){if(found[field]!==undefined){if(field==='codigo_origem'&&(normalize(v)==='id'||normalize(grid[r][found[field]])==='id')){if(normalize(v)==='id')continue;}else throw Error('Coluna repetida no cabeçalho: '+field);}found[field]=c;}});
   if(found.tag!==undefined&&found.descricao!==undefined){header=r;map=found;break;}
  }
  if(header<0)throw Error('Não encontrei o cabeçalho. A aba precisa das colunas TAG e Descrição.');
  const rows=[];
  for(let r=header+1;r<grid.length;r++){
   if(!grid[r].some(v=>v!==null&&String(v).trim()!==''))continue;
   const item={linha:r+1},errors=[];
   for(const [field,c]of Object.entries(map)){
    const cell=sheet[X.utils.encode_cell({r,c})];let value=cell?.v;
    if(cell?.f&&value==null)errors.push('Fórmula sem resultado em '+field);
    if(['tag','patrimonio','codigo_origem','numero_serie'].includes(field)&&cell?.t==='n'&&cell.w)value=cell.w;
    try{item[field]=field==='data_aquisicao'?parseDate(value,X):field==='valor'?parseValue(value):String(value??'').trim();}catch(e){errors.push(e.message);}
   }
   if(!pat(item.patrimonio))item.patrimonio=null;
   const estates={bom:'Bom',regular:'Regular',ruim:'Ruim',inoperante:'Inoperante'};
   const statuses={disponivel:'Disponível',emuso:'Em uso',manutencao:'Manutenção',baixado:'Baixado'};
   item.estado=estates[normalize(item.estado||'Bom')]||item.estado;
   item.situacao=statuses[normalize(item.situacao||'Disponível')]||item.situacao;
   if(!item.tag||!item.descricao)errors.push('TAG e descrição são obrigatórias');
   if(!Object.values(estates).includes(item.estado))errors.push('Estado não aceito pelo sistema');
   if(!Object.values(statuses).includes(item.situacao))errors.push('Situação não aceita pelo sistema');
   for(const [field,max]of Object.entries(limits))if(String(item[field]??'').length>max)errors.push(field+' excede '+max+' caracteres');
   rows.push({item,errors});
  }
  if(rows.length>2000)throw Error('Importe até 2000 equipamentos por vez.');return rows;
 }
 function prepare(rows,existing,policy){
  const tags=new Set(existing.map(e=>String(e.tag||'').trim().toUpperCase()).filter(Boolean));
  const assets=new Set(existing.map(e=>pat(e.patrimonio)).filter(Boolean));
  return rows.map(row=>{
   const item={...row.item},errors=[...row.errors];let status='ready',reason='Pronto para importar';
   if(item.situacao==='Em uso'){
    if(policy==='available'){
     item.situacao='Disponível';item.observacoes=[item.observacoes,'[Importação: situação original Em uso. Registrar a retirada no sistema.]'].filter(Boolean).join('\n');
     if(item.observacoes.length>2000)errors.push('Observações excedem 2000 caracteres após registrar a situação original');
     reason='Será importado como Disponível; registre a retirada depois';
    }else if(policy==='skip'){status='ignored';reason='Em uso: não importar, conforme escolha';}
    else{status='pending';reason='Escolha como tratar os equipamentos Em uso';}
   }
   if(errors.length){status='invalid';reason=errors.join('; ');}
   const tag=String(item.tag||'').trim().toUpperCase(),asset=pat(item.patrimonio);
   if(['ready','pending'].includes(status)&&(tags.has(tag)||(asset&&assets.has(asset)))){status='duplicate';reason='TAG ou patrimônio repetido no arquivo/ciclo ativo';}
   if(['ready','pending'].includes(status)){tags.add(tag);if(asset)assets.add(asset);}
   return {item,status,reason};
  });
 }
 return {normalize,pat,parseDate,parseValue,parseWorkbook,prepare};
})();
let importBook=null,importRows=[],importPrepared=[],importExisting=[],importLot=null,importBusy=false,importReadId=0,importSuccess=false;
let sheetJsPromise;
function loadSheetJs(){
 if(window.XLSX)return Promise.resolve(window.XLSX);
 if(!sheetJsPromise)sheetJsPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  script.onload=()=>window.XLSX?resolve(window.XLSX):reject(Error('Leitor de planilha indisponível'));
  script.onerror=()=>{script.remove();reject(Error('Não foi possível carregar o leitor. Confira sua conexão e tente novamente.'));};document.head.appendChild(script);
 }).catch(e=>{sheetJsPromise=null;throw e;});return sheetJsPromise;
}
async function loadExistingForImport(){
 const all=[];for(let offset=0;offset<100000;offset+=500){
  const {data,error}=await db.from('equipamentos').select('tag,patrimonio').is('ciclo_arquivado_id',null).order('id').range(offset,offset+499);
  if(error)throw error;all.push(...(data||[]));if(!data||data.length<500)return all;
 }throw Error('Quantidade de equipamentos excede o limite de conferência.');
}
function resetImport(){
 importReadId++;importBook=null;importRows=[];importPrepared=[];importExisting=[];importLot=null;importSuccess=false;
 for(const id of ['importFile','importSheet','importInUsePolicy'])$(id).disabled=false;
 $('importFile').value='';$('importSheet').innerHTML='<option value="">Selecione um arquivo…</option>';
 $('importInUsePolicy').value='';$('importPreviewBody').innerHTML='';$('confirmImportBtn').disabled=true;$('importPreviewSummary').textContent='';message('importMessage','');
}
function openImport(){if(!canManageEquipment()){denyAction();return;}resetImport();$('importDialog').showModal();}
async function readImportFile(){
 if(importBusy)return;const file=$('importFile').files[0];const request=++importReadId;
 importSuccess=false;importBook=null;importRows=[];importPrepared=[];importLot=null;$('confirmImportBtn').disabled=true;$('importPreviewBody').innerHTML='';$('importPreviewSummary').textContent='';
 $('importSheet').innerHTML='<option value="">Carregando…</option>';
 if(!file)return;
 if(file.size>10*1024*1024){message('importMessage','O arquivo deve ter no máximo 10 MB.');return;}
 if(!/\.(xlsx|xlsm|csv)$/i.test(file.name)){message('importMessage','Selecione um arquivo .xlsx, .xlsm ou .csv.');return;}
 message('importMessage','Lendo a planilha e conferindo os equipamentos atuais…',true);
 try{
  const X=await loadSheetJs(),buffer=await file.arrayBuffer();if(request!==importReadId)return;
  let input=buffer,type='array';
  if(/\.csv$/i.test(file.name)){
   try{input=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{input=new TextDecoder('windows-1252').decode(buffer);}
   type='string';
  }
  const book=X.read(input,{type,raw:type==='string',cellNF:true,cellText:true,cellDates:false,bookVBA:false,sheetRows:2022});
  const existing=await loadExistingForImport();if(request!==importReadId||!$('importDialog').open)return;
  importBook=book;importExisting=existing;importLot=crypto.randomUUID();
  $('importSheet').innerHTML=book.SheetNames.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
  $('importSheet').value=book.SheetNames.find(n=>InventoryImport.normalize(n)==='cadastro')||book.SheetNames[0];
  chooseImportSheet();
 }catch(e){if(request===importReadId)message('importMessage','Não foi possível ler: '+e.message);}
}
function chooseImportSheet(){
 if(importBusy||!importBook||importSuccess)return;
 try{importRows=InventoryImport.parseWorkbook(window.XLSX,importBook,$('importSheet').value);renderImportPreview();}
 catch(e){importRows=[];importPrepared=[];$('importPreviewBody').innerHTML='';$('confirmImportBtn').disabled=true;message('importMessage',e.message);}
}
function renderImportPreview(){
 if(importBusy||importSuccess)return;
 importPrepared=InventoryImport.prepare(importRows,importExisting,$('importInUsePolicy').value);
 const counts={ready:0,duplicate:0,invalid:0,pending:0,ignored:0};importPrepared.forEach(r=>counts[r.status]++);
 $('importPreviewSummary').textContent=`${importRows.length} linha(s): ${counts.ready} pronta(s), ${counts.duplicate} duplicada(s), ${counts.invalid} inválida(s), ${counts.ignored} ignorada(s), ${counts.pending} aguardando escolha.`;
 renderImportRows();
 $('confirmImportBtn').textContent=`Importar ${counts.ready} equipamento(s)`;
 $('confirmImportBtn').disabled=!counts.ready||!!counts.pending;
 message('importMessage',counts.pending?'Escolha como tratar os itens Em uso antes de confirmar.':counts.invalid?'As linhas inválidas não serão enviadas. Confira a prévia.':importRows.length?'Prévia pronta. Confira antes de importar.':'A aba não contém equipamentos.',!counts.pending&&!counts.invalid);
}
function renderImportRows(){
 $('importPreviewBody').innerHTML=importPrepared.map(({item:r,status,reason})=>`<tr><td>${r.linha}</td><td>${esc(r.tag)}</td><td>${esc(r.patrimonio||'Não informado')}</td><td>${esc(r.descricao)}</td><td>${esc(r.estado)}</td><td>${esc(r.situacao)}</td><td class="${status==='ready'?'':'danger'}">${esc(reason)}</td></tr>`).join('');
}
function setImportBusy(value){
 importBusy=value;for(const id of ['importFile','importSheet','importInUsePolicy','confirmImportBtn'])$(id).disabled=value;
 document.querySelectorAll('[data-close="importDialog"]').forEach(b=>b.disabled=value);
}
async function confirmEquipmentImport(){
 if(!canManageEquipment()){denyAction();return;}if(importBusy||importSuccess||!importLot)return;
 const items=importPrepared.filter(r=>r.status==='ready').map(r=>r.item);
 if(!items.length||importPrepared.some(r=>r.status==='pending'))return;
 const skipped=importPrepared.length-items.length;
 if(!confirm(`Importar ${items.length} novos equipamentos no ciclo atual? ${skipped} linha(s) da prévia não serão enviadas. Equipamentos existentes não serão alterados.`))return;
 const userId=state.user.id;
 setImportBusy(true);message('importMessage','Importando… Aguarde a confirmação.',true);
 try{
  const {data,error}=await db.rpc('importar_equipamentos',{p_lote:importLot,p_itens:items});if(error)throw error;
  if(state.user?.id!==userId||!$('importDialog').open)return;
  importSuccess=true;await loadAll();
  const ignored=data.ignorados||[];
  message('importMessage',`${data.importados} equipamento(s) importado(s). ${ignored.length} duplicidade(s) detectada(s) novamente pelo banco.`,true);
  $('importPreviewSummary').textContent+=' Importação concluída.';
  for(const record of ignored){const row=importPrepared.find(r=>r.item.linha===record.linha);if(row){row.status='duplicate';row.reason=record.motivo;}}
  for(const row of importPrepared)if(row.status==='ready')row.reason='Importado';
  renderImportRows();
  $('confirmImportBtn').textContent='Importação concluída';
 }catch(e){message('importMessage','Não foi possível confirmar: '+e.message+'. Se houve falha de conexão, tente novamente: o mesmo lote não será importado duas vezes.');}
 finally{
  setImportBusy(false);if(!$('importDialog').open){resetImport();return;}if(importSuccess){$('confirmImportBtn').disabled=true;for(const id of ['importFile','importSheet','importInUsePolicy'])$(id).disabled=true;}
  else $('confirmImportBtn').disabled=!importPrepared.some(r=>r.status==='ready')||importPrepared.some(r=>r.status==='pending');
 }
}
document.addEventListener('DOMContentLoaded',()=>{
 $('importEquipmentBtn').addEventListener('click',openImport);$('importFile').addEventListener('change',readImportFile);
 $('importSheet').addEventListener('change',chooseImportSheet);$('importInUsePolicy').addEventListener('change',renderImportPreview);
 $('confirmImportBtn').addEventListener('click',confirmEquipmentImport);
 $('importDialog').addEventListener('cancel',e=>{if(importBusy)e.preventDefault();});
 $('importDialog').addEventListener('close',()=>{importReadId++;if(!importBusy)resetImport();});
});
