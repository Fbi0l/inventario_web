#!/usr/bin/env bash
# Teste de backup e restauracao com o ESQUEMA REAL do inventario e dados ficticios.
# Monta um PostgreSQL descartavel parecido com o Supabase (schemas auth/storage minimos),
# aplica todas as migracoes do projeto, gera os backups public e auth com o mesmo
# script da producao e restaura com scripts/testar-restauracao-local.sh.
# Requer Docker e age. Nao usa credenciais nem dados reais.
set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
work="$(mktemp -d)"
container="inventario-backup-esquema-$$"
port="${TEST_PG_PORT:-55443}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD=senha_ficticia_teste \
  -p "127.0.0.1:$port:5432" postgres:18 >/dev/null
for i in {1..40}; do
  docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
sql() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

echo "Montando banco ficticio no formato do Supabase..."
sql <<'EOF'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text,banned_until timestamptz,deleted_at timestamptz);
CREATE TABLE auth.identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,provider text NOT NULL);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
-- ATUALIZACAO_PERFIS.sql exige que este administrador exista.
INSERT INTO auth.users(id,email,encrypted_password) VALUES
 ('80000000-0000-0000-0000-000000000001','usuario@inventariosys.com','hash-ficticio'),
 ('80000000-0000-0000-0000-000000000002','operador@example.invalid','hash-ficticio');
INSERT INTO auth.identities(user_id,provider) SELECT id,'email' FROM auth.users;
EOF

# Mesma ordem de instalacao usada no projeto oficial.
for f in supabase_schema ATUALIZACAO_PERFIS ATUALIZACAO_ARQUIVAMENTO_CICLOS ATUALIZACAO_EXCLUSAO_CICLOS \
         ATUALIZACAO_TERMOS_PDF ATUALIZACAO_PRIVACIDADE_TERMOS ATUALIZACAO_CONVITES_CADASTRO \
         ATUALIZACAO_1_4_1_EXCLUSAO_USUARIOS ATUALIZACAO_1_4_2_SEGURANCA_RPCS ATUALIZACAO_IMPORTACAO_PLANILHA \
         ATUALIZACAO_IMPORTACAO_EM_USO ATUALIZACAO_1_4_4_INTEGRIDADE ATUALIZACAO_1_5_0_AUDITORIA; do
  sql < "$f.sql" >/dev/null
done

echo "Inserindo dados ficticios que referenciam contas..."
sql <<'EOF'
INSERT INTO perfis_usuarios(usuario_id,perfil) VALUES ('80000000-0000-0000-0000-000000000002','operador')
  ON CONFLICT (usuario_id) DO UPDATE SET perfil=excluded.perfil;
INSERT INTO dados_retirantes(usuario_id,nome,cpf) VALUES ('80000000-0000-0000-0000-000000000002','Operador Ficticio','12345678909');
INSERT INTO equipamentos(id,descricao,tag,criado_por) VALUES
 ('90000000-0000-0000-0000-000000000001','Notebook ficticio','TI-1','80000000-0000-0000-0000-000000000001'),
 ('90000000-0000-0000-0000-000000000002','Monitor ficticio','TI-2',NULL);
INSERT INTO movimentacoes(equipamento_id,tipo,responsavel,retirada_em,registrado_por) VALUES
 ('90000000-0000-0000-0000-000000000001','Retirada','Operador Ficticio','2026-10-28T12:00Z','80000000-0000-0000-0000-000000000002');
INSERT INTO convites_cadastro(token_hash,criado_por,expira_em) VALUES ('hash-ficticio','80000000-0000-0000-0000-000000000001',now()+interval '1 day');
EOF

echo "Gerando backups com o script da producao..."
age-keygen -o "$work/chave.txt" 2>/dev/null
export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres PGPASSWORD=senha_ficticia_teste PGDATABASE=postgres PGSSLMODE=disable
export BACKUP_AGE_RECIPIENT="$(age-keygen -y "$work/chave.txt")"
BACKUP_OUTPUT_DIR="$work/public" bash scripts/backup-inventario.sh
BACKUP_OUTPUT_DIR="$work/auth" BACKUP_SCOPE=auth bash scripts/backup-inventario.sh
pub=("$work"/public/*.dump.age); aut=("$work"/auth/*.dump.age)
[[ ${#pub[@]} -eq 1 && ${#aut[@]} -eq 1 ]]
[[ "$(basename "${pub[0]}")" == inventario_public_* && "$(basename "${aut[0]}")" == inventario_auth_* ]]
compgen -G "$work/public/*.dump" >/dev/null && { echo "Dump sem criptografia ficou no disco." >&2; exit 1; }

echo "Restaurando com o script de ensaio local..."
bash scripts/testar-restauracao-local.sh "${pub[0]}" "${pub[0]}.sha256" "$work/chave.txt" \
  "${aut[0]}" "${aut[0]}.sha256" | tee "$work/saida.txt"

expect() { grep -qF -- "$1" "$work/saida.txt" || { echo "Esperado na saida: $1" >&2; exit 1; }; }
expect "  - equipamentos : 2"
expect "  - movimentacoes : 1"
expect "  - convites_cadastro : 1"
expect "  - dados_retirantes : 1"
expect "Backup das contas legivel"
expect "TESTE CONCLUIDO"
fks="$(sed -n 's/.*chaves estrangeiras validadas: \([0-9]*\).*/\1/p' "$work/saida.txt")"
[[ "$fks" -ge 10 ]] || { echo "Chaves estrangeiras restauradas: ${fks:-0} (esperado >= 10)" >&2; exit 1; }
echo "Teste aprovado: backup public + contas com esquema real, restauracao isolada com $fks chaves estrangeiras."
