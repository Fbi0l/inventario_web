-- ATUALIZACAO: ARQUIVAMENTO REVERSIVEL POR CICLOS (2026)
-- Executar uma unica vez no Supabase SQL Editor, antes de publicar o frontend.
-- NAO executar novamente supabase_schema.sql nem ATUALIZACAO_PERFIS.sql.
-- Faz arquivamento logico (nao apaga equipamentos ou movimentacoes).
-- Requer as tabelas existentes e a funcao public.meu_perfil() da atualizacao de perfis.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ciclos_arquivados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  quantidade_equipamentos integer NOT NULL DEFAULT 0 CHECK (quantidade_equipamentos >= 0),
  quantidade_movimentacoes integer NOT NULL DEFAULT 0 CHECK (quantidade_movimentacoes >= 0),
  restaurado_em timestamptz,
  restaurado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.equipamentos
  ADD COLUMN IF NOT EXISTS ciclo_arquivado_id uuid REFERENCES public.ciclos_arquivados(id);
ALTER TABLE public.movimentacoes
  ADD COLUMN IF NOT EXISTS ciclo_arquivado_id uuid REFERENCES public.ciclos_arquivados(id);
CREATE INDEX IF NOT EXISTS equipamentos_ciclo_arquivado_idx ON public.equipamentos(ciclo_arquivado_id);
CREATE INDEX IF NOT EXISTS movimentacoes_ciclo_arquivado_idx ON public.movimentacoes(ciclo_arquivado_id);

-- TAGs devem ser unicas somente entre os equipamentos do ciclo ATIVO.
-- TAGs historicas ficam reservadas em seus proprios arquivos e podem ser usadas de novo.
ALTER TABLE public.equipamentos DROP CONSTRAINT IF EXISTS equipamentos_tag_key;
CREATE UNIQUE INDEX IF NOT EXISTS equipamentos_tag_ativo_unq
  ON public.equipamentos(tag) WHERE ciclo_arquivado_id IS NULL;

ALTER TABLE public.ciclos_arquivados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ciclos_arquivados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ciclos_arquivados TO authenticated;
DROP POLICY IF EXISTS "arquivos consulta administrador" ON public.ciclos_arquivados;
CREATE POLICY "arquivos consulta administrador" ON public.ciclos_arquivados
  FOR SELECT TO authenticated USING ((SELECT public.meu_perfil()) = 'administrador');

-- Nao permitir leitura de itens arquivados pelos perfis Operador/Consulta.
-- Somente administrador pode ver o historico.
DROP POLICY IF EXISTS "equipamentos leitura por perfil" ON public.equipamentos;
CREATE POLICY "equipamentos leitura por perfil" ON public.equipamentos
  FOR SELECT TO authenticated USING (
    ((SELECT public.meu_perfil()) IS NOT NULL AND ciclo_arquivado_id IS NULL)
    OR (SELECT public.meu_perfil()) = 'administrador'
  );
DROP POLICY IF EXISTS "movimentacoes leitura por perfil" ON public.movimentacoes;
CREATE POLICY "movimentacoes leitura por perfil" ON public.movimentacoes
  FOR SELECT TO authenticated USING (
    ((SELECT public.meu_perfil()) IS NOT NULL AND ciclo_arquivado_id IS NULL)
    OR (SELECT public.meu_perfil()) = 'administrador'
  );

-- Operacoes comuns permanecem limitadas aos dados ativos.
DROP POLICY IF EXISTS "equipamentos inserir administrador" ON public.equipamentos;
CREATE POLICY "equipamentos inserir administrador" ON public.equipamentos
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );
DROP POLICY IF EXISTS "equipamentos atualizar administrador" ON public.equipamentos;
CREATE POLICY "equipamentos atualizar administrador" ON public.equipamentos
  FOR UPDATE TO authenticated USING (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  ) WITH CHECK (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );
DROP POLICY IF EXISTS "equipamentos excluir administrador" ON public.equipamentos;
CREATE POLICY "equipamentos excluir administrador" ON public.equipamentos
  FOR DELETE TO authenticated USING (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );

DROP POLICY IF EXISTS "movimentacoes inserir administrador" ON public.movimentacoes;
CREATE POLICY "movimentacoes inserir administrador" ON public.movimentacoes
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );
DROP POLICY IF EXISTS "movimentacoes atualizar administrador" ON public.movimentacoes;
CREATE POLICY "movimentacoes atualizar administrador" ON public.movimentacoes
  FOR UPDATE TO authenticated USING (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  ) WITH CHECK (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );
DROP POLICY IF EXISTS "movimentacoes excluir administrador" ON public.movimentacoes;
CREATE POLICY "movimentacoes excluir administrador" ON public.movimentacoes
  FOR DELETE TO authenticated USING (
    (SELECT public.meu_perfil()) = 'administrador' AND ciclo_arquivado_id IS NULL
  );

-- Protege a relacao de uma movimentacao ativa com equipamento do ciclo atual.
CREATE OR REPLACE FUNCTION public.validar_movimentacao_ciclo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.ciclo_arquivado_id IS NULL AND EXISTS (
    SELECT 1 FROM public.equipamentos
    WHERE id = NEW.equipamento_id AND ciclo_arquivado_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Nao e permitido movimentar equipamento arquivado.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_validar_movimentacao_ciclo ON public.movimentacoes;
CREATE TRIGGER trg_validar_movimentacao_ciclo
  BEFORE INSERT OR UPDATE OF equipamento_id, ciclo_arquivado_id
  ON public.movimentacoes FOR EACH ROW EXECUTE FUNCTION public.validar_movimentacao_ciclo();

-- Funcao existente: agora recusa movimentar registros arquivados, mesmo com IDs antigos.
CREATE OR REPLACE FUNCTION public.registrar_retirada(
 p_equipamento_id uuid, p_responsavel text, p_destino text,
 p_retirada_em timestamptz, p_previsao_devolucao timestamptz,
 p_estado_retirada text, p_observacoes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 IF coalesce((SELECT public.meu_perfil()), '') NOT IN ('administrador','operador')
    OR (SELECT auth.uid()) IS NULL THEN
   RAISE EXCEPTION 'Sem permissao para registrar retirada';
 END IF;
 IF p_responsavel IS NULL OR btrim(p_responsavel) = ''
    OR p_retirada_em IS NULL
    OR coalesce(p_estado_retirada, '') NOT IN ('Bom','Regular','Ruim','Inoperante') THEN
   RAISE EXCEPTION 'Dados de retirada invalidos';
 END IF;
 UPDATE public.equipamentos SET situacao = 'Em uso', updated_at = now()
 WHERE id = p_equipamento_id AND ciclo_arquivado_id IS NULL AND situacao = 'Disponível';
 IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento nao disponivel, inexistente ou arquivado'; END IF;
 INSERT INTO public.movimentacoes (
    equipamento_id,tipo,responsavel,destino,retirada_em,
    previsao_devolucao,estado_retirada,observacoes,registrado_por
 ) VALUES (
    p_equipamento_id,'Retirada',btrim(p_responsavel),p_destino,p_retirada_em,
    p_previsao_devolucao,p_estado_retirada,p_observacoes,(SELECT auth.uid())
 ) RETURNING id INTO v_id;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.registrar_devolucao(
 p_movimentacao_id uuid, p_devolucao_em timestamptz,
 p_estado_devolucao text, p_observacoes_devolucao text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_equipamento_id uuid;
BEGIN
 IF coalesce((SELECT public.meu_perfil()), '') NOT IN ('administrador','operador')
    OR (SELECT auth.uid()) IS NULL THEN
   RAISE EXCEPTION 'Sem permissao para registrar devolucao';
 END IF;
 IF p_devolucao_em IS NULL OR coalesce(p_estado_devolucao, '') NOT IN ('Bom','Regular','Ruim','Inoperante') THEN
   RAISE EXCEPTION 'Dados de devolucao invalidos';
 END IF;
 SELECT equipamento_id INTO v_equipamento_id FROM public.movimentacoes
 WHERE id = p_movimentacao_id AND ciclo_arquivado_id IS NULL
   AND tipo = 'Retirada' AND devolucao_em IS NULL
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retirada nao encontrada, arquivada ou ja devolvida'; END IF;
 UPDATE public.movimentacoes SET
    devolucao_em = p_devolucao_em, estado_devolucao = p_estado_devolucao,
    observacoes_devolucao = p_observacoes_devolucao
 WHERE id = p_movimentacao_id;
 UPDATE public.equipamentos SET
    situacao = CASE WHEN p_estado_devolucao IN ('Ruim','Inoperante') THEN 'Manutenção' ELSE 'Disponível' END,
    estado = p_estado_devolucao, updated_at = now()
 WHERE id = v_equipamento_id AND ciclo_arquivado_id IS NULL AND situacao = 'Em uso';
 IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento arquivado ou nao esta em uso'; END IF;
 INSERT INTO public.movimentacoes (
    equipamento_id,tipo,responsavel,retirada_em,devolucao_em,
    estado_devolucao,observacoes,registrado_por
 ) SELECT equipamento_id,'Devolução',responsavel,retirada_em,
    p_devolucao_em,p_estado_devolucao,p_observacoes_devolucao,(SELECT auth.uid())
 FROM public.movimentacoes WHERE id = p_movimentacao_id AND ciclo_arquivado_id IS NULL;
END; $$;

REVOKE ALL ON FUNCTION public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_devolucao(uuid,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao(uuid,timestamptz,text,text) TO authenticated;

-- Arquiva equipamentos + movimentacoes na MESMA transacao.
-- Bloqueia arquivos com retiradas em aberto / equipamentos em uso.
CREATE OR REPLACE FUNCTION public.arquivar_inventario(p_nome text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_id uuid;
 v_equip integer;
 v_mov integer;
BEGIN
 IF coalesce((SELECT public.meu_perfil()), '') <> 'administrador' OR (SELECT auth.uid()) IS NULL THEN
   RAISE EXCEPTION 'Somente administradores podem arquivar o inventario.';
 END IF;
 LOCK TABLE public.equipamentos, public.movimentacoes IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM public.equipamentos WHERE ciclo_arquivado_id IS NULL AND situacao = 'Em uso')
    OR EXISTS (SELECT 1 FROM public.movimentacoes WHERE ciclo_arquivado_id IS NULL AND tipo = 'Retirada' AND devolucao_em IS NULL) THEN
   RAISE EXCEPTION 'Existem retiradas em aberto ou equipamentos em uso. Registre as devolucoes antes de arquivar.';
 END IF;
 SELECT count(*) INTO v_equip FROM public.equipamentos WHERE ciclo_arquivado_id IS NULL;
 SELECT count(*) INTO v_mov FROM public.movimentacoes WHERE ciclo_arquivado_id IS NULL;
 IF v_equip = 0 AND v_mov = 0 THEN
   RAISE EXCEPTION 'Nao existem registros ativos para arquivar.';
 END IF;
 INSERT INTO public.ciclos_arquivados(nome, criado_por, quantidade_equipamentos, quantidade_movimentacoes)
 VALUES (
   coalesce(nullif(btrim(left(p_nome,120)), ''), 'Arquivo de ' || to_char(now(),'DD/MM/YYYY HH24:MI')),
   (SELECT auth.uid()), v_equip, v_mov
 ) RETURNING id INTO v_id;
 UPDATE public.equipamentos SET ciclo_arquivado_id = v_id WHERE ciclo_arquivado_id IS NULL;
 UPDATE public.movimentacoes SET ciclo_arquivado_id = v_id WHERE ciclo_arquivado_id IS NULL;
 RETURN v_id;
END; $$;

-- Restaurar somente com listas ATIVAS vazias para evitar misturar ciclos.
CREATE OR REPLACE FUNCTION public.restaurar_inventario(p_ciclo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF coalesce((SELECT public.meu_perfil()), '') <> 'administrador' OR (SELECT auth.uid()) IS NULL THEN
   RAISE EXCEPTION 'Somente administradores podem restaurar o inventario.';
 END IF;
 IF p_ciclo_id IS NULL THEN RAISE EXCEPTION 'Arquivo invalido.'; END IF;
 LOCK TABLE public.equipamentos, public.movimentacoes IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.ciclos_arquivados
  WHERE id = p_ciclo_id AND restaurado_em IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Arquivo inexistente ou ja restaurado.'; END IF;
 IF EXISTS (SELECT 1 FROM public.equipamentos WHERE ciclo_arquivado_id IS NULL)
   OR EXISTS (SELECT 1 FROM public.movimentacoes WHERE ciclo_arquivado_id IS NULL) THEN
   RAISE EXCEPTION 'O ciclo atual nao esta vazio. Arquive-o primeiro para restaurar um arquivo anterior.';
 END IF;
 UPDATE public.equipamentos SET ciclo_arquivado_id = NULL WHERE ciclo_arquivado_id = p_ciclo_id;
 UPDATE public.movimentacoes SET ciclo_arquivado_id = NULL WHERE ciclo_arquivado_id = p_ciclo_id;
 UPDATE public.ciclos_arquivados SET restaurado_em = now(), restaurado_por = (SELECT auth.uid())
   WHERE id = p_ciclo_id;
END; $$;

REVOKE ALL ON FUNCTION public.arquivar_inventario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arquivar_inventario(text) TO authenticated;
REVOKE ALL ON FUNCTION public.restaurar_inventario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurar_inventario(uuid) TO authenticated;

COMMIT;
