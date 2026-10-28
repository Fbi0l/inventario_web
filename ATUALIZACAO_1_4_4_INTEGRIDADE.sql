-- Manutencao 1.4.4: integridade de usuarios e da situacao dos equipamentos.
-- Executar uma vez no SQL Editor do Supabase, apos backup.
-- Requer ATUALIZACAO_PERFIS.sql e ATUALIZACAO_ARQUIVAMENTO_CICLOS.sql ja aplicados.
-- Esta migracao NAO EXCLUI nem altera equipamentos, movimentacoes, termos ou usuarios.
-- Nao e preciso republicar o site nem as Edge Functions.
--
-- 1) Exclusao de usuarios
--    equipamentos.criado_por e movimentacoes.registrado_por referenciavam auth.users
--    sem ON DELETE. Excluir uma conta que ja cadastrou equipamento ou registrou
--    retirada/devolucao falhava com erro de chave estrangeira. Com ON DELETE SET NULL,
--    os registros permanecem e apenas a referencia a conta excluida fica vazia.
--    O nome do retirante continua em movimentacoes.responsavel e no termo.
--
-- 2) Situacao de equipamento com retirada em aberto
--    A edicao manual permitia trocar "Em uso" por outra situacao com retirada aberta,
--    o que impedia a devolucao e o arquivamento do ciclo. Um gatilho passa a recusar
--    essa troca. A devolucao pelo fluxo normal continua funcionando, pois ela fecha
--    a retirada antes de alterar a situacao do equipamento.
BEGIN;

-- 1) Recria as FKs com ON DELETE SET NULL, sem presumir nomes de constraints.
DO $migration$
DECLARE fk record;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tabela, c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f'
      AND c.confrelid='auth.users'::regclass
      AND cardinality(c.conkey)=1
      AND ((c.conrelid='public.equipamentos'::regclass AND a.attname='criado_por')
        OR (c.conrelid='public.movimentacoes'::regclass AND a.attname='registrado_por'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',fk.tabela,fk.conname);
  END LOOP;
END;
$migration$;

ALTER TABLE public.equipamentos
  ADD CONSTRAINT equipamentos_criado_por_fkey
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.movimentacoes
  ADD CONSTRAINT movimentacoes_registrado_por_fkey
    FOREIGN KEY (registrado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) Impede sair de "Em uso" enquanto existir retirada aberta no ciclo ativo.
CREATE OR REPLACE FUNCTION public.proteger_situacao_em_uso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.situacao IS DISTINCT FROM OLD.situacao
     AND NEW.situacao IS DISTINCT FROM 'Em uso'
     AND NEW.ciclo_arquivado_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.movimentacoes m
       WHERE m.equipamento_id = NEW.id
         AND m.tipo = 'Retirada'
         AND m.devolucao_em IS NULL
         AND m.ciclo_arquivado_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Este equipamento possui retirada em aberto. Registre a devolucao em Retiradas e devolucoes em vez de alterar a situacao manualmente.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.proteger_situacao_em_uso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proteger_situacao_em_uso ON public.equipamentos;
CREATE TRIGGER trg_proteger_situacao_em_uso
  BEFORE UPDATE OF situacao ON public.equipamentos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_situacao_em_uso();

COMMIT;

-- Conferencia 1 (somente leitura): as duas linhas devem mostrar ON DELETE SET NULL.
SELECT c.conrelid::regclass AS tabela, c.conname AS restricao,
       pg_get_constraintdef(c.oid) AS definicao
FROM pg_constraint c
WHERE c.conname IN ('equipamentos_criado_por_fkey','movimentacoes_registrado_por_fkey')
ORDER BY 1;

-- Conferencia 2 (somente leitura): equipamentos que JA estao inconsistentes.
-- Resultado vazio = tudo certo. Se aparecer algum, edite o equipamento e volte a
-- situacao para "Em uso"; depois registre a devolucao normalmente.
SELECT e.tag, e.patrimonio, e.descricao, e.situacao, m.responsavel, m.retirada_em
FROM public.equipamentos e
JOIN public.movimentacoes m ON m.equipamento_id = e.id
WHERE e.ciclo_arquivado_id IS NULL AND m.ciclo_arquivado_id IS NULL
  AND m.tipo = 'Retirada' AND m.devolucao_em IS NULL
  AND e.situacao IS DISTINCT FROM 'Em uso';
