-- CHECK-UP 1.4.2 - bloquear RPCs legadas sem afetar os termos.
-- As RPCs registrar_retirada_termo e registrar_devolucao_termo
-- permanecem executaveis por authenticated.
-- As quatro funcoes existentes devem ser SECURITY DEFINER
-- e pertencer ao mesmo proprietario (confirmado no check-up).
-- Nenhum equipamento, usuario, movimento ou termo e modificado.
--
-- Execute no SQL Editor do Supabase, apos backup.
BEGIN;

-- Evita alterar permissoes se a arquitetura verificada tiver mudado.
DO $verificacao$
DECLARE
  v_seguro boolean;
BEGIN
  SELECT count(*) = 4
         AND count(DISTINCT p.proowner) = 1
         AND bool_and(p.prosecdef)
    INTO v_seguro
  FROM pg_proc p
  WHERE p.oid IN (
    to_regprocedure('public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text)'),
    to_regprocedure('public.registrar_devolucao(uuid,timestamptz,text,text)'),
    to_regprocedure('public.registrar_retirada_termo(uuid,uuid,text,timestamptz,timestamptz,text,text,text,boolean)'),
    to_regprocedure('public.registrar_devolucao_termo(uuid,timestamptz,text,text,text)')
  );

  IF v_seguro IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Arquitetura de RPC diferente da verificada. Nada foi alterado.';
  END IF;
END
$verificacao$;

-- Proibe a chamada direta das funcoes antigas pela API.
-- Os wrappers atuais sao SECURITY DEFINER do mesmo proprietario,
-- portanto podem continuar chamando essas funcoes internamente.
REVOKE EXECUTE ON FUNCTION
  public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.registrar_devolucao(uuid,timestamptz,text,text)
  FROM PUBLIC, anon, authenticated;

-- Valida as permissoes na propria transacao. Falha implica rollback.
DO $verificacao$
BEGIN
  IF has_function_privilege(
      'authenticated',
      'public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.registrar_devolucao(uuid,timestamptz,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.registrar_retirada(uuid,text,text,timestamptz,timestamptz,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.registrar_devolucao(uuid,timestamptz,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Permissoes antigas continuam ativas. A transacao sera revertida.';
  END IF;

  IF NOT has_function_privilege(
      'authenticated',
      'public.registrar_retirada_termo(uuid,uuid,text,timestamptz,timestamptz,text,text,text,boolean)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'authenticated',
      'public.registrar_devolucao_termo(uuid,timestamptz,text,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Funcoes atuais sem permissao. A transacao sera revertida.';
  END IF;
END
$verificacao$;

COMMIT;

-- Conferencia de leitura: antigos = false; atuais = true
-- na coluna acesso_authenticated.
SELECT
  p.proname AS funcao,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS acesso_authenticated,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS acesso_anon
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'registrar_retirada',
    'registrar_devolucao',
    'registrar_retirada_termo',
    'registrar_devolucao_termo'
  )
ORDER BY p.proname;
