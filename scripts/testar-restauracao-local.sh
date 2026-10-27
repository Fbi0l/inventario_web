#!/usr/bin/env bash
# Teste de recuperacao LOCAL de um backup criptografado do inventario.
# Executar somente em computador PESSOAL/confiavel. NUNCA no servidor de producao.
# Uso: bash scripts/testar-restauracao-local.sh backup.dump.age backup.dump.age.sha256 chave-age.txt

set -Eeuo pipefail
umask 077

if [[ "$#" -ne 3 ]]; then
  echo "Uso: bash scripts/testar-restauracao-local.sh ARQUIVO.dump.age ARQUIVO.dump.age.sha256 CHAVE_PRIVADA_AGE" >&2
  exit 2
fi

encrypted="$1"
checksum="$2"
identity="$3"

for path in "$encrypted" "$checksum" "$identity"; do
  if [[ ! -f "$path" ]]; then
    echo "Arquivo nao encontrado: $path" >&2
    exit 2
  fi
done

for command_name in docker age sha256sum mktemp; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Programa necessario ausente: $command_name" >&2
    exit 2
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker nao esta em execucao." >&2
  exit 2
fi

backup_name="$(basename "$encrypted")"
checksum_name="$(basename "$checksum")"
if [[ "$backup_name" != *.dump.age || "$checksum_name" != "$backup_name.sha256" ]]; then
  echo "Informe um .dump.age e seu .dump.age.sha256 correspondente." >&2
  exit 2
fi

temp_dir="$(mktemp -d)"
container_name="inventario-recuperacao-teste-$$"
container_started=false

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

echo "1/5: Conferindo SHA-256 do backup criptografado..."
(
  cd "$temp_dir"
  sha256sum --check --strict "$checksum_name"
)

echo "2/5: Descriptografando em diretorio temporario local..."
age --decrypt --identity "$identity" --output "$temp_dir/backup.dump" "$temp_dir/$backup_name"
test -s "$temp_dir/backup.dump"

echo "3/5: Iniciando PostgreSQL descartavel sem acesso a rede..."
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

echo "4/5: Restaurando exclusivamente dentro do banco temporario..."
docker cp "$temp_dir/backup.dump" "$container_name:/tmp/backup.dump"
docker exec "$container_name" createdb -U postgres inventario_teste_restauracao
docker exec "$container_name" pg_restore --list /tmp/backup.dump >/dev/null
docker exec "$container_name" pg_restore --exit-on-error --no-owner --no-acl \
  -U postgres --dbname inventario_teste_restauracao /tmp/backup.dump

echo "5/5: Verificando a estrutura restaurada..."
num_tables="$(docker exec "$container_name" psql -U postgres -d inventario_teste_restauracao -At \
  -c "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")"
if [[ ! "$num_tables" =~ ^[0-9]+$ || "$num_tables" -eq 0 ]]; then
  echo "Nenhuma tabela publica identificada na restauracao." >&2
  exit 1
fi

echo "TESTE CONCLUIDO: restauradas $num_tables tabela(s) public em PostgreSQL isolado."
echo "A instancia temporaria e o dump descriptografado serao excluidos automaticamente."
echo "ATENCAO: o backup atual nao inclui Supabase Auth, Storage nem roles de producao."
