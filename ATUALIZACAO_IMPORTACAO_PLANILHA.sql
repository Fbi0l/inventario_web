-- Instala importacao em lote. Nao importa nem apaga equipamentos ao executar.
BEGIN;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS codigo_origem text;
ALTER TABLE public.equipamentos ADD COLUMN IF NOT EXISTS data_aquisicao date;
CREATE TABLE IF NOT EXISTS public.importacoes_equipamentos (
 lote_id uuid PRIMARY KEY,
 criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 criado_em timestamptz NOT NULL DEFAULT now(),
 conteudo_hash text NOT NULL,
 resultado jsonb NOT NULL
);
ALTER TABLE public.importacoes_equipamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.importacoes_equipamentos FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.importacoes_equipamentos TO authenticated;
DROP POLICY IF EXISTS "importacoes leitura administrador" ON public.importacoes_equipamentos;
CREATE POLICY "importacoes leitura administrador" ON public.importacoes_equipamentos
 FOR SELECT TO authenticated USING ((SELECT public.meu_perfil())='administrador');
CREATE OR REPLACE FUNCTION public.normalizar_patrimonio_importacao(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN btrim(coalesce(p_valor,''))='' OR btrim(p_valor)~'^0+$' THEN NULL
  WHEN btrim(p_valor)~'^[0-9]+$' THEN ltrim(btrim(p_valor),'0') ELSE upper(btrim(p_valor)) END;
$$;
CREATE OR REPLACE FUNCTION public.importar_equipamentos(p_lote uuid,p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v jsonb; r jsonb; v_criador uuid; v_hash text; v_tag text; v_pat text; v_desc text;
 v_estado text; v_situacao text; v_campo text; v_valor numeric; v_data date;
 v_linha integer; v_importados integer:=0; v_ignorados jsonb:='[]'::jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR coalesce((SELECT public.meu_perfil()),'')<>'administrador' THEN
  RAISE EXCEPTION 'Somente administradores podem importar equipamentos.';
 END IF;
 IF p_lote IS NULL OR jsonb_typeof(p_itens) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lote invalido.'; END IF;
 IF jsonb_array_length(p_itens) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Importe entre 1 e 2000 equipamentos por lote.'; END IF;
 -- Mesma tabela e modo de bloqueio utilizados pelo arquivamento: evita mistura de ciclos.
 LOCK TABLE public.equipamentos IN SHARE ROW EXCLUSIVE MODE;
 SELECT resultado,criado_por,conteudo_hash INTO r,v_criador,v_hash FROM public.importacoes_equipamentos WHERE lote_id=p_lote;
 IF FOUND THEN
  IF v_criador IS DISTINCT FROM (SELECT auth.uid()) THEN RAISE EXCEPTION 'Lote pertence a outro administrador.'; END IF;
  IF v_hash IS DISTINCT FROM md5(p_itens::text) THEN RAISE EXCEPTION 'Lote alterado. Selecione novamente o arquivo para iniciar outra importacao.'; END IF;
  RETURN r;
 END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Registro invalido.'; END IF;
  v_linha:=(v->>'linha')::integer;
  IF v_linha IS NULL OR v_linha NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Linha invalida.'; END IF;
  v_tag:=btrim(coalesce(v->>'tag',''));v_desc:=btrim(coalesce(v->>'descricao',''));
  v_pat:=nullif(btrim(v->>'patrimonio'),'');
  IF public.normalizar_patrimonio_importacao(v_pat) IS NULL THEN v_pat:=NULL; END IF;
  v_estado:=coalesce(nullif(btrim(v->>'estado'),''),'Bom');
  v_situacao:=coalesce(nullif(btrim(v->>'situacao'),''),'Disponível');
  IF char_length(v_tag) NOT BETWEEN 1 AND 80 OR char_length(v_desc) NOT BETWEEN 1 AND 200 THEN
   RAISE EXCEPTION 'Linha %: informe TAG (ate 80) e descricao (ate 200).',v_linha;
  END IF;
  IF v_estado NOT IN ('Bom','Regular','Ruim','Inoperante') OR v_situacao NOT IN ('Disponível','Manutenção','Baixado') THEN
   RAISE EXCEPTION 'Linha %: estado/situacao invalidos. Em uso exige retirada registrada.',v_linha;
  END IF;
  FOREACH v_campo IN ARRAY ARRAY['patrimonio','categoria','marca','modelo','numero_serie','pertencimento','responsavel','localizacao','observacoes','codigo_origem'] LOOP
   IF char_length(coalesce(v->>v_campo,''))>(CASE v_campo
    WHEN 'patrimonio' THEN 100 WHEN 'categoria' THEN 100 WHEN 'marca' THEN 100 WHEN 'modelo' THEN 100
    WHEN 'numero_serie' THEN 150 WHEN 'pertencimento' THEN 120 WHEN 'responsavel' THEN 150 WHEN 'localizacao' THEN 150
    WHEN 'observacoes' THEN 2000 WHEN 'codigo_origem' THEN 80 END) THEN
    RAISE EXCEPTION 'Linha %: campo % excede o limite.',v_linha,v_campo;
   END IF;
  END LOOP;
  v_valor:=nullif(v->>'valor','')::numeric;
  IF v_valor IS NOT NULL AND (v_valor::text IN ('NaN','Infinity','-Infinity') OR v_valor<0 OR v_valor>9999999999.99 OR v_valor<>round(v_valor,2)) THEN
   RAISE EXCEPTION 'Linha %: valor invalido.',v_linha;
  END IF;
  IF nullif(v->>'data_aquisicao','') IS NOT NULL AND (v->>'data_aquisicao')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Linha %: data de aquisicao invalida.',v_linha;
  END IF;
  v_data:=nullif(v->>'data_aquisicao','')::date;
  IF v_data IS NOT NULL AND (v_data<'1900-01-01'::date OR v_data>'2100-12-31'::date) THEN RAISE EXCEPTION 'Linha %: data fora do intervalo.',v_linha; END IF;
  IF EXISTS(SELECT 1 FROM public.equipamentos e WHERE e.ciclo_arquivado_id IS NULL AND
    (upper(btrim(e.tag))=upper(v_tag) OR (v_pat IS NOT NULL AND public.normalizar_patrimonio_importacao(e.patrimonio)=public.normalizar_patrimonio_importacao(v_pat)))) THEN
   v_ignorados:=v_ignorados||jsonb_build_array(jsonb_build_object('linha',v_linha,'motivo','TAG ou patrimonio ja cadastrado no ciclo ativo'));
   CONTINUE;
  END IF;
  INSERT INTO public.equipamentos(tag,patrimonio,descricao,categoria,marca,modelo,numero_serie,pertencimento,responsavel,localizacao,estado,situacao,valor,observacoes,codigo_origem,data_aquisicao,criado_por)
  VALUES(v_tag,v_pat,v_desc,nullif(btrim(v->>'categoria'),''),nullif(btrim(v->>'marca'),''),nullif(btrim(v->>'modelo'),''),
   nullif(btrim(v->>'numero_serie'),''),nullif(btrim(v->>'pertencimento'),''),nullif(btrim(v->>'responsavel'),''),nullif(btrim(v->>'localizacao'),''),
   v_estado,v_situacao,v_valor,nullif(btrim(v->>'observacoes'),''),nullif(btrim(v->>'codigo_origem'),''),v_data,(SELECT auth.uid()));
  v_importados:=v_importados+1;
 END LOOP;
 r:=jsonb_build_object('importados',v_importados,'ignorados',v_ignorados,'lote',p_lote);
 INSERT INTO public.importacoes_equipamentos(lote_id,criado_por,conteudo_hash,resultado)VALUES(p_lote,(SELECT auth.uid()),md5(p_itens::text),r);
 RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.importar_equipamentos(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.importar_equipamentos(uuid,jsonb) TO authenticated;
COMMIT;
