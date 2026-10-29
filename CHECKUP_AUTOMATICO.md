# Check-up automático do Inventário 1.4.3

## Objetivo

Rodar testes em ambiente **isolado** no GitHub Actions, sem acesso ao banco de produção.

**Disparos:** pull requests para `main`, mudanças em `main`, execução manual (`workflow_dispatch`) e toda segunda-feira às 09h20 UTC (~06h20 em Belém).

## O que está incluído

- **Verificações rápidas:** sintaxe JavaScript, paginação de 1.002 movimentações, lotes de autorização de termos e teste do aviso de falha parcial.
- **Testes de integração com dados fictícios:** rotinas PostgreSQL usando PGlite na memória; importação, termos, papéis, permissões e interface simulada.
- **Testes de interface/PDF em Chromium:** valida fluxo no navegador sem autenticar no Supabase oficial.

**Segurança:** os testes não usam `SUPABASE_SERVICE_ROLE_KEY`, credenciais de banco, produção nem exclusão de usuários reais. O trabalho não cria backups reais e não testa a recuperação integral dos serviços Supabase.

## Executar localmente

```powershell
npm install
npm run test:rapido
npm test
npx playwright install chromium
npm run test:navegador
```

- `npm run test:rapido` não exige instalar dependências.
- O resultado de uma execução depende das versões de dependências e do ambiente; conferir sempre o painel Actions.
- Algumas suítes de banco usam migrações históricas. Elas testam cenários isolados, **não substituem** inspeções da configuração atual do Supabase.
- A política atual do Storage difere das políticas restritivas existentes no script histórico `ATUALIZACAO_TERMOS_PDF.sql`. Não executar migrações antigas em produção apenas para deixar um teste verde.

## Como acompanhar

1. GitHub → **Actions** → **Check-up automatizado do Inventário**.
2. Abra a execução e confira o resultado dos três jobs.
3. Se algum job falhar, inspecione o log correspondente e corrija a causa antes de integrar.

**Aviso:** o workflow não bloqueia merges sozinho. Para exigir aprovação dos testes, configure uma regra de proteção da branch `main` exigindo os checks desse fluxo depois de uma execução bem-sucedida.

## Pendências de fase 2

- ~~Integrar auditoria somente de leitura ao Supabase usando credenciais de menor privilégio e autorização específica.~~ Feito: [AUDITORIA_SUPABASE.md](AUDITORIA_SUPABASE.md) (1.5.2).
- Criar backups externos criptografados, retenção, alerta por falhas e restauração agendada em infraestrutura isolada. Feito, exceto a restauração agendada: o ensaio continua manual por decisão de segurança (a chave privada não vai para o GitHub). Backup das contas de login incluído; `termo-v1.pdf` com cópia manual.
- ~~Cobrir exclusão de contas com histórico/convites e testar explicitamente a migração final de privacidade.~~ Feito em `tests/exclusao-contas-db.cjs`.
- ~~Fixar e versionar arquivo de lock de dependências para instalações totalmente reproduzíveis.~~ Feito: `package-lock.json` e `npm ci` no check-up.

A presente proposta não altera o esquema do banco oficial nem dispara backup real.
