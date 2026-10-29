#!/usr/bin/env bash
# Teste de recuperacao LOCAL de um backup criptografado do inventario.
# Executar somente em computador PESSOAL/confiavel. NUNCA no servidor de producao.
# Uso:
#   bash scripts/testar-restauracao-local.sh PUBLIC.dump.age PUBLIC.dump.age.sha256 CHAVE_PRIVADA_AGE \
#        [AUTH.dump.age AUTH.dump.age.sha256]
# Os dois ultimos argumentos (backup das contas) sao opcionais.

set -Eeuo pipefail
umask 077

if [[ "$#" -ne 3 && "$#" -ne 5 ]]; then
  echo "Uso: bash scripts/testar-restauracao-local.sh ARQUIVO.dump.age ARQUIVO.dump.age.sha256 CHAVE_PRIVADA_AGE [AUTH.dump.age AUTH.dump.age.sha256]" >&2
  exit 2
fi

encrypted="$1"
checksum="$2"
identity="$3"
auth_encrypted="${4:-}"
auth_checksum="${5:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
prepare_sql="$script_dir/restauracao-preparar-auth.sql"

for path in "$encrypted" "$checksum" "$identity" "$prepare_sql" ${auth_encrypted:+"$auth_encrypted" "$auth_checksum"}; do
  if [[ ! -f "$path" ]]; then
    echo "Arquivo nao encontrado: $path" >&2
    exit 2
  fi
done

for command_name in docker age sha256sum mktemp awk; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Programa necessario ausente: $command_name" >&2
    exit 2
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker nao esta em execucao." >&2
  exit 2
fi

check_pair() {
  local data_name check_name
  data_name="$(basename "$1")"
  check_name="$(basename "$2")"
  if [[ "$data_name" != *.dump.age || "$check_name" != "$data_name.sha256" ]]; then
    echo "Informe um .dump.age e seu .dump.age.sha256 correspondente: $data_name" >&2
    exit 2
  fi
}
check_pair "$encrypted" "$checksum"
[[ -z "$auth_encrypted" ]] || check_pair "$auth_encrypted" "$auth_checksum"

backup_name="$(basename "$encrypted")"
checksum_name="$(basename "$checksum")"
temp_dir="$(mktemp -d)"
container_name="inventario-recuperacao-teste-$$"
container_started=false
database=inventario_teste_restauracao

cleanup() {
  if [[ "$container_started" == true ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

chmod 700 "$temp_dir"
cp -- "$encrypted" "$temp_dir/$backup_name"
cp -- "$checksum" "$temp_dir/$checksum_name"
if [[ -n "$auth_encrypted" ]]; then
  cp -- "$auth_encrypted" "$temp_dir/$(basename "$auth_encrypted")"
  cp -- "$auth_checksum" "$temp_dir/$(basename "$auth_checksum")"
fi

echo "1/6: Conferindo SHA-256 dos backups criptografados..."
(
  cd "$temp_dir"
  sha256sum --check --strict "$checksum_name"
  [[ -z "$auth_checksum" ]] || sha256sum --check --strict "$(basename "$auth_checksum")"
)

echo "2/6: Descriptografando em diretorio temporario local..."
age --decrypt --identity "$identity" --output "$temp_dir/backup.dump" "$temp_dir/$backup_name"
test -s "$temp_dir/backup.dump"
if [[ -n "$auth_encrypted" ]]; then
  age --decrypt --identity "$identity" --output "$temp_dir/auth.dump" "$temp_dir/$(basename "$auth_encrypted")"
  test -s "$temp_dir/auth.dump"
fi

echo "3/6: Iniciando PostgreSQL descartavel sem acesso a rede..."
docker run --detach --name "$container_name" --network none \
  --env POSTGRES_PASSWORD=senha_apenas_para_teste_isolado \
  postgres:18 >/dev/null
container_started=true

ready=false
for i in {1..40}; do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "PostgreSQL de teste nao iniciou corretamente." >&2
  exit 1
fi

psql_test() {
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$database" "$@"
}
restore_section() {
  docker exec "$container_name" pg_restore --exit-on-error --no-owner --no-acl \
    --section="$1" -U postgres --dbname "$database" /tmp/backup.dump
}

echo "4/6: Restaurando exclusivamente dentro do banco temporario..."
docker cp "$temp_dir/backup.dump" "$container_name:/tmp/backup.dump"
docker exec "$container_name" createdb -U postgres "$database"
docker exec "$container_name" pg_restore --list /tmp/backup.dump >/dev/null
# O PostgreSQL 18 cria public por padrao. O dump do schema public tambem
# inclui CREATE SCHEMA public; remover o schema SOMENTE neste banco descartavel.
psql_test -c 'DROP SCHEMA IF EXISTS public CASCADE;'
# Substitutos minimos de auth/papeis do Supabase (o backup public depende deles).
psql_test < "$prepare_sql"
restore_section pre-data
restore_section data
# Antes das chaves estrangeiras: registra em auth.users os IDs que os dados citam.
docker exec "$container_name" pg_restore --section=post-data --file=- /tmp/backup.dump \
  | awk '
      /^ALTER TABLE ONLY public\./ { table = $4; next }
      /FOREIGN KEY \([a-z_]+\) REFERENCES auth\.users\(id\)/ && table != "" {
        col = $0; sub(/.*FOREIGN KEY \(/, "", col); sub(/\).*/, "", col)
        printf "INSERT INTO auth.users(id) SELECT DISTINCT %s FROM %s WHERE %s IS NOT NULL ON CONFLICT DO NOTHING;\n", col, table, col
      }' > "$temp_dir/contas-referenciadas.sql"
psql_test < "$temp_dir/contas-referenciadas.sql"
restore_section post-data

echo "5/6: Verificando a estrutura e os dados restaurados..."
num_tables="$(psql_test -At -c "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")"
if [[ ! "$num_tables" =~ ^[0-9]+$ || "$num_tables" -eq 0 ]]; then
  echo "Nenhuma tabela publica identificada na restauracao." >&2
  exit 1
fi
num_fks="$(psql_test -At -c "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND convalidated")"
echo "Tabelas public: $num_tables | chaves estrangeiras validadas: $num_fks"
echo "Registros por tabela:"
psql_test -At -F ' : ' -c "
  SELECT c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1" \
  | sed 's/^/  - /'

echo "6/6: Conferindo o backup das contas de login..."
if [[ -n "$auth_encrypted" ]]; then
  docker cp "$temp_dir/auth.dump" "$container_name:/tmp/auth.dump"
  auth_tables="$(docker exec "$container_name" pg_restore --list /tmp/auth.dump | grep -cE 'TABLE DATA auth (users|identities) ' || true)"
  if [[ "$auth_tables" -ne 2 ]]; then
    echo "O backup das contas nao contem auth.users e auth.identities." >&2
    exit 1
  fi
  docker exec "$container_name" pg_restore --file=/dev/null /tmp/auth.dump
  echo "Backup das contas legivel: dados de auth.users e auth.identities presentes."
  echo "(Ele so pode ser restaurado em um projeto Supabase, que ja traz o schema auth completo.)"
else
  echo "Backup das contas nao informado; etapa ignorada."
fi

echo "TESTE CONCLUIDO: restauradas $num_tables tabela(s) public em PostgreSQL isolado."
echo "A instancia temporaria e os arquivos descriptografados serao excluidos automaticamente."
echo "ATENCAO: o backup nao inclui arquivos do Storage (termo-v1.pdf), configuracoes de Auth nem secrets."
