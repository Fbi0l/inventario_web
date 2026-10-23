-- Executar depois das atualizacoes de perfis e arquivamento. Nao apaga dados.
BEGIN;
CREATE OR REPLACE FUNCTION public.cpf_valido(p_cpf text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s integer; d integer; i integer; j integer;
BEGIN
 IF p_cpf IS NULL OR p_cpf !~ '^[0-9]{11}$' OR p_cpf = repeat(substr(p_cpf,1,1),11) THEN RETURN false; END IF;
 FOR j IN 10..11 LOOP
  s:=0;
  FOR i IN 1..j-1 LOOP s:=s+substr(p_cpf,i,1)::integer*(j+1-i); END LOOP;
  d:=(s*10)%11; IF d=10 THEN d:=0; END IF;
  IF d<>substr(p_cpf,j,1)::integer THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END; $$;
CREATE TABLE IF NOT EXISTS public.dados_retirantes (
 usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 3 AND 150),
 cpf text NOT NULL CHECK (public.cpf_valido(cpf)),
 telefone text NOT NULL DEFAULT '' CHECK (char_length(telefone)<=30),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dados_retirantes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dados_retirantes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dados_retirantes TO authenticated;
GRANT ALL ON public.dados_retirantes TO service_role;
DROP POLICY IF EXISTS "dados pessoais administrador" ON public.dados_retirantes;
CREATE POLICY "dados pessoais administrador" ON public.dados_retirantes FOR SELECT TO authenticated
 USING ((SELECT public.meu_perfil())='administrador');
ALTER TABLE public.movimentacoes ADD COLUMN IF NOT EXISTS termo_versao integer;
CREATE TABLE IF NOT EXISTS public.termos_equipamentos (
 movimentacao_id uuid PRIMARY KEY REFERENCES public.movimentacoes(id) ON DELETE CASCADE,
 dados jsonb NOT NULL
);
ALTER TABLE public.termos_equipamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.termos_equipamentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.termos_equipamentos TO service_role;
-- O acesso ao conteudo pessoal ocorre somente pela funcao obter_termo_equipamento.
CREATE OR REPLACE FUNCTION public.listar_retirantes()
RETURNS TABLE(usuario_id uuid,nome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF (SELECT auth.uid()) IS NULL OR coalesce(public.meu_perfil(),'') NOT IN ('administrador','operador') THEN
  RAISE EXCEPTION 'Sem permissao para consultar retirantes.';
 END IF;
 RETURN QUERY SELECT d.usuario_id,d.nome FROM public.dados_retirantes d
 JOIN auth.users u ON u.id=d.usuario_id JOIN public.perfis_usuarios p ON p.usuario_id=d.usuario_id
 WHERE u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<now()) ORDER BY d.nome,d.usuario_id;
END; $$;
CREATE OR REPLACE FUNCTION public.registrar_retirada_termo(
 p_equipamento_id uuid,p_retirante_id uuid,p_destino text,p_retirada_em timestamptz,
 p_previsao_devolucao timestamptz,p_estado_retirada text,p_observacoes text,p_local_acao text,
 p_avarias_retirada boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.dados_retirantes; e public.equipamentos; v_id uuid;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR coalesce(public.meu_perfil(),'') NOT IN ('administrador','operador') THEN RAISE EXCEPTION 'Sem permissao para retirar.'; END IF;
 IF char_length(btrim(coalesce(p_local_acao,''))) NOT BETWEEN 1 AND 150
 OR char_length(coalesce(p_destino,''))>150 OR char_length(coalesce(p_observacoes,''))>2000
 OR p_avarias_retirada IS NULL THEN RAISE EXCEPTION 'Informe o local da acao e confira os dados.'; END IF;
 SELECT d.* INTO r FROM public.dados_retirantes d JOIN auth.users u ON u.id=d.usuario_id
 JOIN public.perfis_usuarios p ON p.usuario_id=d.usuario_id
 WHERE d.usuario_id=p_retirante_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<now());
 IF NOT FOUND THEN RAISE EXCEPTION 'Retirante sem cadastro completo ou conta bloqueada. Solicite a atualizacao ao administrador.'; END IF;
 -- Registra movimento e snapshot na mesma transacao; nao recebe CPF do navegador.
 v_id:=public.registrar_retirada(p_equipamento_id,r.nome,p_destino,p_retirada_em,p_previsao_devolucao,p_estado_retirada,p_observacoes);
 SELECT * INTO e FROM public.equipamentos WHERE id=p_equipamento_id;
 INSERT INTO public.termos_equipamentos VALUES(v_id,jsonb_build_object(
 'versao',1,'id',v_id,'retirante',jsonb_build_object('nome',r.nome,'cpf',r.cpf,'telefone',r.telefone),
 'equipamento',jsonb_build_object('descricao',e.descricao,'patrimonio',e.patrimonio,'numero_serie',e.numero_serie,'tag',e.tag),
 'local_acao',btrim(p_local_acao),'destino',p_destino,'retirada_em',p_retirada_em,
 'estado_retirada',p_estado_retirada,'avarias_retirada',p_avarias_retirada,'observacoes',p_observacoes));
 UPDATE public.movimentacoes SET termo_versao=1 WHERE id=v_id;
 RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION public.registrar_devolucao_termo(
 p_movimentacao_id uuid,p_devolucao_em timestamptz,p_estado_devolucao text,
 p_observacoes_devolucao text,p_ocorrencia text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_nome text; v_retirada timestamptz;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR coalesce(public.meu_perfil(),'') NOT IN ('administrador','operador') THEN RAISE EXCEPTION 'Sem permissao para devolver.'; END IF;
 IF coalesce(p_ocorrencia,'') NOT IN ('Sem alterações aparentes','Com avarias','Incompleto')
 OR char_length(coalesce(p_observacoes_devolucao,''))>2000 THEN RAISE EXCEPTION 'Ocorrencia invalida.'; END IF;
 SELECT nome INTO v_nome FROM public.dados_retirantes WHERE usuario_id=(SELECT auth.uid());
 IF v_nome IS NULL THEN RAISE EXCEPTION 'Solicite ao administrador que complete seu cadastro para identificar o conferente.'; END IF;
 SELECT retirada_em INTO v_retirada FROM public.movimentacoes WHERE id=p_movimentacao_id FOR UPDATE;
 IF p_devolucao_em<v_retirada THEN RAISE EXCEPTION 'A devolucao nao pode ser anterior a retirada.'; END IF;
 PERFORM public.registrar_devolucao(p_movimentacao_id,p_devolucao_em,p_estado_devolucao,p_observacoes_devolucao);
 UPDATE public.termos_equipamentos SET dados=dados||jsonb_build_object(
 'devolucao_em',p_devolucao_em,'estado_devolucao',p_estado_devolucao,'ocorrencia_devolucao',p_ocorrencia,
 'observacoes_devolucao',p_observacoes_devolucao,'conferente',v_nome,'conferido_por',(SELECT auth.uid()))
 WHERE movimentacao_id=p_movimentacao_id;
END; $$;
CREATE OR REPLACE FUNCTION public.obter_termo_equipamento(p_movimentacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_dados jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR coalesce(public.meu_perfil(),'') NOT IN ('administrador','operador') THEN RAISE EXCEPTION 'Sem permissao para emitir termos.'; END IF;
 SELECT t.dados INTO v_dados FROM public.termos_equipamentos t JOIN public.movimentacoes m ON m.id=t.movimentacao_id
 WHERE m.id=p_movimentacao_id AND m.tipo='Retirada' AND m.devolucao_em IS NOT NULL
 AND (m.ciclo_arquivado_id IS NULL OR public.meu_perfil()='administrador');
 IF v_dados IS NULL OR NOT (v_dados ? 'devolucao_em') THEN RAISE EXCEPTION 'Termo indisponivel. Somente novas retiradas com cadastro completo geram termo.'; END IF;
 RETURN v_dados;
END; $$;
REVOKE ALL ON FUNCTION public.listar_retirantes() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.registrar_retirada_termo(uuid,uuid,text,timestamptz,timestamptz,text,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.registrar_devolucao_termo(uuid,timestamptz,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.obter_termo_equipamento(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.listar_retirantes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_retirada_termo(uuid,uuid,text,timestamptz,timestamptz,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucao_termo(uuid,timestamptz,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obter_termo_equipamento(uuid) TO authenticated;
-- Helper seguro: anon recebe somente false, sem executar meu_perfil diretamente.
CREATE OR REPLACE FUNCTION public.pode_ler_modelo_termo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL
 AND coalesce((SELECT public.meu_perfil()),'') IN ('administrador','operador');
$$;
REVOKE ALL ON FUNCTION public.pode_ler_modelo_termo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_ler_modelo_termo() TO anon,authenticated;
-- Modelo enviado separadamente pelo administrador no Dashboard do Supabase.
-- Somente arquivos PDF; nenhum documento e incluido no repositorio.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('modelos-termos','modelos-termos',false,5242880,ARRAY['application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=ARRAY['application/pdf'];
DROP POLICY IF EXISTS "modelo termo leitura autorizada" ON storage.objects;
CREATE POLICY "modelo termo leitura autorizada" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='modelos-termos' AND name='termo-v1.pdf'
 AND (SELECT public.pode_ler_modelo_termo()));
-- Politicas restritivas impedem que permissoes amplas de outros buckets exponham este modelo.
DROP POLICY IF EXISTS "modelo termo limite leitura" ON storage.objects;
CREATE POLICY "modelo termo limite leitura" ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
USING (bucket_id<>'modelos-termos' OR (name='termo-v1.pdf'
 AND (SELECT public.pode_ler_modelo_termo())));
-- Usuarios da aplicacao nao enviam, sobrescrevem nem removem o modelo.
-- O Dashboard utiliza credenciais administrativas que ignoram RLS.
DROP POLICY IF EXISTS "modelo termo limite insercao" ON storage.objects;
CREATE POLICY "modelo termo limite insercao" ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
WITH CHECK(bucket_id<>'modelos-termos');
DROP POLICY IF EXISTS "modelo termo limite atualizacao" ON storage.objects;
CREATE POLICY "modelo termo limite atualizacao" ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
USING(bucket_id<>'modelos-termos') WITH CHECK(bucket_id<>'modelos-termos');
DROP POLICY IF EXISTS "modelo termo limite exclusao" ON storage.objects;
CREATE POLICY "modelo termo limite exclusao" ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
USING(bucket_id<>'modelos-termos');
COMMIT;
