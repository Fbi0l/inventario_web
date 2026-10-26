// Teste sem Supabase real: paginação estável e lotes de autorização de PDFs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js','utf8');
function extract(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert(a>=0&&b>a,'Trecho nao encontrado: '+start);
  return source.slice(a,b);
}
const movementIds=Array.from({length:1002},(_,i)=>({id:String(i+1),tipo:'Retirada',devolucao_em:'2026-10-26',termo_versao:1}));
const allMovements=movementIds.map((m,i)=>({...m,created_at:String(1002-i)}));
const ranges=[], rpcBatches=[];
const db={
  from(table){
    assert.equal(table,'movimentacoes');
    const q={select:()=>q,is:()=>q,order:()=>q,
      range:async(from,to)=>{
        ranges.push([from,to]);
        return {data:allMovements.slice(from,to+1),error:null};
      }};
    return q;
  },
  rpc:async(name,args)=>{
    assert.equal(name,'listar_termos_visiveis');
    assert(args.p_ids.length<=500);
    rpcBatches.push(args.p_ids);
    return {data:args.p_ids.map(movimentacao_id=>({movimentacao_id})),error:null};
  }
};
const ctx=vm.createContext({db,state:{movements:movementIds,visibleTermIds:new Set()},Set,Error,message:()=>{},canViewTerms:()=>true});
vm.runInContext(extract('async function fetchActiveMovements(){','\nasync function loadAll(){')+'\n'+extract('async function loadVisibleTermIds(){','\nfunction renderMovements()'),ctx);
(async()=>{
  const out=await vm.runInContext('fetchActiveMovements()',ctx);
  assert.equal(out.error,null);
  assert.equal(out.data.length,1002);
  assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
  await vm.runInContext('loadVisibleTermIds()',ctx);
  assert.equal(ctx.state.visibleTermIds.size,1002);
  assert.deepEqual(rpcBatches.map(b=>b.length),[200,200,200,200,200,2]);
  // Garante que o clone usado na publicacao inclui a mesma correcao.
  assert.equal(fs.readFileSync('SITE_PUBLICAR/app.js','utf8'),source);
  console.log('Historico: paginacao 1002 movimentos e permissoes PDF em lotes OK.');
})().catch(err=>{console.error(err);process.exitCode=1});
