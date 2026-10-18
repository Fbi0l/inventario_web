/* Inventário Web — frontend Supabase. Configure SUPABASE_URL e SUPABASE_ANON_KEY. */
const SUPABASE_URL = 'https://meqpwvdisjuoacepkljs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lcXB3dmRpc2p1b2FjZXBrbGpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjAwODAsImV4cCI6MjEwNzU5NjA4MH0.m187ScvAV4phg4cLm6blScU-TWnNUWW9LuryfnWHZ7k';
const configured = /^https:\/\/[^/]+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes('COLE_AQUI');
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
const state = { equipment: [], movements: [], users: [], page: 'dashboard', user: null, perfil: null };
const fields = ['tag','patrimonio','descricao','categoria','marca','modelo','numeroSerie','pertencimento','responsavel','localizacao','estado','situacao','valor','observacoes'];
const dbField = {tag:'tag',patrimonio:'patrimonio',descricao:'descricao',categoria:'categoria',marca:'marca',modelo:'modelo',numeroSerie:'numero_serie',pertencimento:'pertencimento',responsavel:'responsavel',localizacao:'localizacao',estado:'estado',situacao:'situacao',valor:'valor',observacoes:'observacoes'};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDateTime = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}T${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`; };
const fmt = d => d ? new Date(d).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—';
const pill = s => `<span class="pill ${s==='Disponível'?'available':s==='Em uso'?'use':s==='Manutenção'?'maintenance':s==='Baixado'?'retired':''}">${esc(s||'—')}</span>`;
function message(id, text='', good=false){ const el=$(id); el.textContent=text; el.style.color=good?'#18794e':'#b42318'; }
function showLogin(){ $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden'); }
async function showApp(session){
  state.user=session.user;
  state.perfil=null;
  $('userEmail').textContent=session.user.email||'';
  $('userProfile').textContent='Verificando acesso…';
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  applyPermissions();
  const {data,error}=await db.from('perfis_usuarios').select('perfil').eq('usuario_id',session.user.id).maybeSingle();
  if(state.user?.id!==session.user.id)return;
  if(error || !data?.perfil){
    message('globalMessage','Acesso sem perfil definido. Peça ao administrador para atribuir um perfil ou confira se a atualização SQL foi aplicada.');
    return;
  }
  state.perfil=data.perfil;
  $('userProfile').textContent=roleLabel(data.perfil);
  applyPermissions();
  await loadAll();
}
async function login(e){e.preventDefault(); if(!db){message('loginMessage','Configure a URL e a chave do Supabase no arquivo app.js.');return;} message('loginMessage','Entrando…',true); const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}); if(error)message('loginMessage',error.message); else message('loginMessage','',true);}
async function logout(){if(db)await db.auth.signOut();state.user=null;state.perfil=null;showLogin();}
async function loadAll(){if(!db||!state.perfil)return; message('globalMessage','Carregando dados…',true); const [e,m]=await Promise.all([db.from('equipamentos').select('*').order('created_at',{ascending:false}),db.from('movimentacoes').select('*, equipamentos(tag, patrimonio, descricao)').order('created_at',{ascending:false}).limit(500)]); if(e.error||m.error){message('globalMessage',`Erro ao carregar: ${(e.error||m.error).message}`);return;} state.equipment=e.data||[];state.movements=m.data||[];renderAll();message('globalMessage','Dados atualizados.',true); }
const roleLabel = perfil => ({administrador:'Administrador',operador:'Operador',consulta:'Consulta'})[perfil]||'Sem perfil';
const canManageEquipment = () => state.perfil === 'administrador';
const canMove = () => ['administrador','operador'].includes(state.perfil);
const canManageUsers = () => state.perfil === 'administrador';
function denyAction(){message('globalMessage','Seu perfil não permite executar esta ação.');}
function applyPermissions(){
  document.querySelector('[data-page="users"]').classList.toggle('hidden',!canManageUsers());
  $('newEquipmentBtn').classList.toggle('hidden',!canManageEquipment());
  $('newMovementBtn').classList.toggle('hidden',!canMove());
  if(!canManageUsers() && state.page==='users')goto('dashboard');
  renderEquipment();renderMovements();
}
function renderAll(){renderStats();renderEquipment();renderMovements();renderRecent();populateCategories();populateMovementEquipment();if($('reportsPage'))renderReport();}
function renderStats(){ $('statTotal').textContent=state.equipment.length; $('statAvailable').textContent=state.equipment.filter(x=>x.situacao==='Disponível').length; $('statInUse').textContent=state.equipment.filter(x=>x.situacao==='Em uso').length; $('statMaintenance').textContent=state.equipment.filter(x=>x.situacao==='Manutenção').length; }
function renderEquipment(){const q=$('searchEquipment').value.toLowerCase(), status=$('statusFilter').value,cat=$('categoryFilter').value;const arr=state.equipment.filter(x=>(!q||[x.tag,x.patrimonio,x.descricao,x.marca,x.modelo,x.numero_serie].some(v=>String(v||'').toLowerCase().includes(q)))&&(!status||x.situacao===status)&&(!cat||x.categoria===cat));$('equipmentBody').innerHTML=arr.length?arr.map(x=>`<tr><td><strong>${esc(x.tag||'—')}</strong><br><small>${esc(x.patrimonio||'Sem patrimônio')}</small></td><td><strong>${esc(x.descricao)}</strong><br><small>${esc([x.marca,x.modelo].filter(Boolean).join(' ')||'')}</small></td><td>${esc(x.categoria||'—')}</td><td>${esc(x.localizacao||'—')}</td><td>${pill(x.estado)}</td><td>${pill(x.situacao)}</td><td><div class="table-actions">${canManageEquipment()?`<button class="secondary" data-action="edit" data-id="${x.id}">Editar</button>`:''}<button class="secondary" data-action="qr" data-id="${x.id}">QR</button>${canManageEquipment()?`<button class="secondary" data-action="delete" data-id="${x.id}">Excluir</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum equipamento encontrado.</td></tr>';}
function movementName(m){return m.equipamentos?.descricao||state.equipment.find(e=>e.id===m.equipamento_id)?.descricao||'Equipamento removido';}
function renderMovements(){const q=$('searchMovement').value.toLowerCase(),type=$('movementFilter').value;const arr=state.movements.filter(m=>(!q||[movementName(m),m.responsavel,m.destino].some(v=>String(v||'').toLowerCase().includes(q)))&&(!type||m.tipo===type));$('movementBody').innerHTML=arr.length?arr.map(m=>`<tr><td>${fmt(m.created_at||m.retirada_em)}</td><td><strong>${esc(movementName(m))}</strong><br><small>${esc(m.equipamentos?.tag||'')}</small></td><td>${pill(m.tipo)}</td><td>${esc(m.responsavel||'—')}</td><td>${fmt(m.retirada_em)}</td><td>${fmt(m.devolucao_em)}</td><td>${canMove()&&m.tipo==='Retirada'&&!m.devolucao_em?`<button class="primary" data-action="return" data-id="${m.id}">Devolver</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhuma movimentação encontrada.</td></tr>';}
function renderRecent(){const arr=state.movements.slice(0,8);$('recentBody').innerHTML=arr.length?arr.map(m=>`<tr><td>${fmt(m.created_at||m.retirada_em)}</td><td>${esc(movementName(m))}</td><td>${pill(m.tipo)}</td><td>${esc(m.responsavel||'—')}</td><td>${esc(m.observacoes||'—')}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhuma movimentação registrada.</td></tr>';}
function populateCategories(){const select=$('categoryFilter'),current=select.value,cats=[...new Set(state.equipment.map(x=>x.categoria).filter(Boolean))].sort();select.innerHTML='<option value="">Todas as categorias</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');select.value=current;}
function populateMovementEquipment(){const select=$('movementEquipment'),available=state.equipment.filter(x=>x.situacao==='Disponível');select.innerHTML='<option value="">Selecione…</option>'+available.map(x=>`<option value="${x.id}">${esc(x.tag||x.patrimonio||'Sem código')} — ${esc(x.descricao)}</option>`).join('');}
function goto(page){if(page==='users'&&!canManageUsers()){denyAction();return;}state.page=page;document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));$(`${page}Page`).classList.remove('hidden');document.querySelectorAll('.nav-item[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('pageTitle').textContent=({dashboard:'Painel geral',equipment:'Equipamentos',movements:'Retiradas e devoluções',reports:'Relatórios',users:'Usuários'})[page];if(page==='reports')renderReport();if(page==='users')loadUsers();}
function openEquipment(item=null){if(!canManageEquipment()){denyAction();return;}$('equipmentForm').reset();$('equipmentId').value=item?.id||'';$('equipmentDialogTitle').textContent=item?'Editar equipamento':'Novo equipamento';fields.forEach(f=>{const el=$(f);if(el)el.value=item?.[dbField[f]]??'';});$('situacao').value=item?.situacao||'Disponível';$('estado').value=item?.estado||'Bom';$('equipmentDialog').showModal();}
async function saveEquipment(e){e.preventDefault();if(!canManageEquipment()){denyAction();return;}const id=$('equipmentId').value;const payload={};fields.forEach(f=>{const el=$(f);let v=el.value.trim();payload[dbField[f]]=f==='valor'?(v===''?null:Number(v)):(v||null);});if(!payload.tag)payload.tag=`EQ-${Date.now().toString().slice(-8)}`;message('equipmentMessage','Salvando…',true);const res=id?await db.from('equipamentos').update(payload).eq('id',id).select().single():await db.from('equipamentos').insert({...payload,criado_por:state.user.id}).select().single();if(res.error){message('equipmentMessage',res.error.message);return;} $('equipmentDialog').close();await loadAll();}
async function deleteEquipment(id){if(!canManageEquipment()){denyAction();return;}const item=state.equipment.find(x=>x.id===id);if(!item)return;if(!confirm(`Excluir “${item.descricao}”? Esta ação não pode ser desfeita.`))return;const {error}=await db.from('equipamentos').delete().eq('id',id);if(error){message('globalMessage',`Não foi possível excluir: ${error.message}`);return;}await loadAll();}
function openMovement(){if(!canMove()){denyAction();return;} $('movementForm').reset();$('movementOutAt').value=localDateTime(new Date());$('movementDialog').showModal(); }
async function saveMovement(e){e.preventDefault();if(!canMove()){denyAction();return;}const equipmentId=$('movementEquipment').value;if(!equipmentId){message('movementMessage','Selecione um equipamento.');return;}const item=state.equipment.find(x=>x.id===equipmentId);if(!item||item.situacao!=='Disponível'){message('movementMessage','Este equipamento não está disponível. Atualize a tela e tente novamente.');return;}const payload={equipamento_id:equipmentId,tipo:'Retirada',responsavel:$('movementResponsible').value.trim(),destino:$('movementDestination').value.trim()||null,retirada_em:new Date($('movementOutAt').value).toISOString(),previsao_devolucao:$('movementDueAt').value?new Date($('movementDueAt').value).toISOString():null,estado_retirada:$('movementCondition').value,observacoes:$('movementNotes').value.trim()||null,registrado_por:state.user.id};message('movementMessage','Registrando…',true);const {data,error}=await db.rpc('registrar_retirada',{p_equipamento_id:equipmentId,p_responsavel:payload.responsavel,p_destino:payload.destino,p_retirada_em:payload.retirada_em,p_previsao_devolucao:payload.previsao_devolucao,p_estado_retirada:payload.estado_retirada,p_observacoes:payload.observacoes});if(error){message('movementMessage',`Não foi possível registrar: ${error.message}. Verifique se executou supabase_schema.sql.`);return;} $('movementDialog').close();await loadAll();goto('movements');}
function openReturn(m){if(!canMove()){denyAction();return;}$('returnForm').reset();$('returnMovementId').value=m.id;$('returnEquipmentName').textContent=movementName(m);$('returnAt').value=localDateTime(new Date());$('returnDialog').showModal();}
async function saveReturn(e){e.preventDefault();if(!canMove()){denyAction();return;}const id=$('returnMovementId').value;const m=state.movements.find(x=>x.id===id);if(!m)return;message('returnMessage','Registrando devolução…',true);const {error}=await db.rpc('registrar_devolucao',{p_movimentacao_id:id,p_devolucao_em:new Date($('returnAt').value).toISOString(),p_estado_devolucao:$('returnCondition').value,p_observacoes_devolucao:$('returnNotes').value.trim()||null});if(error){message('returnMessage',`Não foi possível registrar: ${error.message}. Verifique se executou supabase_schema.sql.`);return;} $('returnDialog').close();await loadAll();}
function csvDownload(headers, rows, filename){const all=[headers,...rows];const csv='\ufeff'+all.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCsv(){const headers=['id','tag','patrimonio','descricao','categoria','marca','modelo','numero_serie','pertencimento','responsavel','localizacao','estado','situacao','valor','observacoes'];csvDownload(headers,state.equipment.map(x=>headers.map(h=>x[h]??'')),`inventario_${new Date().toISOString().slice(0,10)}.csv`);}
function reportDateValue(value){if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function reportRows(){const type=$('reportType').value,start=$('reportStart').value,end=$('reportEnd').value,status=$('reportStatus').value;if(type==='equipment'){return state.equipment.filter(x=>{const date=reportDateValue(x.created_at);return(!start||!date||date>=start)&&(!end||!date||date<=end)&&(!status||x.situacao===status);}).sort((a,b)=>String(a.descricao||'').localeCompare(String(b.descricao||''),'pt-BR'));}return state.movements.filter(m=>{const date=reportDateValue(m.retirada_em||m.created_at);const situation=m.tipo||'';const stateFilter=status==='Em aberto'?!m.devolucao_em:status==='Devolvidos'?!!m.devolucao_em:!status||situation===status;return(!start||!date||date>=start)&&(!end||!date||date<=end)&&stateFilter;}).sort((a,b)=>new Date(b.retirada_em||b.created_at||0)-new Date(a.retirada_em||a.created_at||0));}
function updateReportStatusOptions(){const type=$('reportType').value,select=$('reportStatus'),current=select.value;const options=type==='equipment'?[['','Todas as situações'],['Disponível','Disponível'],['Em uso','Em uso'],['Manutenção','Manutenção'],['Baixado','Baixado']]:[['','Todos os tipos/situações'],['Retirada','Retiradas'],['Devolução','Devoluções'],['Em aberto','Somente retiradas em aberto'],['Devolvidos','Somente equipamentos devolvidos']];select.innerHTML=options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');if(options.some(([v])=>v===current))select.value=current;}
function renderReport(){if(!$('reportType'))return;updateReportStatusOptions();const type=$('reportType').value,rows=reportRows();if(type==='equipment'){const headers=['TAG','Patrimônio','Descrição','Categoria','Marca','Modelo','Nº de série','Setor','Responsável habitual','Localização','Estado','Situação','Valor (R$)','Observações'];$('reportHead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';$('reportBody').innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(x.tag||'—')}</td><td>${esc(x.patrimonio||'—')}</td><td>${esc(x.descricao||'—')}</td><td>${esc(x.categoria||'—')}</td><td>${esc(x.marca||'—')}</td><td>${esc(x.modelo||'—')}</td><td>${esc(x.numero_serie||'—')}</td><td>${esc(x.pertencimento||'—')}</td><td>${esc(x.responsavel||'—')}</td><td>${esc(x.localizacao||'—')}</td><td>${esc(x.estado||'—')}</td><td>${esc(x.situacao||'—')}</td><td>${x.valor==null?'':Number(x.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td>${esc(x.observacoes||'—')}</td></tr>`).join(''):'<tr><td colspan="14" class="empty">Nenhum equipamento corresponde aos filtros.</td></tr>';}else{const headers=['Data da retirada','TAG','Patrimônio','Equipamento','Tipo','Responsável','Setor/destino','Retirada em','Previsão de devolução','Devolução em','Estado na retirada','Estado na devolução','Observações','Observações da devolução','Situação'];$('reportHead').innerHTML='<tr>'+headers.map(h=>`<th>${esc(h)}</th>`).join('')+'</tr>';$('reportBody').innerHTML=rows.length?rows.map(m=>{const eq=m.equipamentos||state.equipment.find(e=>e.id===m.equipamento_id)||{};return `<tr><td>${esc(fmt(m.created_at||m.retirada_em))}</td><td>${esc(eq.tag||'—')}</td><td>${esc(eq.patrimonio||'—')}</td><td>${esc(eq.descricao||movementName(m))}</td><td>${esc(m.tipo||'—')}</td><td>${esc(m.responsavel||'—')}</td><td>${esc(m.destino||'—')}</td><td>${esc(fmt(m.retirada_em))}</td><td>${esc(fmt(m.previsao_devolucao))}</td><td>${esc(fmt(m.devolucao_em))}</td><td>${esc(m.estado_retirada||'—')}</td><td>${esc(m.estado_devolucao||'—')}</td><td>${esc(m.observacoes||'—')}</td><td>${esc(m.observacoes_devolucao||'—')}</td><td>${m.devolucao_em?'Devolvido':'Em aberto'}</td></tr>`;}).join(''):'<tr><td colspan="15" class="empty">Nenhuma movimentação corresponde aos filtros.</td></tr>';}$('reportSummary').textContent=`${rows.length} registro(s) encontrado(s) • Gerado em ${new Date().toLocaleString('pt-BR')}`;}
function exportReport(){const type=$('reportType').value,rows=reportRows();if(type==='equipment'){const headers=['TAG','Patrimônio','Descrição','Categoria','Marca','Modelo','Número de série','Setor','Responsável habitual','Localização','Estado','Situação','Valor (R$)','Observações'];csvDownload(headers,rows.map(x=>[x.tag,x.patrimonio,x.descricao,x.categoria,x.marca,x.modelo,x.numero_serie,x.pertencimento,x.responsavel,x.localizacao,x.estado,x.situacao,x.valor,x.observacoes]),`relatorio_equipamentos_${new Date().toISOString().slice(0,10)}.csv`);}else{const headers=['Data da retirada','TAG','Patrimônio','Equipamento','Tipo','Responsável','Setor/destino','Retirada em','Previsão de devolução','Devolução em','Estado na retirada','Estado na devolução','Observações','Observações da devolução','Situação'];csvDownload(headers,rows.map(m=>{const eq=m.equipamentos||state.equipment.find(e=>e.id===m.equipamento_id)||{};return [fmt(m.created_at||m.retirada_em),eq.tag,eq.patrimonio,eq.descricao||movementName(m),m.tipo,m.responsavel,m.destino,fmt(m.retirada_em),fmt(m.previsao_devolucao),fmt(m.devolucao_em),m.estado_retirada,m.estado_devolucao,m.observacoes,m.observacoes_devolucao,m.devolucao_em?'Devolvido':'Em aberto'];}),`relatorio_movimentacoes_${new Date().toISOString().slice(0,10)}.csv`);}}
function printReport(){document.body.classList.add('report-print');window.print();}
async function callUserAdmin(action, payload={}){
  const {data,error}=await db.functions.invoke('manage-users',{body:{action,...payload}});
  if(error){let detail=error.message||'Falha ao chamar a função de usuários.';try{const ctx=error.context;if(ctx&&typeof ctx.json==='function'){const body=await ctx.json();detail=body.error||body.message||detail;}}catch(_){}throw new Error(detail);}
  if(data?.error)throw new Error(data.error);
  return data;
}
function renderUsers(){
  const body=$('usersBody');
  body.innerHTML=state.users.length?state.users.map(u=>{
    const blocked=!!u.banned_until&&new Date(u.banned_until)>new Date();
    const roleSelect=`<select data-role-user="${esc(u.id)}" aria-label="Perfil de ${esc(u.email||'usuário')}" ${u.id===state.user?.id?'disabled title="Você não pode retirar seu próprio perfil"':''}>
      ${['administrador','operador','consulta'].map(p=>`<option value="${p}" ${u.perfil===p?'selected':''}>${roleLabel(p)}</option>`).join('')}
    </select>`;
    return `<tr><td><strong>${esc(u.email||'—')}</strong>${u.id===state.user?.id?'<br><small>Usuário atual</small>':''}</td><td>${esc(u.user_metadata?.full_name||u.user_metadata?.name||'—')}</td><td>${roleSelect}<br><span class="pill ${blocked?'retired':'available'}">${blocked?'Bloqueado':'Ativo'}</span></td><td>${esc(fmt(u.created_at))}</td><td>${esc(fmt(u.last_sign_in_at))}</td><td><div class="table-actions"><button class="secondary" data-user-action="password" data-user-id="${esc(u.id)}" data-user-email="${esc(u.email||'')}">Alterar senha</button>${u.id!==state.user?.id?`<button class="secondary" data-user-action="access" data-blocked="${blocked?'true':'false'}" data-user-id="${esc(u.id)}" data-user-email="${esc(u.email||'')}">${blocked?'Desbloquear':'Bloquear acesso'}</button><button class="secondary" data-user-action="delete" data-user-id="${esc(u.id)}" data-user-email="${esc(u.email||'')}">Excluir usuário</button>`:''}</div></td></tr>`;
  }).join(''):'<tr><td colspan="6" class="empty">Nenhum usuário encontrado.</td></tr>';
}
async function loadUsers(){
  if(!canManageUsers())return;
  message('usersMessage','Carregando usuários…',true);
  try{const data=await callUserAdmin('list');state.users=data.users||[];renderUsers();message('usersMessage',`${state.users.length} usuário(s) carregado(s).`,true);}
  catch(err){message('usersMessage',`${err.message}. Confira se a função manage-users foi publicada e se o perfil Administrador foi configurado no banco.`);}
}
async function createUser(e){
  e.preventDefault();if(!canManageUsers()){denyAction();return;}const email=$('newUserEmail').value.trim().toLowerCase(),password=$('newUserPassword').value,name=$('newUserName').value.trim(),perfil=$('newUserRole').value;
  if(password.length<8){message('usersMessage','A senha deve ter pelo menos 8 caracteres.');return;}
  message('usersMessage','Criando usuário…',true);
  try{await callUserAdmin('create',{email,password,name,perfil});$('createUserForm').reset();message('usersMessage',`Usuário ${email} criado com sucesso.`,true);await loadUsers();}
  catch(err){message('usersMessage',`Não foi possível criar o usuário: ${err.message}`);}
}
async function userAction(action,id,email,blockedFlag){if(!canManageUsers()){denyAction();return;}
  if(action==='access'){
    const blocked=blockedFlag==='true';
    if(!confirm(`${blocked?'Desbloquear':'Bloquear'} o acesso de ${email}?`))return;
    message('usersMessage',`${blocked?'Desbloqueando':'Bloqueando'} ${email}…`,true);
    try{await callUserAdmin('access',{userId:id,blocked:!blocked});message('usersMessage',`Acesso de ${email} ${blocked?'desbloqueado':'bloqueado'} com sucesso.`,true);await loadUsers();}
    catch(err){message('usersMessage',`Não foi possível alterar o acesso: ${err.message}`);}return;
  }
  if(action==='delete'){
    if(id===state.user?.id){message('usersMessage','Você não pode excluir sua própria conta.');return;}
    if(!confirm(`Excluir definitivamente a conta de ${email}? Esta ação não pode ser desfeita.`))return;
    const confirmacao=prompt(`Para confirmar a exclusão de ${email}, digite EXCLUIR:`);
    if(confirmacao===null)return;
    if(confirmacao.trim().toUpperCase()!=='EXCLUIR'){
      message('usersMessage','Exclusão cancelada: confirmação incorreta.');return;
    }
    message('usersMessage',`Excluindo usuário ${email}…`,true);
    try{
      await callUserAdmin('delete',{userId:id});
      await loadUsers();
      message('usersMessage',`Usuário ${email} excluído com sucesso.`,true);
    }catch(err){
      message('usersMessage',`Não foi possível excluir o usuário: ${err.message}`);
    }
    return;
  }
  if(action==='password'){
    const password=prompt(`Digite a nova senha para ${email} (mínimo de 8 caracteres):`);
    if(password===null)return;
    if(password.length<8){message('usersMessage','A senha deve ter pelo menos 8 caracteres.');return;}
    message('usersMessage','Atualizando senha…',true);
    try{await callUserAdmin('password',{userId:id,password});message('usersMessage',`Senha de ${email} alterada com sucesso.`,true);}
    catch(err){message('usersMessage',`Não foi possível alterar a senha: ${err.message}`);}
  }
}
async function changeUserRole(select){
  if(!canManageUsers()){denyAction();return;}
  const userId=select.dataset.roleUser;
  const user=state.users.find(u=>u.id===userId);
  if(!user)return;
  if(!confirm(`Alterar o perfil de ${user.email} para ${roleLabel(select.value)}?`)){
    select.value=user.perfil||'consulta';return;
  }
  select.disabled=true;
  try{
    await callUserAdmin('role',{userId,perfil:select.value});
    await loadUsers();
    message('usersMessage','Perfil atualizado com sucesso.',true);
  }catch(err){
    select.value=user.perfil||'consulta'; select.disabled=false;
    message('usersMessage',`Erro ao alterar perfil: ${err.message}`);
  }
}
document.addEventListener('change',e=>{
  const select=e.target.closest('select[data-role-user]');
  if(select)changeUserRole(select);
});
function openQr(item){$('qrcode').innerHTML='';$('qrLabel').textContent=`${item.tag||item.patrimonio||''} — ${item.descricao}`;new QRCode($('qrcode'),{text:JSON.stringify({id:item.id,tag:item.tag,patrimonio:item.patrimonio,descricao:item.descricao}),width:220,height:220,correctLevel:QRCode.CorrectLevel.M});$('qrDialog').showModal();}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-page]');if(nav)goto(nav.dataset.page);const go=e.target.closest('[data-goto]');if(go)goto(go.dataset.goto);const close=e.target.closest('[data-close]');if(close)$(close.dataset.close).close();const action=e.target.closest('[data-action]');if(action){const item=state.equipment.find(x=>x.id===action.dataset.id);if(action.dataset.action==='edit')openEquipment(item);if(action.dataset.action==='delete')deleteEquipment(action.dataset.id);if(action.dataset.action==='qr')openQr(item);if(action.dataset.action==='return'){const m=state.movements.find(x=>x.id===action.dataset.id);if(m)openReturn(m);}}const userActionBtn=e.target.closest('[data-user-action]');if(userActionBtn)userAction(userActionBtn.dataset.userAction,userActionBtn.dataset.userId,userActionBtn.dataset.userEmail||'este usuário',userActionBtn.dataset.blocked);});
$('createUserForm').addEventListener('submit',createUser);$('refreshUsersBtn').addEventListener('click',loadUsers);$('loginForm').addEventListener('submit',login);$('logoutBtn').addEventListener('click',logout);$('refreshBtn').addEventListener('click',loadAll);$('newEquipmentBtn').addEventListener('click',()=>openEquipment());$('equipmentForm').addEventListener('submit',saveEquipment);$('newMovementBtn').addEventListener('click',openMovement);$('movementForm').addEventListener('submit',saveMovement);$('returnForm').addEventListener('submit',saveReturn);$('exportBtn').addEventListener('click',exportCsv);$('exportReportBtn').addEventListener('click',exportReport);$('printReportBtn').addEventListener('click',printReport);$('applyReportBtn').addEventListener('click',renderReport);['reportType','reportStatus','reportStart','reportEnd'].forEach(id=>$(id).addEventListener('change',renderReport));window.addEventListener('afterprint',()=>document.body.classList.remove('report-print'));$('printQrBtn').addEventListener('click',()=>window.print());['searchEquipment','statusFilter','categoryFilter'].forEach(id=>$(id).addEventListener('input',renderEquipment));['searchMovement','movementFilter'].forEach(id=>$(id).addEventListener('input',renderMovements));
if(!configured){message('loginMessage','Antes de entrar, configure a URL e a chave pública do Supabase no arquivo app.js.');}else{db.auth.getSession().then(({data})=>data.session?showApp(data.session):showLogin());db.auth.onAuthStateChange((_event,session)=>{if(session&&!state.user)showApp(session);else if(!session){state.user=null;state.perfil=null;showLogin();}});}
