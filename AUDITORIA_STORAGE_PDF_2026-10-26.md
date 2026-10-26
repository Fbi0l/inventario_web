# Auditoria do Storage do termo PDF — 26/10/2026

**Sistema:** Inventário Web, frontend 1.4.3  
**Status:** revisão do estado verificado no Supabase; documento histórico, não é uma migração para executar.

## Estado confirmado no ambiente oficial

- Há **um bucket**: `modelos-termos`, configurado como **privado**.
- O bucket contém **um arquivo**: `termo-v1.pdf`.
- A tabela `storage.objects` está com **RLS habilitada**.
- Depois da alteração feita no SQL Editor em 26/10/2026, permaneceu **uma única política** em `storage.objects`:
  - `modelo termo leitura autorizada` — `SELECT` para `authenticated`, limitada ao bucket `modelos-termos`, ao objeto `termo-v1.pdf` e ao resultado de `public.pode_ler_modelo_termo()`.
- O teste funcional do **Administrador** confirmou que o termo continua abrindo e sendo baixado após a alteração.
- Não houve alteração no frontend nem nos dados do inventário nesta operação.

## Histórico da alteração

Foram removidas manualmente no Supabase as políticas:

- `modelo termo limite leitura`
- `modelo termo limite insercao`
- `modelo termo limite atualizacao`
- `modelo termo limite exclusao`

**Correção importante:** no script histórico `ATUALIZACAO_TERMOS_PDF.sql`, essas quatro políticas foram criadas usando `AS RESTRICTIVE`. Políticas restritivas **não concedem acesso** a outros buckets; apenas impõem condições adicionais. A interpretação anterior de que essas políticas, sozinhas, permitiriam operações nos demais buckets estava incorreta.

Com apenas a política específica de `SELECT` existente e o RLS ativo, não há acesso anônimo direto ao arquivo por uma política permissiva observada; também não foi identificada política de gravação para usuários comuns no bucket atual. A ausência das políticas restritivas significa, contudo, **menos uma camada preventiva** caso políticas permissivas mais amplas sejam criadas futuramente.

## Recomendações de manutenção

1. **Não reexecutar indiscriminadamente** o script histórico `ATUALIZACAO_TERMOS_PDF.sql`: ele foi escrito antes das atualizações posteriores de privacidade e poderia alterar funções e políticas já revisadas.
2. Antes de criar outro bucket ou qualquer política em `storage.objects`, revisar as políticas **permissivas e restritivas** existentes e testar que `termo-v1.pdf` continua inacessível a usuários não autorizados.
3. Preservar o backup PostgreSQL `.dump` e a **cópia separada** do arquivo `termo-v1.pdf`. O dump não substitui um backup dos objetos físicos do Storage.
4. Se precisar refazer a instalação completa do Supabase, reconstruir e verificar as políticas de Storage considerando **o estado final** das atualizações, não apenas o script histórico.

## Consultas de conferência (somente leitura)

```sql
SELECT id, public
FROM storage.buckets;

SELECT bucket_id, name
FROM storage.objects
WHERE bucket_id = 'modelos-termos';

SELECT policyname, permissive, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
ORDER BY policyname;
```

**Observação:** essa auditoria comprova o estado das configurações e o teste realizado; não constitui teste de intrusão nem recuperação completa do ambiente Supabase.
