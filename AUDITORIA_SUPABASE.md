# Auditoria automática de segurança do Supabase (1.5.2)

## O que faz

Toda segunda-feira às 06h40 (Belém), o workflow [auditoria-supabase.yml](.github/workflows/auditoria-supabase.yml) conecta ao projeto oficial **somente para leitura** e confere a configuração de segurança. Se algo estiver errado, o job falha e o GitHub envia o alerta de falha por e-mail.

1. **Regras fixas**, que nunca podem ser violadas ([scripts/auditoria-supabase-regras.sql](scripts/auditoria-supabase-regras.sql)):
   - toda tabela do `public` com RLS ligado;
   - nenhum bucket do Storage público;
   - toda função `SECURITY DEFINER` com `search_path` fixo e sem execução por quem não fez login;
   - `anon`/`authenticated` sem `TRUNCATE`, `TRIGGER`, `REFERENCES` ou `MAINTAIN` (permissões que ignoram o RLS);
   - nenhuma chave para `auth.users` que impeça excluir contas;
   - o próprio usuário da auditoria sem acesso a dados.
2. **Comparação com a foto aprovada** ([docs/auditoria-supabase-esperado.txt](docs/auditoria-supabase-esperado.txt)): RLS, permissões, políticas (com as condições completas), funções, gatilhos, chaves para `auth.users` e buckets. Qualquer mudança aparece no resumo da execução, linha a linha.

## Credencial de menor privilégio

A auditoria usa o usuário de banco `auditoria_leitura`, criado por [ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql](ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql):

- lê apenas os catálogos do PostgreSQL (estrutura e configuração), **nenhuma linha de dados**;
- a única janela extra é `auditoria_seguranca.buckets()`, que informa só o nome de cada bucket e se ele é público;
- sessões somente leitura, tempo máximo de 30 s por consulta e no máximo 2 conexões;
- o script de instalação desfaz tudo se esse usuário conseguir ler qualquer tabela de `public`, `auth` ou `storage`.

A mesma migração remove de `anon`/`authenticated` as permissões `TRUNCATE`, `TRIGGER`, `REFERENCES` e `MAINTAIN` em `equipamentos` e `movimentacoes`. O sistema não usa nenhuma delas.

## Instalação

1. **Banco:** faça backup e execute `ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql` no SQL Editor.
2. **Senha:** ainda no SQL Editor, rode o comando abaixo com uma senha longa e aleatória (gere num gerenciador de senhas). Não salve a senha em arquivo nem no repositório.
   ```sql
   ALTER ROLE auditoria_leitura PASSWORD 'cole-aqui-a-senha-gerada';
   ```
   Em seguida, no GitHub, crie o segredo **SUPABASE_AUDIT_DB_PASSWORD** com essa mesma senha, em *Settings → Secrets and variables → Actions → aba Secrets*.
3. **Teste:** em *Actions → Auditoria de seguranca do Supabase → Run workflow*.

O workflow reaproveita `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT` e o sufixo do `SUPABASE_DB_USER` do backup. Nenhuma variável nova é necessária.

## Quando a auditoria falhar

- **Regra violada:** corrija no Supabase. Não altere a regra para deixar o teste verde.
- **Foto diferente:** se a mudança foi **intencional** (uma migração nova, por exemplo), atualize a foto no mesmo PR da migração:
  ```bash
  bash scripts/auditoria-supabase.sh --gerar > docs/auditoria-supabase-esperado.txt
  ```
  Use o usuário `auditoria_leitura` e recoloque o cabeçalho de comentários. Se ninguém fez a mudança, trate como incidente.

## Fora do alcance

A auditoria lê o banco. **Configurações do Auth** (proteção contra senhas vazadas, provedores, modelos de e-mail) e das Edge Functions ficam no painel do Supabase e continuam sendo revisadas manualmente. Em 29/10/2026, o painel apontava a **proteção contra senhas vazadas desligada** (Authentication → Policies/Settings).
