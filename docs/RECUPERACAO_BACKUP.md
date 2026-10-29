# Recuperação isolada do Inventário — procedimento seguro

Este documento prepara o ensaio de recuperação do arquivo `.dump.age` guardado no **Cloudflare R2**, sem afetar o projeto Supabase oficial.

## O que já está comprovado

- O GitHub gera um `pg_dump` do schema `public`, valida o dump, criptografa com `age` e salva SHA-256.
- O arquivo criptografado e seu checksum são enviados ao bucket privado `inventario-backup-fbiol`.
- O GitHub baixa novamente os arquivos do R2 e verifica o SHA-256.

Isso **não comprova** restauração completa de produção. Em particular, o dump atual **não inclui** `auth.users`, conteúdo de **Supabase Storage**, configurações de autenticação, permissões/roles nem todos os demais schemas. Podem existir relações do schema `public` com objetos de outros schemas que impeçam uma restauração isolada direta.

## Onde executar

- **Somente em um computador pessoal e confiável**, de preferência com armazenamento criptografado.
- **Nunca no computador da empresa**, no banco Supabase de produção ou em máquina compartilhada.
- Não carregue a chave privada `AGE-SECRET-KEY-...` no GitHub, em Issues, PRs, GitHub Actions, Cloudflare, conversas ou prints.
- O procedimento usa `docker --network none`, não publica portas e não conhece qualquer credencial do banco de produção.

## Preparação no dispositivo pessoal

1. Obtenha do R2 os dois arquivos correspondentes ao **mesmo backup**: `inventario_public_...dump.age` e `inventario_public_...dump.age.sha256`.
2. Disponibilize a **chave privada age** localmente, em arquivo com permissões restritas (`chmod 600` em Linux/WSL). Não confunda com a chave pública `age1...`.
3. Instale **Docker**, `age`, Bash e `sha256sum` no dispositivo pessoal. Em Windows, utilize WSL2 com Docker Desktop. A imagem `postgres:18` precisa ser baixada na primeira execução.
4. Coloque os dois arquivos criptografados e o arquivo local da chave em locais que você controla. Jamais os adicione ao Git.

## Teste local

Execute dentro da cópia do repositório:

```bash
bash scripts/testar-restauracao-local.sh \
  /caminho/inventario_public_DATA.dump.age \
  /caminho/inventario_public_DATA.dump.age.sha256 \
  /caminho/privado/chave-age.txt \
  /caminho/inventario_auth_DATA.dump.age \
  /caminho/inventario_auth_DATA.dump.age.sha256
```

Os dois últimos argumentos (backup das contas) são opcionais; o backup das contas é gerado por padrão junto com o principal.

O script confere SHA-256, descriptografa num diretório temporário, cria um PostgreSQL **sem rede**, restaura o dump em `inventario_teste_restauracao`, mostra quantas tabelas, chaves estrangeiras e registros voltaram e destrói o ambiente temporário ao finalizar.

Como o backup do `public` depende de objetos do Supabase que não estão nele (`auth.users`, `auth.uid()` e os papéis `anon`/`authenticated`/`service_role`), o script cria substitutos mínimos **só no banco descartável** ([scripts/restauracao-preparar-auth.sql](../scripts/restauracao-preparar-auth.sql)) antes de restaurar. Até 29/10/2026 o script não fazia isso e o ensaio com um backup real falharia em `schema "auth" does not exist`.

O backup das contas é apenas conferido (legível e com `auth.users`/`auth.identities`). Ele só pode ser restaurado de fato em um projeto Supabase, que já traz o schema `auth` completo.

**Se a restauração falhar**, não execute `pg_restore` no Supabase oficial. Dependências externas ao `public` (como `auth` ou extensões) são uma causa possível. Preserve somente os arquivos criptografados e compartilhe apenas mensagens de erro **sem dados pessoais e sem chaves** para diagnóstico.

## Limites e próximos controles

- A senha usada dentro do contêiner é apenas para a instância temporária, inacessível pela rede, que será removida. Ela não é a senha do Supabase.
- O dump em texto claro existe **temporariamente no disco local** durante o ensaio; use somente dispositivo confiável com disco criptografado.
- A remoção de arquivos temporários não garante apagamento físico irrecuperável em todos os sistemas de arquivos.
- Para recuperação realmente completa, é necessário **plano adicional para Auth, Storage, roles, secrets/configuração e dependências**, além de ensaio de restauração e validação funcional de dados e acessos.
- Chave de recuperação: mantenha cópias offline seguras e controladas pelo proprietário; **não** a inclua no repositório ou nos Secrets do GitHub.
