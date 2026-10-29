#!/usr/bin/env bash
# Auditoria SOMENTE LEITURA da configuracao de seguranca do Supabase.
# Conecta com o usuario auditoria_leitura (sem acesso a dados), confere regras
# fixas e compara a "foto" da configuracao com docs/auditoria-supabase-esperado.txt.
# Uso:
#   bash scripts/auditoria-supabase.sh           # confere (falha se algo divergir)
#   bash scripts/auditoria-supabase.sh --gerar   # imprime a foto atual, para atualizar o esperado
# Variaveis: PGHOST PGPORT PGUSER PGPASSWORD [PGDATABASE=postgres] [PGSSLMODE=require]
set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
esperado="$root/docs/auditoria-supabase-esperado.txt"
modo="${1:-conferir}"

for name in PGHOST PGPORT PGUSER PGPASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::Configuracao obrigatoria ausente: $name" >&2
    exit 2
  fi
done
# Remove quebras de linha coladas por engano junto com a senha.
PGPASSWORD="${PGPASSWORD//$'\r'/}"; PGPASSWORD="${PGPASSWORD//$'\n'/}"
export PGPASSWORD PGDATABASE="${PGDATABASE:-postgres}" PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}" PGAPPNAME=auditoria-inventario

consulta() {
  # psql local quando existir; senao, o cliente oficial em container (como no backup).
  if command -v psql >/dev/null 2>&1 && [[ -z "${AUDITORIA_USAR_DOCKER:-}" ]]; then
    psql -X -q -At -v ON_ERROR_STOP=1 -f "$1"
  else
    docker run --rm -i --network host \
      -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCONNECT_TIMEOUT -e PGAPPNAME \
      postgres:18 psql -X -q -At -v ON_ERROR_STOP=1 -f - < "$1"
  fi
}

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

consulta "$root/scripts/auditoria-supabase-foto.sql" | LC_ALL=C sort > "$work/atual.txt"
if [[ ! -s "$work/atual.txt" ]]; then
  echo "::error::A foto da configuracao veio vazia." >&2
  exit 1
fi
if [[ "$modo" == --gerar ]]; then
  cat "$work/atual.txt"
  exit 0
fi

resumo() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && cat >> "$GITHUB_STEP_SUMMARY" || cat >/dev/null; }
falhou=false

consulta "$root/scripts/auditoria-supabase-regras.sql" > "$work/violacoes.txt"
if [[ -s "$work/violacoes.txt" ]]; then
  falhou=true
  echo "REGRAS VIOLADAS:"
  sed 's/^/  - /' "$work/violacoes.txt"
  { echo '### Regras de seguranca violadas'; echo; sed 's/^/- /' "$work/violacoes.txt"; echo; } | resumo
else
  echo "Regras fixas: nenhuma violacao."
fi

LC_ALL=C sort "$esperado" | grep -v '^#' | grep -v '^$' > "$work/esperado.txt"
if ! diff -u "$work/esperado.txt" "$work/atual.txt" > "$work/diferencas.txt"; then
  falhou=true
  echo "A CONFIGURACAO MUDOU em relacao a foto aprovada (- esperado, + atual):"
  grep -E '^[+-][^+-]' "$work/diferencas.txt" | sed 's/^/  /'
  {
    echo '### Configuracao diferente da foto aprovada'
    echo
    echo 'Linhas com `-` sumiram ou mudaram; linhas com `+` sao novas ou o novo valor.'
    echo 'Se a mudanca foi intencional, atualize `docs/auditoria-supabase-esperado.txt`.'
    echo
    echo '```diff'
    grep -E '^[+-][^+-]' "$work/diferencas.txt"
    echo '```'
  } | resumo
else
  echo "Foto da configuracao: igual a aprovada ($(wc -l < "$work/atual.txt") itens)."
fi

if [[ "$falhou" == true ]]; then
  exit 1
fi
echo "### Auditoria de seguranca aprovada" | resumo
echo "Auditoria aprovada."
