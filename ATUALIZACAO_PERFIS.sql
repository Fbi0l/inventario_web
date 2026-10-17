-- ATUALIZAÇÃO DE PERFIS - INVENTÁRIO WEB
-- Execute apenas uma vez no SQL Editor do projeto já existente.
-- IMPORTANTE: substitua usuario@inventariosys.com abaixo pelo email exato do administrador.
-- Este script NAO exclui registros de equipamentos nem movimentacoes.
-- Nao execute novamente o arquivo antigo supabase_schema_original_NAO_EXECUTAR.sql.

begin;

create table if not exists public.perfis_usuarios (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  perfil text not null check (perfil in ('administrador','operador','consulta')),
  atualizado_em timestamptz not null default now()
);

-- Contas antigas que nao sao o administrador comecam em Consulta (menor privilegio).
insert into public.perfis_usuarios (usuario_id, perfil)
select id, 'consulta' from auth.users
on conflict (usuario_id) do nothing;

-- Promove o administrador inicial explicitamente, sem depender do frontend.
-- Verifica a existencia ANTES de aplicar as restricoes.
do $$
begin
  if not exists (
    select 1 from auth.users
    where lower(email) = lower('usuario@inventariosys.com')
  ) then
    raise exception 'Administrador nao encontrado. Substitua usuario@inventariosys.com pelo e-mail de login existente antes de executar.';
  end if;
end $$;

insert into public.perfis_usuarios (usuario_id, perfil, atualizado_em)
select id, 'administrador', now() from auth.users
where lower(email) = lower('usuario@inventariosys.com')
on conflict (usuario_id) do update
set perfil = 'administrador', atualizado_em = now();

alter table public.perfis_usuarios enable row level security;
revoke all on table public.perfis_usuarios from anon, authenticated;
grant select on public.perfis_usuarios to authenticated;

drop policy if exists "visualizar proprio perfil" on public.perfis_usuarios;
create policy "visualizar proprio perfil" on public.perfis_usuarios
for select to authenticated using (usuario_id = (select auth.uid()));

-- Funcao segura de consulta: usuarios nao podem modificar seu proprio perfil.
create or replace function public.meu_perfil()
returns text language sql stable security definer set search_path = '' as $$
  select perfil from public.perfis_usuarios where usuario_id = (select auth.uid());
$$;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.meu_perfil() to authenticated;

-- Retira permissoes antigas em que todo usuario autenticado podia alterar dados.
drop policy if exists "authenticated read equipment" on public.equipamentos;
drop policy if exists "authenticated insert equipment" on public.equipamentos;
drop policy if exists "authenticated update equipment" on public.equipamentos;
drop policy if exists "authenticated delete equipment" on public.equipamentos;
drop policy if exists "authenticated read movements" on public.movimentacoes;
drop policy if exists "authenticated insert movements" on public.movimentacoes;
drop policy if exists "authenticated update movements" on public.movimentacoes;

alter table public.equipamentos enable row level security;
alter table public.movimentacoes enable row level security;

drop policy if exists "equipamentos leitura por perfil" on public.equipamentos;
create policy "equipamentos leitura por perfil" on public.equipamentos
for select to authenticated using ((select public.meu_perfil()) is not null);
drop policy if exists "equipamentos inserir administrador" on public.equipamentos;
create policy "equipamentos inserir administrador" on public.equipamentos
for insert to authenticated with check ((select public.meu_perfil()) = 'administrador');
drop policy if exists "equipamentos atualizar administrador" on public.equipamentos;
create policy "equipamentos atualizar administrador" on public.equipamentos
for update to authenticated using ((select public.meu_perfil()) = 'administrador')
with check ((select public.meu_perfil()) = 'administrador');
drop policy if exists "equipamentos excluir administrador" on public.equipamentos;
create policy "equipamentos excluir administrador" on public.equipamentos
for delete to authenticated using ((select public.meu_perfil()) = 'administrador');

drop policy if exists "movimentacoes leitura por perfil" on public.movimentacoes;
create policy "movimentacoes leitura por perfil" on public.movimentacoes
for select to authenticated using ((select public.meu_perfil()) is not null);
drop policy if exists "movimentacoes inserir administrador" on public.movimentacoes;
create policy "movimentacoes inserir administrador" on public.movimentacoes
for insert to authenticated with check ((select public.meu_perfil()) = 'administrador');
drop policy if exists "movimentacoes atualizar administrador" on public.movimentacoes;
create policy "movimentacoes atualizar administrador" on public.movimentacoes
for update to authenticated using ((select public.meu_perfil()) = 'administrador')
with check ((select public.meu_perfil()) = 'administrador');
-- Retorna erro/zero linhas para tentativas de exclusao por nao administradores.
drop policy if exists "movimentacoes excluir administrador" on public.movimentacoes;
create policy "movimentacoes excluir administrador" on public.movimentacoes
for delete to authenticated using ((select public.meu_perfil()) = 'administrador');

-- Operadores so alteram status e movimentacoes por meio destas duas operacoes
-- atomicas; o SECURITY DEFINER e seguro porque verifica explicitamente o perfil,
-- os parametros e restringe a acao a equipamentos em situacao apropriada.
create or replace function public.registrar_retirada(
 p_equipamento_id uuid, p_responsavel text, p_destino text,
 p_retirada_em timestamptz, p_previsao_devolucao timestamptz,
 p_estado_retirada text, p_observacoes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if coalesce((select public.meu_perfil()), '') not in ('administrador','operador')
    or (select auth.uid()) is null then
   raise exception 'Sem permissao para registrar retirada';
 end if;
 if p_responsavel is null or btrim(p_responsavel) = ''
    or p_retirada_em is null
    or coalesce(p_estado_retirada, '') not in ('Bom','Regular','Ruim','Inoperante') then
   raise exception 'Dados de retirada invalidos';
 end if;
 update public.equipamentos set situacao = 'Em uso', updated_at = now()
 where id = p_equipamento_id and situacao = 'Disponível';
 if not found then raise exception 'Equipamento nao disponivel ou inexistente'; end if;
 insert into public.movimentacoes (
    equipamento_id,tipo,responsavel,destino,retirada_em,
    previsao_devolucao,estado_retirada,observacoes,registrado_por
 ) values (
    p_equipamento_id,'Retirada',btrim(p_responsavel),p_destino,p_retirada_em,
    p_previsao_devolucao,p_estado_retirada,p_observacoes,(select auth.uid())
 ) returning id into v_id;
 return v_id;
end; $$;

create or replace function public.registrar_devolucao(
 p_movimentacao_id uuid, p_devolucao_em timestamptz,
 p_estado_devolucao text, p_observacoes_devolucao text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_equipamento_id uuid;
begin
 if coalesce((select public.meu_perfil()), '') not in ('administrador','operador')
    or (select auth.uid()) is null then
   raise exception 'Sem permissao para registrar devolucao';
 end if;
 if p_devolucao_em is null or coalesce(p_estado_devolucao, '') not in ('Bom','Regular','Ruim','Inoperante') then
   raise exception 'Dados de devolucao invalidos';
 end if;
 select equipamento_id into v_equipamento_id from public.movimentacoes
 where id = p_movimentacao_id and tipo = 'Retirada' and devolucao_em is null
 for update;
 if not found then raise exception 'Retirada nao encontrada ou ja devolvida'; end if;
 update public.movimentacoes set
    devolucao_em = p_devolucao_em,
    estado_devolucao = p_estado_devolucao,
    observacoes_devolucao = p_observacoes_devolucao
 where id = p_movimentacao_id;
 update public.equipamentos set
    situacao = case when p_estado_devolucao in ('Ruim','Inoperante') then 'Manutenção' else 'Disponível' end,
    estado = p_estado_devolucao, updated_at = now()
 where id = v_equipamento_id and situacao = 'Em uso';
 if not found then raise exception 'Equipamento nao esta em uso'; end if;
 insert into public.movimentacoes (
    equipamento_id,tipo,responsavel,retirada_em,devolucao_em,
    estado_devolucao,observacoes,registrado_por
 ) select equipamento_id,'Devolução',responsavel,retirada_em,
    p_devolucao_em,p_estado_devolucao,p_observacoes_devolucao,(select auth.uid())
 from public.movimentacoes where id = p_movimentacao_id;
end; $$;

revoke all on function public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) from public, anon;
grant execute on function public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) to authenticated;
revoke all on function public.registrar_devolucao(uuid,timestamptz,text,text) from public, anon;
grant execute on function public.registrar_devolucao(uuid,timestamptz,text,text) to authenticated;

commit;
