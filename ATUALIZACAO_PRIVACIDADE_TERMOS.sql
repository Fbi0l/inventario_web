-- Versao 1.4.0: associacao segura entre termo e titular cadastrado.
BEGIN;
ALTER TABLE public.termos_equipamentos
  ADD COLUMN IF NOT EXISTS retirante_usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Apenas correspondencia de CPF unico permite preencher a titularidade antiga.
UPDATE public.termos_equipamentos AS t
SET retirante_usuario_id = d.usuario_id
FROM (SELECT cpf, min(usuario_id::text)::uuid AS usuario_id
      FROM public.dados_retirantes GROUP BY cpf HAVING count(*) = 1) AS d
WHERE t.retirante_usuario_id IS NULL
  AND (t.dados #>> '{retirante,cpf}')=d.cpf;
CREATE INDEX IF NOT EXISTS termos_equipamentos_titular_idx
  ON public.termos_equipamentos(retirante_usuario_id);

-- Consulta PDF condicionada a titularidade, no servidor.
CREATE OR REPLACE FUNCTION public.obter_termo_equipamento(p_movimentacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $
DECLARE v_dados jsonb; v_perfil text;
BEGIN
 v_perfil:=coalesce(public.meu_perfil(),'');
 IF auth.uid() IS NULL OR v_perfil NOT IN ('administrador','operador','consulta') THEN
  RAISE EXCEPTION 'Acesso negado.';
 END IF;
 SELECT t.dados INTO v_dados
 FROM public.termos_equipamentos t JOIN public.movimentacoes m ON m.id=t.movimentacao_id
 WHERE m.id=p_movimentacao_id AND m.tipo='Retirada' AND m.devolucao_em IS NOT NULL
 AND (m.ciclo_arquivado_id IS NULL OR v_perfil='administrador')
 AND (v_perfil='administrador' OR t.retirante_usuario_id=auth.uid());
 IF v_dados IS NULL OR NOT (v_dados ? 'devolucao_em') THEN
  RAISE EXCEPTION 'Termo indisponivel ou acesso nao autorizado.';
 END IF;
 RETURN v_dados;
END; $;

CREATE OR REPLACE FUNCTION public.listar_termos_por_dia(p_inicio timestamptz,p_fim timestamptz,p_acao text)
RETURNS TABLE(movimentacao_id uuid,acao_em timestamptz,tag text,patrimonio text,descricao text,responsavel text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $
DECLARE v_perfil text;
BEGIN
 v_perfil:=coalesce(public.meu_perfil(),'');
 IF auth.uid() IS NULL OR v_perfil NOT IN ('administrador','operador','consulta') THEN
  RAISE EXCEPTION 'Acesso negado.';
 END IF;
 IF p_acao NOT IN ('Retirada','Devolução') OR p_inicio IS NULL OR p_fim IS NULL
 OR p_inicio >= p_fim OR p_fim-p_inicio > interval '26 hours' THEN
  RAISE EXCEPTION 'Intervalo invalido.';
 END IF;
 RETURN QUERY SELECT m.id,
 CASE WHEN p_acao='Retirada' THEN m.retirada_em ELSE m.devolucao_em END,
 e.tag::text,e.patrimonio::text,e.descricao::text,m.responsavel::text
 FROM public.movimentacoes m JOIN public.termos_equipamentos t ON t.movimentacao_id=m.id
 LEFT JOIN public.equipamentos e ON e.id=m.equipamento_id
 WHERE m.ciclo_arquivado_id IS NULL AND m.tipo='Retirada' AND m.termo_versao IS NOT NULL
 AND m.devolucao_em IS NOT NULL AND t.dados ? 'devolucao_em'
 AND (v_perfil='administrador' OR t.retirante_usuario_id=auth.uid())
 AND (CASE WHEN p_acao='Retirada' THEN m.retirada_em ELSE m.devolucao_em END)>=p_inicio
 AND (CASE WHEN p_acao='Retirada' THEN m.retirada_em ELSE m.devolucao_em END)<p_fim
 ORDER BY 2 DESC LIMIT 10000;
END; $;
REVOKE ALL ON FUNCTION public.listar_termos_por_dia(timestamptz,timestamptz,text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.listar_termos_por_dia(timestamptz,timestamptz,text) TO authenticated;

COMMIT;
