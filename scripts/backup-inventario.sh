#!/usr/bin/env bash
# Backup lógico do schema public do inventário. Não inclui auth.users, Storage nem permissões de roles.
set -Eeuo pipefail
umask 077

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Configuracao obrigatoria ausente: $name" >&2
    exit 2
  fi
}
for name in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE BACKUP_AGE_RECIPIENT BACKUP_OUTPUT_DIR; do
  require_value "$name"
done
if [[ ! "$BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]+$ ]]; then
  echo "::error::BACKUP_AGE_RECIPIENT deve ser uma chave publica age1..." >&2
  exit 2
fi
command -v docker >/dev/null || { echo "::error::Docker nao esta disponivel"; exit 2; }
command -v age >/dev/null || { echo "::error::age nao esta disponivel"; exit 2; }

mkdir -p "$BACKUP_OUTPUT_DIR"
output_dir="$(cd "$BACKUP_OUTPUT_DIR" && pwd -P)"
chmod 700 "$output_dir"
timestamp="$(date -u +'%Y-%m-%d_%H-%M-%SZ')"
base="inventario_public_${timestamp}"
raw="$output_dir/$base.dump"
encrypted="$output_dir/$base.dump.age"
checksum="$output_dir/$base.dump.age.sha256"

cleanup() { rm -f -- "$raw"; }
trap cleanup EXIT

export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"
# A imagem oficial fornece clientes PostgreSQL 18. O runner acessa a rede somente como cliente.
postgres() {
  docker run --rm --network host \
    -v "$output_dir:/backup" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCONNECT_TIMEOUT \
    postgres:18 "$@"
}
echo "Gerando backup somente do schema public..."
postgres pg_dump --schema=public --format=custom --no-owner --no-acl \
  --file="/backup/$base.dump"
if [[ ! -s "$raw" ]]; then
  echo "::error::Backup inexistente ou vazio" >&2
  exit 1
fi
echo "Verificando indice e extracao integral do arquivo .dump..."
postgres pg_restore --list "/backup/$base.dump" >/dev/null
postgres pg_restore --file=/dev/null "/backup/$base.dump" >/dev/null
echo "Criptografando backup com chave publica age..."
age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$raw"
[[ -s "$encrypted" ]] || { echo "::error::Backup criptografado vazio"; exit 1; }
rm -f -- "$raw"
( cd "$output_dir" && sha256sum "$base.dump.age" > "$base.dump.age.sha256" && sha256sum -c "$base.dump.age.sha256" )
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    printf 'backup_name=%s\n' "$base.dump.age"
    printf 'checksum_name=%s\n' "$base.dump.age.sha256"
  } >> "$GITHUB_OUTPUT"
fi
echo "Backup do schema public criptografado e verificado: $base.dump.age"
