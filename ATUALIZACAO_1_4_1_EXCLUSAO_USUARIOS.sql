-- Manutencao 1.4.1: impedir que convites bloqueiem a exclusao de contas.
-- BASEADO NO CHECKUP: convites_cadastro.criado_por e usado_por referenciam auth.users
-- sem ON DELETE. Executar uma vez no SQL Editor antes de testar a exclusao.
-- Esta migracao NAO EXCLUI usuarios, convites, equipamentos, movimentacoes ou termos.
-- A identidade do autor/usuario no convite passa a NULL somente quando a conta for excluida.
BEGIN;

-- Para permitir ON DELETE SET NULL, criado_por nao pode ser NOT NULL.
ALTER TABLE public.convites_cadastro
  ALTER COLUMN criado_por DROP NOT NULL;

-- Descobre os nomes verdadeiros das FKs, sem presumir nomes de constraints.
DO $migration$
DECLARE fk record;
BEGIN
  FOR fk IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.conrelid='public.convites_cadastro'::regclass
      AND c.confrelid='auth.users'::regclass
      AND c.contype='f'
      AND cardinality(c.conkey)=1
      AND a.attname IN ('criado_por','usado_por')
  LOOP
    EXECUTE format('ALTER TABLE public.convites_cadastro DROP CONSTRAINT %I',fk.conname);
  END LOOP;
END;
$migration$;

ALTER TABLE public.convites_cadastro
  ADD CONSTRAINT convites_cadastro_criado_por_fkey
    FOREIGN KEY (criado_por) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT convites_cadastro_usado_por_fkey
    FOREIGN KEY (usado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- Confirmacao somente de leitura.
SELECT a.attname AS coluna, c.conname AS restricao,
       pg_get_constraintdef(c.oid) AS definicao
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
WHERE c.conrelid='public.convites_cadastro'::regclass
  AND c.confrelid='auth.users'::regclass
  AND c.contype='f'
  AND cardinality(c.conkey)=1
  AND a.attname IN ('criado_por','usado_por')
ORDER BY a.attname;
