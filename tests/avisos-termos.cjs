const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app.js', 'utf8');
function section(start, end) {
  const a=code.indexOf(start), b=code.indexOf(end,a);
  assert(a>=0 && b>a, 'Trecho nao encontrado: '+start);
  return code.slice(a,b);
}
const load=section('async function loadAll(){','\nconst roleLabel =');
const visible=section('async function loadVisibleTermIds(){','\nfunction renderMovements()');
async function scenario(rpcError) {
  const messages=[];
  const ctx={
    db:{rpc:async()=>rpcError?{error:{message:'Permissao negada'}}:{data:[{movimentacao_id:'id1'}]}},
    state:{perfil:'administrador',movements:[],equipment:[],visibleTermIds:new Set()},
    fetchActiveEquipment:async()=>({data:[{id:'eq1'}],error:null}),
    fetchActiveMovements:async()=>({data:[{id:'id1',tipo:'Retirada',devolucao_em:'2026-10-26',termo_versao:1}],error:null}),
    message:(id,msg,good)=>messages.push({id,msg,good}),
    renderAll:()=>{},canViewTerms:()=>true,Set,Error
  };
  vm.createContext(ctx);vm.runInContext(load+'\n'+visible,ctx);
  await vm.runInContext('loadAll()',ctx);
  return {messages,state:ctx.state};
}
(async()=>{
  const fail=await scenario(true);
  assert.match(fail.messages.at(-1).msg,/n[aã]o foi poss[ií]vel verificar permiss[oõ]es/i);
  assert.doesNotMatch(fail.messages.at(-1).msg,/Dados atualizados/i);
  assert.equal(fail.state.visibleTermIds.size,0);
  const success=await scenario(false);
  assert.equal(success.messages.at(-1).msg,'Dados atualizados.');
  assert.equal(success.state.visibleTermIds.size,1);
  assert.equal(fs.readFileSync('SITE_PUBLICAR/app.js','utf8'),code);
  console.log('Avisos de termos: falha parcial preservada e sucesso validado.');
})().catch(e=>{console.error(e);process.exitCode=1});
