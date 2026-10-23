/* Etiquetas A4: QR compactos compativeis com o leitor existente. */
async function buildQrLabelsPdf(equipment,onProgress=()=>{},cancelled=()=>false){
  if(!equipment.length)throw new Error('Nenhum equipamento disponível para imprimir.');
  if(!window.PDFLib||!window.fontkit||typeof QRCode==='undefined')throw new Error('Não foi possível carregar o gerador. Atualize a página e tente novamente.');
  const {PDFDocument,rgb}=window.PDFLib,mm=72/25.4;
  const pdf=await PDFDocument.create();pdf.registerFontkit(window.fontkit);
  const font=await pdf.embedFont(window.TERMO_FONT_REGULAR,{subset:true});
  const bold=await pdf.embedFont(window.TERMO_FONT_BOLD,{subset:true});
  const text=v=>Array.from(String(v??'')).map(c=>{try{font.encodeText(c);return c;}catch{return '?';}}).join('').replace(/\s+/g,' ').trim();
  const fit=(value,width,size,f=font)=>{
    let s=text(value);if(f.widthOfTextAtSize(s,size)<=width)return s;
    while(s&&f.widthOfTextAtSize(s+'…',size)>width)s=s.slice(0,-1);
    return s+'…';
  };
  const lines=(value,width,size)=>{
    const words=text(value).split(' '),result=[];let line='';
    for(const word of words){
      if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){result.push(line);line='';}
      line+=(line?' ':'')+word;
    }
    if(line)result.push(line);
    if(result.length>2)return [fit(result[0],width,size),fit(result.slice(1).join(' '),width,size)];
    return result.map(s=>fit(s,width,size));
  };
  const perPage=12,totalPages=Math.ceil(equipment.length/perPage);
  let page;
  for(let i=0;i<equipment.length;i++){
    if(cancelled())throw new Error('Geração cancelada.');
    if(i%perPage===0){
      page=pdf.addPage([210*mm,297*mm]);
      page.drawText('Etiquetas de equipamentos',{x:11*mm,y:286*mm,size:11,font:bold});
      page.drawText(`A4 • Escala 100% • Recorte nas linhas • ${Math.floor(i/perPage)+1}/${totalPages}`,{x:11*mm,y:281*mm,size:8,font});
    }
    const item=equipment[i],cell=i%perPage,col=cell%3,row=Math.floor(cell/3);
    const x=(11+col*64)*mm,top=(278-row*66)*mm,w=60*mm,h=62*mm;
    page.drawRectangle({x,y:top-h,width:w,height:h,borderColor:rgb(.55,.55,.55),borderWidth:.5,borderDashArray:[3,3]});
    const container=document.createElement('div');
    // O leitor aceita {id}; evita QR denso e nao expoe dados pessoais.
    new QRCode(container,{text:JSON.stringify({id:item.id}),width:384,height:384,correctLevel:QRCode.CorrectLevel.M});
    const canvas=container.querySelector('canvas');
    if(!canvas)throw new Error('Seu navegador não conseguiu desenhar os QR Codes. Tente em outro navegador.');
    const png=await pdf.embedPng(canvas.toDataURL('image/png'));
    // 4 mm de margem branca em cima/baixo; nao imprimir texto na area de silencio.
    page.drawImage(png,{x:x+14*mm,y:top-36*mm,width:32*mm,height:32*mm});
    const maxWidth=w-6*mm;
    const code=fit(item.tag||item.patrimonio||item.id.slice(0,8),maxWidth,9,bold);
    page.drawText(code,{x:x+(w-bold.widthOfTextAtSize(code,9))/2,y:top-43*mm,size:9,font:bold});
    const description=lines(item.descricao||'Equipamento',maxWidth,8);
    description.forEach((line,index)=>page.drawText(line,{x:x+(w-font.widthOfTextAtSize(line,8))/2,y:top-(48+index*3.6)*mm,size:8,font}));
    const asset=fit('Patrimônio: '+(item.patrimonio||'Não informado'),maxWidth,7);
    page.drawText(asset,{x:x+(w-font.widthOfTextAtSize(asset,7))/2,y:top-58*mm,size:7,font});
    onProgress(i+1,equipment.length);
    if(i%8===7)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return pdf.save();
}
async function fetchEquipmentForQrLabels(cancelled){
  const rows=[];
  for(let offset=0;offset<100000;offset+=500){
    if(cancelled())throw new Error('Geração cancelada.');
    const {data,error}=await db.from('equipamentos').select('id,tag,patrimonio,descricao')
      .is('ciclo_arquivado_id',null).order('id',{ascending:true}).range(offset,offset+499);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<500)return rows.sort((a,b)=>String(a.tag||a.patrimonio||a.descricao).localeCompare(String(b.tag||b.patrimonio||b.descricao),'pt-BR',{numeric:true}));
  }
  throw new Error('Quantidade de equipamentos excede o limite de impressão em lote.');
}
let qrLabelsRequest=0,qrLabelsUrl=null;
function clearQrLabelsPdf(){
  qrLabelsRequest++;
  if(qrLabelsUrl){URL.revokeObjectURL(qrLabelsUrl);qrLabelsUrl=null;}
  for(const id of ['openQrLabelsPdf','downloadQrLabelsPdf']){
    const link=document.getElementById(id);link.removeAttribute('href');link.classList.add('hidden');
  }
}
async function openQrLabels(){
  if(!db||!state.user||!state.perfil){denyAction();return;}
  clearQrLabelsPdf();const request=qrLabelsRequest,dialog=$('qrLabelsDialog');
  if(!dialog.open)dialog.showModal();
  message('qrLabelsMessage','Carregando todos os equipamentos do ciclo atual…',true);
  const cancelled=()=>request!==qrLabelsRequest||!dialog.open;
  try{
    const equipment=await fetchEquipmentForQrLabels(cancelled);
    if(cancelled())return;
    const bytes=await buildQrLabelsPdf(equipment,(done,total)=>message('qrLabelsMessage',`Preparando etiquetas: ${done} de ${total}…`,true),cancelled);
    if(cancelled())return;
    qrLabelsUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    for(const id of ['openQrLabelsPdf','downloadQrLabelsPdf']){
      const link=$(id);link.href=qrLabelsUrl;link.classList.remove('hidden');
    }
    $('downloadQrLabelsPdf').download='etiquetas_qr_a4_'+new Date().toISOString().slice(0,10)+'.pdf';
    message('qrLabelsMessage',`${equipment.length} etiqueta(s) em ${Math.ceil(equipment.length/12)} folha(s) A4. Abra o PDF e use a opção Imprimir do visualizador.`,true);
  }catch(err){if(!cancelled())message('qrLabelsMessage','Não foi possível preparar as etiquetas: '+err.message);}
}
document.addEventListener('DOMContentLoaded',()=>{
  $('printAllQrBtn').addEventListener('click',openQrLabels);
  $('qrLabelsDialog').addEventListener('close',clearQrLabelsPdf);
});
