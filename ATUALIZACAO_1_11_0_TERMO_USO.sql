-- ATUALIZAÇÃO 1.11.0 - TERMO DE USO DO SISTEMA (LGPD)
-- Execute uma vez no SQL Editor do projeto. Pode ser executado de novo sem efeito colateral.
-- Cada usuário aceita o termo de uso no primeiro acesso e de novo sempre que a versão mudar.
-- Não confundir com o termo de responsabilidade dos equipamentos (termos_equipamentos).
-- Não altera equipamentos, movimentações, termos de responsabilidade nem dados dos retirantes.
begin;

alter table public.perfis_usuarios
  add column if not exists termo_uso_versao text,
  add column if not exists termo_uso_aceito_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_usuarios_termo_uso_versao_formato') then
    alter table public.perfis_usuarios add constraint perfis_usuarios_termo_uso_versao_formato
      check (termo_uso_versao is null or termo_uso_versao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  end if;
end $$;

-- O usuário não altera o próprio perfil. Esta função grava só o aceite, só na linha de quem está logado
-- e só para quem tem perfil. Não grava CPF, telefone nem nada além da versão e da data.
create or replace function public.aceitar_termo_uso(p_versao text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if p_versao is null or p_versao !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Versão do termo inválida.' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or public.meu_perfil() is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  update public.perfis_usuarios
     set termo_uso_versao = p_versao, termo_uso_aceito_em = now()
   where usuario_id = (select auth.uid());
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
revoke all on function public.aceitar_termo_uso(text) from public, anon;
grant execute on function public.aceitar_termo_uso(text) to authenticated;

commit;
