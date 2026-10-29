# Backup automático criptografado — Inventário Web

## Objetivo e limites

A rotina [scripts/backup-inventario.sh](scripts/backup-inventario.sh) e o workflow [.github/workflows/backup-inventario.yml](.github/workflows/backup-inventario.yml) foram preparados para rodar diariamente às **06h de Belém/PA (09h UTC)** ou manualmente. O job começa **DESATIVADO**: só executa com a variável BACKUP_ENABLED=true.

O backup é SOMENTE-LEITURA e exporta, em formato customizado, **apenas o schema public** do PostgreSQL. Confere conteúdo extraível com pg_restore e SHA-256; criptografa com age antes de salvar os arquivos. O arquivo não criptografado é excluído do runner.

**Contas de login (opcional):** com a variável BACKUP_AUTH_ENABLED=true, a mesma execução gera um segundo arquivo criptografado, `inventario_auth_DATA.dump.age`, com os **dados** de `auth.users` e `auth.identities` (e-mails, hashes de senha e vínculos de login). Ele serve para recriar as contas em um projeto Supabase novo e roda **depois** do backup principal: se falhar, o backup do schema public do dia já está salvo e o job aparece como falho para gerar alerta.

**Não inclui** configurações do Auth (provedores, modelos de e-mail, URLs), arquivos físicos do Storage, secrets das Edge Functions nem outros esquemas gerenciados. O modelo privado termo-v1.pdf continua exigindo backup separado.

O workflow de testes [teste-backup.yml](.github/workflows/teste-backup.yml) usa um PostgreSQL local e dados fictícios, sem contato com a produção. Ele aplica todas as migrações do projeto, gera os dois backups com o script real e os restaura com o script de ensaio ([tests/backup-esquema-real.sh](tests/backup-esquema-real.sh)), e roda de novo sempre que uma migração ou script de backup muda.

## 1. Criar chave de criptografia no próprio computador

Instale age a partir do repositório oficial: https://github.com/FiloSottile/age/releases .

No PowerShell (age-keygen precisa estar no PATH):

```powershell
New-Item -ItemType Directory -Force "$HOME\BackupsInventario" | Out-Null
age-keygen -o "$HOME\BackupsInventario\chave-privada-backup-age.txt"
age-keygen -y "$HOME\BackupsInventario\chave-privada-backup-age.txt"
```

Guarde o arquivo **chave-privada-backup-age.txt** somente sob seu controle e crie cópia em local externo seguro e criptografado. Sem ela, você não poderá ler os arquivos de backup. A linha pública gerada que começa por **age1** pode ser cadastrada no GitHub. **NUNCA** compartilhe a chave privada, nem faça commit dela.

## 2. Variáveis e segredo no GitHub

Acesse Settings > Secrets and variables > Actions do repositório.

Na aba **Variables**:

| Variável | Valor |
|---|---|
| SUPABASE_DB_HOST | Host da conexão visto em Supabase > Connect |
| SUPABASE_DB_PORT | Porta correta, como 5432 para pooler de sessão |
| SUPABASE_DB_USER | Usuário PostgreSQL do projeto |
| BACKUP_AGE_RECIPIENT | Chave pública age1... |
| BACKUP_ENABLED | false no começo; true depois da configuração |
| BACKUP_AUTH_ENABLED | true para incluir o backup das contas de login (opcional) |

Na aba **Secrets**:

| Segredo | Valor |
|---|---|
| SUPABASE_DB_PASSWORD | Senha da conexão PostgreSQL |

Nunca inclua senhas em variáveis comuns, código, issues, commits nem mensagens de chat. A rotina GitHub Actions só roda no agendamento ou ao usar Run workflow, não em Pull Requests.

Para pg_dump, a documentação Supabase recomenda conexão direta; quando o runner não tem conectividade IPv6, utilize o pooler de **sessão**, nunca o de transação. O usuário já havia validado o pooler de sessão para os backups locais.

## 3. Ativação e teste real

1. Confirme que o workflow **Teste isolado da rotina de backup** terminou verde na PR.
2. Após integrar a PR e registrar as configurações, altere BACKUP_ENABLED para true.
3. Abra Actions > Backup criptografado do Inventario > Run workflow, branch main.
4. Confirme que o job terminou verde e que gerou arquivo .dump.age mais arquivo .sha256.
5. Baixe o artefato criptografado e **teste a descriptografia** localmente usando sua chave privada.
6. Planeje um restauro real em ambiente de testes Supabase preparado; verificação do dump não é restauração de produção.

Um artefato do Actions expira em **14 dias**. Para retenção durável, habilite a cópia externa privada abaixo.

Exemplo de descriptografia local, substituindo o nome real do arquivo:

```powershell
age --decrypt -i "$HOME\BackupsInventario\chave-privada-backup-age.txt" `
  -o "$HOME\BackupsInventario\backup-recuperado.dump" `
  "$HOME\Downloads\inventario_public_DATA.dump.age"
```

O .dump descriptografado contém dados pessoais. Nunca o publique.

## 4. Cópia externa privada S3 / Cloudflare R2 (opcional, recomendada)

Prepare um bucket **privado** e credenciais que só possam gravar objetos no prefixo inventario/; use retenção definida no próprio provedor, preferencialmente com proteção contra exclusões.

Na aba **Variables**:

| Variável | Exemplo |
|---|---|
| BACKUP_S3_PROVIDER | Cloudflare (para R2) |
| BACKUP_S3_ENDPOINT | Endpoint HTTPS S3 da conta R2 |
| BACKUP_S3_REGION | auto (para R2) |
| BACKUP_S3_BUCKET | Nome do bucket privado |
| BACKUP_OFFSITE_ENABLED | true para usar |

Na aba **Secrets**:

- BACKUP_S3_ACCESS_KEY_ID
- BACKUP_S3_SECRET_ACCESS_KEY

A cópia externa recebe **somente** .age e checksum SHA-256. Quando habilitada, uma falha de upload reprova o job, permitindo identificar um problema de continuidade.

## 5. Operação segura

- Verifique os resultados de Actions e configure notificações de falhas do GitHub.
- Faça testes periódicos de descriptografia e restauração isolada.
- Preserve cópias físicas separadas de arquivos do Supabase Storage, inclusive termo-v1.pdf.
- Não copie backups descriptografados para repositório público.
- Nunca envie chave privada de age para GitHub, mesmo nos Secrets.
- O backup de esquema public é PARCIAL e não substitui uma política de recuperação integral do projeto Supabase.

**Até BACKUP_ENABLED=true, não é realizada nenhuma conexão de backup ao banco oficial.**
