/* Termo PDF: usa o modelo original e dados historicos validados no servidor. */
async function buildEquipmentTermPdf(d,templateBytes){
  if(!window.PDFLib||!window.fontkit||!templateBytes)throw new Error('Não foi possível carregar o gerador PDF. Atualize a página e tente novamente.');
  const {PDFDocument,rgb}=window.PDFLib;
  const pdf=await PDFDocument.load(templateBytes);
  pdf.registerFontkit(window.fontkit);
  const font=await pdf.embedFont(window.TERMO_FONT_REGULAR,{subset:true}),bold=await pdf.embedFont(window.TERMO_FONT_BOLD,{subset:true});
  const page=pdf.getPage(0),height=page.getHeight();
  page.pushOperators(window.PDFLib.setCharacterSpacing(0),window.PDFLib.setWordSpacing(0),window.PDFLib.setCharacterSqueeze(100),window.PDFLib.setTextRise(0));
  const clean=v=>Array.from(String(v??'')).map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');
  const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Belem',dateStyle:'short',timeStyle:'short'}):'—';
  const time=v=>v?new Date(v).toLocaleTimeString('pt-BR',{timeZone:'America/Belem',hour:'2-digit',minute:'2-digit'}):'—';
  const rect=(x,top,w,h)=>page.drawRectangle({x,y:height-top-h,width:w,height:h,color:rgb(1,1,1)});
  const text=(value,x,top,size=9,heavy=false,target=page)=>target.drawText(clean(value),{x,y:target.getHeight()-top-size,size,font:heavy?bold:font,color:rgb(0,0,0)});
  const wrap=(value,width,size=9)=>{
    const lines=[];
    for(const paragraph of clean(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/)){
        if(!word)continue;
        if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){lines.push(line);line='';}
        if(font.widthOfTextAtSize(word,size)>width){
          if(line){lines.push(line);line='';}
          for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}
        }else line+=(line?' ':'')+word;
      }
      lines.push(line);
    }
    return lines;
  };
  const annex=[];
  const block=(label,value,x,top,width,maxLines=1,size=9)=>{
    const lines=wrap(value||'—',width,size);
    if(lines.length>maxLines){
      if(!annex.some(([,v])=>v===value))annex.push([label,value]);
      const short=lines.slice(0,maxLines);short[maxLines-1]='Ver anexo';
      short.forEach((v,i)=>text(v,x,top+i*(size+2),size));
    }else lines.forEach((v,i)=>text(v,x,top+i*(size+2),size));
  };
  rect(50,159,512,29);
  text('Local da Ação:',51,160,9,true);block('Local da ação',d.local_acao,137,160,418);
  text('Data:',51,176,9,true);text(date(d.retirada_em).slice(0,10),85,176);
  rect(50,212,512,43);
  text('Nome completo:',51,213,9,true);block('Nome completo',d.retirante.nome,145,213,410);
  text('CPF:',51,228,9,true);text(d.retirante.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'),79,228);
  text('Telefone/Contato:',51,243,9,true);text(d.retirante.telefone||'Não informado',145,243);
  // Corpo da tabela, mantendo as bordas do modelo.
  block('Equipamento',d.equipamento.descricao,85,303,113,2,8);
  block('Patrimônio / número de série',d.equipamento.patrimonio||d.equipamento.numero_serie||d.equipamento.tag,207,303,108,2,8);
  text('1',328,307,9);text(d.estado_retirada,357,307,8);text(d.estado_devolucao,448,307,8);
  rect(50,336,512,14);
  text('Horário de retirada: '+time(d.retirada_em),51,338,9,true);
  text('Horário de devolução: '+time(d.devolucao_em),267,338,9,true);
  rect(50,507,512,207);
  text('Na retirada: '+(d.avarias_retirada?'Com avarias/observações':'Sem avarias aparentes'),51,509,9);
  text('Na devolução: '+d.ocorrencia_devolucao,51,525,9);
  text('Descrição das ocorrências:',51,542,9,true);
  block('Observações na retirada', 'Retirada: '+(d.observacoes||'Sem observações.'),51,556,505,1,9);
  block('Observações na devolução','Devolução: '+(d.observacoes_devolucao||'Sem observações.'),51,571,505,2,9);
  // Assinaturas permanecem em branco para preenchimento manual apos imprimir.
  text('5. ASSINATURAS',51,601,11,true);
  text('Assinatura do responsável pela retirada: ___________________________________',51,633,9);
  text('Retirada: '+date(d.retirada_em)+'   |   Devolução: '+date(d.devolucao_em),51,650,9);
  text('Assinatura do responsável pela entrega/conferência: __________________________',51,684,9);
  block('Setor / destino','Setor/destino: '+(d.destino||'Não informado'),51,703,505,1,8);
  rect(50,744,512,30);
  text('Termo de controle diário de equipamentos • Horários de Brasília (UTC-3)',51,747,8);
  text('Registro: '+d.id,51,760,7);
  if(annex.length){
    let ap=pdf.addPage([612,792]),top=54;
    const header=()=>{text('ANEXO AO TERMO DE RESPONSABILIDADE',51,28,12,true,ap);text('Registro: '+d.id,51,44,8,false,ap);};header();top=70;
    for(const [label,value] of annex){
      const lines=wrap(value,505,9);
      if(top>710){ap=pdf.addPage([612,792]);header();top=70;}
      text(label,51,top,10,true,ap);top+=18;
      for(const line of lines){if(top>735){ap=pdf.addPage([612,792]);header();top=70;}text(line,51,top,9,false,ap);top+=12;}
      top+=14;
    }
  }
  return pdf.save();
}
async function loadPrivateTermTemplate(){
  // download() usa o JWT da sessao; nao cria URL publica ou link assinado.
  const {data,error}=await db.storage.from('modelos-termos').download('termo-v1.pdf');
  if(error||!data)throw new Error('Modelo privado indisponível. Peça ao administrador para enviar termo-v1.pdf ao armazenamento privado modelos-termos');
  if(data.size>5*1024*1024)throw new Error('Modelo PDF excede o limite de 5 MB.');
  const bytes=await data.arrayBuffer();
  const signature=new Uint8Array(bytes,0,Math.min(5,bytes.byteLength));
  if(String.fromCharCode(...signature)!=='%PDF-')throw new Error('O modelo privado não é um PDF válido.');
  return bytes;
}
let termObjectUrl=null,termRequest=0;
async function openEquipmentTerm(id){
  if(!canViewTerms()){denyAction();return;}
  const request=++termRequest,dialog=$('termDialog'),button=$('downloadTermBtn');
  if(termObjectUrl){URL.revokeObjectURL(termObjectUrl);termObjectUrl=null;}
  button.disabled=true;button.onclick=null;
  if(!dialog.open)dialog.showModal();
  message('termMessage','Preparando PDF…',true);
  try{
    const {data,error}=await db.rpc('obter_termo_equipamento',{p_movimentacao_id:id});if(error)throw error;
    if(request!==termRequest||!dialog.open)return;
    const template=await loadPrivateTermTemplate();
    if(request!==termRequest||!dialog.open)return;
    const bytes=await buildEquipmentTermPdf(data,template);
    if(request!==termRequest||!dialog.open)return;
    termObjectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    button.onclick=()=>{const a=document.createElement('a');a.href=termObjectUrl;a.download=`termo_${id}.pdf`;document.body.appendChild(a);a.click();a.remove();};
    button.disabled=false;
    message('termMessage','Termo preenchido. Clique em Baixar PDF para salvar ou imprimir.',true);
  }catch(err){if(request===termRequest)message('termMessage','Não foi possível gerar o PDF: '+err.message+'. A devolução já registrada permanece salva; tente novamente em Termo PDF no histórico.');}
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('termDialog').addEventListener('close',()=>{termRequest++;if(termObjectUrl){URL.revokeObjectURL(termObjectUrl);termObjectUrl=null;}});
});
