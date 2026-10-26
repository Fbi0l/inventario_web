-- Atualização 1.4.0: convites seguros para autocadastro.
-- Execute no SQL Editor do projeto Supabase ANTES de publicar as funções.
create table if not exists public.convites_cadastro (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 criado_por uuid not null references auth.users(id),
 criado_em timestamptz not null default now(),
 expira_em timestamptz not null,
 usado_em timestamptz,
 usado_por uuid references auth.users(id),
 reservado_em timestamptz,
 reserva_id uuid
);
alter table public.convites_cadastro enable row level security;
revoke all on public.convites_cadastro from public, anon, authenticated;
grant all on public.convites_cadastro to service_role;
create index if not exists convites_cadastro_expira_idx on public.convites_cadastro(expira_em);
-- Chamada exclusivamente pela Edge Function com service_role.
create or replace function public.reservar_convite_cadastro(p_hash text, p_reserva uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
    and auth.role() is distinct from 'service_role' then
   raise exception 'Acesso negado.';
 end if;
 update public.convites_cadastro set reservado_em=now(),reserva_id=p_reserva
 where token_hash=p_hash and usado_em is null and expira_em>now()
   and (reservado_em is null or reservado_em<now()-interval '5 minutes');
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
create or replace function public.finalizar_convite_cadastro(p_hash text,p_reserva uuid,p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
    and auth.role() is distinct from 'service_role' then
   raise exception 'Acesso negado.';
 end if;
 update public.convites_cadastro
 set usado_em=now(),usado_por=p_user,reservado_em=null,reserva_id=null
 where token_hash=p_hash and reserva_id=p_reserva and usado_em is null;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
create or replace function public.liberar_convite_cadastro(p_hash text,p_reserva uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
    and auth.role() is distinct from 'service_role' then
   raise exception 'Acesso negado.';
 end if;
 update public.convites_cadastro set reservado_em=null,reserva_id=null
 where token_hash=p_hash and reserva_id=p_reserva and usado_em is null;
end $$;
revoke all on function public.reservar_convite_cadastro(text,uuid) from public,anon,authenticated;
revoke all on function public.finalizar_convite_cadastro(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.liberar_convite_cadastro(text,uuid) from public,anon,authenticated;
grant execute on function public.reservar_convite_cadastro(text,uuid) to service_role;
grant execute on function public.finalizar_convite_cadastro(text,uuid,uuid) to service_role;
grant execute on function public.liberar_convite_cadastro(text,uuid) to service_role;
