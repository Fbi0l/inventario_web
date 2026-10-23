-- Executar no SQL Editor do Supabase apos ATUALIZACAO_ARQUIVAMENTO_CICLOS.sql.
-- Instala a funcao; executar este arquivo NAO exclui nenhum periodo.
BEGIN;
CREATE OR REPLACE FUNCTION public.excluir_ciclo_arquivado(p_ciclo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR coalesce((SELECT public.meu_perfil()), '') <> 'administrador' THEN
    RAISE EXCEPTION 'Somente administradores podem excluir periodos arquivados.';
  END IF;
  IF p_ciclo_id IS NULL THEN RAISE EXCEPTION 'Periodo invalido.'; END IF;
  -- Mesma ordem de bloqueio usada pelo arquivamento e pela restauracao.
  LOCK TABLE public.equipamentos, public.movimentacoes IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM public.ciclos_arquivados WHERE id = p_ciclo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periodo inexistente ou ja excluido.'; END IF;
  -- Recusa inconsistencias que poderiam atingir movimentacoes de outro ciclo.
  IF EXISTS (
    SELECT 1 FROM public.movimentacoes m
    JOIN public.equipamentos e ON e.id = m.equipamento_id
    WHERE e.ciclo_arquivado_id = p_ciclo_id
      AND m.ciclo_arquivado_id IS DISTINCT FROM p_ciclo_id
  ) THEN
    RAISE EXCEPTION 'Existem movimentacoes de outro ciclo vinculadas a este arquivo. Exclusao cancelada.';
  END IF;
  DELETE FROM public.movimentacoes WHERE ciclo_arquivado_id = p_ciclo_id;
  DELETE FROM public.equipamentos WHERE ciclo_arquivado_id = p_ciclo_id;
  -- A restauracao remove os vinculos acima. Nesse caso, so a referencia e excluida.
  DELETE FROM public.ciclos_arquivados WHERE id = p_ciclo_id;
END; $$;
REVOKE ALL ON FUNCTION public.excluir_ciclo_arquivado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_ciclo_arquivado(uuid) TO authenticated;
COMMIT;
