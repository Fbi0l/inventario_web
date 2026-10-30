-- Atualizacao 1.5.4: convites pendentes de um administrador excluido sao cancelados.
-- Executar uma vez no SQL Editor do Supabase, apos backup.
-- Requer ATUALIZACAO_CONVITES_CADASTRO.sql e ATUALIZACAO_1_4_1_EXCLUSAO_USUARIOS.sql.
--
-- Ao excluir uma conta, convites_cadastro.criado_por vira NULL (ON DELETE SET NULL).
-- Antes, os convites ainda nao usados dessa conta continuavam validos por ate 48 h.
-- Agora, nesse momento, eles vencem na hora (como o botao "Cancelar"). Funciona
-- tambem para exclusoes feitas direto no painel do Supabase.
-- Convites ja usados continuam como historico, sem alteracao.
-- Esta migracao NAO exclui convites nem usuarios e nao altera convites existentes.
BEGIN;

CREATE OR REPLACE FUNCTION public.expirar_convites_autor_excluido()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.criado_por IS NOT NULL AND NEW.criado_por IS NULL
     AND NEW.usado_em IS NULL AND NEW.expira_em > now() THEN
    NEW.expira_em := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.expirar_convites_autor_excluido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_expirar_convites_autor_excluido ON public.convites_cadastro;
CREATE TRIGGER trg_expirar_convites_autor_excluido
  BEFORE UPDATE OF criado_por ON public.convites_cadastro
  FOR EACH ROW EXECUTE FUNCTION public.expirar_convites_autor_excluido();

COMMIT;

-- Conferencia (somente leitura): deve listar o gatilho novo.
SELECT tgname AS gatilho, tgenabled <> 'D' AS ativo
FROM pg_trigger WHERE tgname = 'trg_expirar_convites_autor_excluido';
-- Convites ainda validos cujo autor ja foi excluido (sobras de antes desta versao).
-- Se aparecer algum, cancele-o em Usuarios > Convites pendentes.
SELECT id, criado_em, expira_em
FROM public.convites_cadastro
WHERE criado_por IS NULL AND usado_em IS NULL AND expira_em > now();
