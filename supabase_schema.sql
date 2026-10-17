-- Inventário Web — execute este script no SQL Editor do Supabase.
-- Acesso: qualquer usuário autenticado pode consultar e alterar os registros.
-- Para produção, adapte as policies a perfis/cargos da sua organização.
create extension if not exists pgcrypto;

create table if not exists public.equipamentos (
  id uuid primary key default gen_random_uuid(),
  tag text unique,
  patrimonio text,
  descricao text not null,
  categoria text,
  marca text,
  modelo text,
  numero_serie text,
  pertencimento text,
  responsavel text,
  localizacao text,
  estado text not null default 'Bom' check (estado in ('Bom','Regular','Ruim','Inoperante')),
  situacao text not null default 'Disponível' check (situacao in ('Disponível','Em uso','Manutenção','Baixado')),
  valor numeric(12,2) check (valor is null or valor >= 0),
  observacoes text,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movimentacoes (
  id uuid primary key default gen_random_uuid(),
  equipamento_id uuid not null references public.equipamentos(id) on delete restrict,
  tipo text not null check (tipo in ('Retirada','Devolução')),
  responsavel text not null,
  destino text,
  retirada_em timestamptz,
  previsao_devolucao timestamptz,
  devolucao_em timestamptz,
  estado_retirada text check (estado_retirada is null or estado_retirada in ('Bom','Regular','Ruim','Inoperante')),
  estado_devolucao text check (estado_devolucao is null or estado_devolucao in ('Bom','Regular','Ruim','Inoperante')),
  observacoes text,
  observacoes_devolucao text,
  registrado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists equipamentos_situacao_idx on public.equipamentos(situacao);
create index if not exists movimentacoes_equipamento_idx on public.movimentacoes(equipamento_id);
create index if not exists movimentacoes_created_idx on public.movimentacoes(created_at desc);

alter table public.equipamentos enable row level security;
alter table public.movimentacoes enable row level security;
drop policy if exists "authenticated read equipment" on public.equipamentos;
create policy "authenticated read equipment" on public.equipamentos for select to authenticated using (true);
drop policy if exists "authenticated insert equipment" on public.equipamentos;
create policy "authenticated insert equipment" on public.equipamentos for insert to authenticated with check (true);
drop policy if exists "authenticated update equipment" on public.equipamentos;
create policy "authenticated update equipment" on public.equipamentos for update to authenticated using (true) with check (true);
drop policy if exists "authenticated delete equipment" on public.equipamentos;
create policy "authenticated delete equipment" on public.equipamentos for delete to authenticated using (true);
drop policy if exists "authenticated read movements" on public.movimentacoes;
create policy "authenticated read movements" on public.movimentacoes for select to authenticated using (true);
drop policy if exists "authenticated insert movements" on public.movimentacoes;
create policy "authenticated insert movements" on public.movimentacoes for insert to authenticated with check (true);
drop policy if exists "authenticated update movements" on public.movimentacoes;
create policy "authenticated update movements" on public.movimentacoes for update to authenticated using (true) with check (true);

-- Operações transacionais: evita registrar retirada/devolução parcialmente.
create or replace function public.registrar_retirada(
 p_equipamento_id uuid, p_responsavel text, p_destino text,
 p_retirada_em timestamptz, p_previsao_devolucao timestamptz,
 p_estado_retirada text, p_observacoes text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 update equipamentos set situacao='Em uso', updated_at=now()
  where id=p_equipamento_id and situacao='Disponível';
 if not found then raise exception 'Equipamento não está disponível ou não existe'; end if;
 insert into movimentacoes(equipamento_id,tipo,responsavel,destino,retirada_em,previsao_devolucao,estado_retirada,observacoes,registrado_por)
 values(p_equipamento_id,'Retirada',p_responsavel,p_destino,p_retirada_em,p_previsao_devolucao,p_estado_retirada,p_observacoes,auth.uid()) returning id into v_id;
 return v_id;
end; $$;
create or replace function public.registrar_devolucao(
 p_movimentacao_id uuid, p_devolucao_em timestamptz,
 p_estado_devolucao text, p_observacoes_devolucao text
) returns void language plpgsql security invoker set search_path = public as $$
declare v_equipamento_id uuid;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
 select equipamento_id into v_equipamento_id from movimentacoes
  where id=p_movimentacao_id and tipo='Retirada' and devolucao_em is null for update;
 if not found then raise exception 'Retirada não encontrada ou já devolvida'; end if;
 update movimentacoes set devolucao_em=p_devolucao_em, estado_devolucao=p_estado_devolucao,
  observacoes_devolucao=p_observacoes_devolucao where id=p_movimentacao_id;
 update equipamentos set situacao=case when p_estado_devolucao='Inoperante' or p_estado_devolucao='Ruim' then 'Manutenção' else 'Disponível' end,
  estado=p_estado_devolucao, updated_at=now() where id=v_equipamento_id;
 insert into movimentacoes(equipamento_id,tipo,responsavel,retirada_em,devolucao_em,estado_devolucao,observacoes,registrado_por)
 select equipamento_id,'Devolução',responsavel,retirada_em,p_devolucao_em,p_estado_devolucao,p_observacoes_devolucao,auth.uid()
 from movimentacoes where id=p_movimentacao_id;
end; $$;
revoke all on function public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) from public;
grant execute on function public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) to authenticated;
revoke all on function public.registrar_devolucao(uuid,timestamptz,text,text) from public;
grant execute on function public.registrar_devolucao(uuid,timestamptz,text,text) to authenticated;
