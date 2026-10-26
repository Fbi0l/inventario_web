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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
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


-- Em todas as novas retiradas o ID e salvo na mesma transacao.
CREATE OR REPLACE FUNCTION public.registrar_retirada_termo(
 p_equipamento_id uuid,p_retirante_id uuid,p_destino text,p_retirada_em timestamptz,
 p_previsao_devolucao timestamptz,p_estado_retirada text,p_observacoes text,
 p_local_acao text,p_avarias_retirada boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE r public.dados_retirantes; e public.equipamentos; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.meu_perfil(),'') NOT IN ('administrador','operador') THEN RAISE EXCEPTION 'Sem permissao para retirar.'; END IF;
 IF char_length(btrim(coalesce(p_local_acao,''))) NOT BETWEEN 1 AND 150
 OR char_length(coalesce(p_destino,''))>150 OR char_length(coalesce(p_observacoes,''))>2000
 OR p_avarias_retirada IS NULL THEN RAISE EXCEPTION 'Confira os dados da retirada.'; END IF;
 SELECT d.* INTO r FROM public.dados_retirantes d JOIN auth.users u ON u.id=d.usuario_id
 JOIN public.perfis_usuarios p ON p.usuario_id=d.usuario_id
 WHERE d.usuario_id=p_retirante_id AND u.deleted_at IS NULL
 AND (u.banned_until IS NULL OR u.banned_until<now());
 IF NOT FOUND THEN RAISE EXCEPTION 'Retirante sem cadastro completo ou conta bloqueada.'; END IF;
 v_id:=public.registrar_retirada(p_equipamento_id,r.nome,p_destino,p_retirada_em,
 p_previsao_devolucao,p_estado_retirada,p_observacoes);
 SELECT * INTO e FROM public.equipamentos WHERE id=p_equipamento_id;
 INSERT INTO public.termos_equipamentos(movimentacao_id,dados,retirante_usuario_id)
 VALUES(v_id,jsonb_build_object(
 'versao',1,'id',v_id,'retirante',jsonb_build_object('nome',r.nome,'cpf',r.cpf,'telefone',r.telefone),
 'equipamento',jsonb_build_object('descricao',e.descricao,'patrimonio',e.patrimonio,'numero_serie',e.numero_serie,'tag',e.tag),
 'local_acao',btrim(p_local_acao),'destino',p_destino,'retirada_em',p_retirada_em,
 'estado_retirada',p_estado_retirada,'avarias_retirada',p_avarias_retirada,'observacoes',p_observacoes));
 UPDATE public.movimentacoes SET termo_versao=1 WHERE id=v_id;
 RETURN v_id;
END; $;

-- A listagem da tabela de movimentacoes pode continuar mostrando todas as operacoes,
-- mas o botao PDF deve ficar disponivel somente para os IDs retornados.
CREATE OR REPLACE FUNCTION public.listar_termos_visiveis(p_ids uuid[])
RETURNS TABLE(movimentacao_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_perfil text;
BEGIN
 v_perfil:=coalesce(public.meu_perfil(),'');
 IF auth.uid() IS NULL OR v_perfil NOT IN ('administrador','operador','consulta') THEN
  RAISE EXCEPTION 'Acesso negado.';
 END IF;
 IF coalesce(cardinality(p_ids),0)>500 THEN RAISE EXCEPTION 'Lista muito extensa.'; END IF;
 RETURN QUERY SELECT m.id FROM public.movimentacoes m
 JOIN public.termos_equipamentos t ON t.movimentacao_id=m.id
 WHERE m.id=ANY(coalesce(p_ids,ARRAY[]::uuid[]))
 AND m.ciclo_arquivado_id IS NULL AND m.tipo='Retirada' AND m.termo_versao IS NOT NULL
 AND m.devolucao_em IS NOT NULL AND t.dados ? 'devolucao_em'
 AND (v_perfil='administrador' OR t.retirante_usuario_id=auth.uid());
END; $;
REVOKE ALL ON FUNCTION public.listar_termos_visiveis(uuid[]) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.listar_termos_visiveis(uuid[]) TO authenticated;


-- O arquivo modelo e privado e nao contem dados de outros usuarios.
CREATE OR REPLACE FUNCTION public.pode_ler_modelo_termo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT auth.uid() IS NOT NULL AND coalesce(public.meu_perfil(),'')
 IN ('administrador','operador','consulta');
$fn$;
REVOKE ALL ON FUNCTION public.pode_ler_modelo_termo() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pode_ler_modelo_termo() TO authenticated;

COMMIT;
