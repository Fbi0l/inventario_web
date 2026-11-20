# Inventário Web — guia para o Claude

Sistema de inventário patrimonial **compartilhado pela Embrag e pela ASBRAS**: cadastro de equipamentos com etiqueta QR Code, retiradas e devoluções, termo de responsabilidade em PDF, relatórios (PDF, Excel, CSV), arquivamento por ciclos e auditoria. Site estático (HTML, CSS e JavaScript puros, sem build) com Supabase, no GitHub Pages, instalável no celular. Mesmo padrão do Avaliação Física e do Carreta+. Responda sempre em português do Brasil, em linguagem simples: o dono não é programador.

## Onde fica cada coisa

- Site: https://fbi0l.github.io/inventario_web/ (GitHub Pages a partir da `main`; o Cloudflare Pages também publica os PRs).
- Supabase: projeto ref `meqpwvdisjuoacepkljs`, organização **"Fabio Luan"**, região **Estados Unidos (Oregon, us-west-2)**. O conector do Supabase no Claude fica autorizado para uma organização por vez; sem ele, o dono roda o SQL no SQL Editor (ou o Claude abre o editor pelo navegador do app e aplica, com a autorização do dono).
- Banco: **arquivos `ATUALIZACAO_*.sql` na raiz**, executados uma vez no SQL Editor, na ordem do README (não há `supabase/migrations`). `supabase_schema.sql` é a base inicial.
- `app.js` (telas e regras), `termos.js` (termo de responsabilidade em PDF), `exportacoes.js`, `importar-planilha.js`, `qr-etiquetas.js`, `instalar.js`, `index.html`, `styles.css`, `sw.js`. **A pasta `SITE_PUBLICAR` é cópia do site: todo arquivo do site alterado é copiado para lá também** (os testes conferem).
- Funções: `supabase/functions/register-user` (cadastro por convite) e `manage-users`.
- LGPD: `docs/lgpd/registro-de-tratamento.md` e `docs/lgpd/plano-de-incidentes.md`. Embrag e ASBRAS são as controladoras. Aviso de privacidade: texto único em `#privacyNoticeTpl` no `index.html` (entrada, cadastro, termo e página Privacidade). Termo de uso do sistema: `#termsUseView` e `TERMO_USO_VERSAO` no `app.js` (aceite em `perfis_usuarios.termo_uso_versao`, função `aceitar_termo_uso`). **Mudou o texto do termo? Suba `TERMO_USO_VERSAO`.** Não confundir com o termo de responsabilidade dos equipamentos.
- Backup diário criptografado: `BACKUP_AUTOMATICO.md`. Auditoria semanal do Supabase: `AUDITORIA_SUPABASE.md` — **mudou tabela, política, função ou permissão? Atualize `docs/auditoria-supabase-esperado.txt` no mesmo PR.** Check-up: `CHECKUP_AUTOMATICO.md`. Dependabot: `.github/dependabot.yml`.

## Regras que não podem ser quebradas

- Toda tabela com RLS; CPF e telefone (`dados_retirantes`) só para administradores; conteúdo do termo só por `obter_termo_equipamento`.
- No site só a chave anônima/publicável; segredos nunca no repositório.
- HTML montado em texto: todo dado passa por `esc()`. CSP restrita; script externo com versão exata e `integrity` (SRI).
- Auditoria nunca grava senha, CPF ou telefone.
- Nomes acessíveis devem conter o texto visível (WCAG 2.5.3); tabelas com rolagem são focáveis.

## Versão e publicação

- A versão aparece em `index.html` (`?v=` e rodapés), `sw.js` (nome do cache) e `package.json`; registrar no topo do `README.md`, com a ordem de publicação (SQL antes do site quando o site depender do banco).
- Mudanças por **pull request** (`gh api repos/Fbi0l/inventario_web/pulls ...`; o GraphQL é bloqueado aqui), esperando o Check-up verde antes de juntar (squash).

## Testes

- `npm test` (rápido, banco fictício com PGlite e interface com jsdom) e `npm run test:navegador` (Playwright: termo PDF, auditoria, convites, exportações e **acessibilidade com axe em todas as telas**, `tests/acessibilidade-ui.cjs`). Rodam no GitHub no Check-up (navegador no ubuntu-24.04).
- Aqui no ambiente do Claude, os testes de navegador usam o Chrome instalado: `node -e "const {chromium}=require('playwright');const o=chromium.launch;chromium.launch=a=>o.call(chromium,{...a,executablePath:'/usr/bin/google-chrome'});require('./tests/acessibilidade-ui.cjs')"`.
- Mudou algo? Acrescente um caso de teste.

## Pendências

- **Transferência internacional:** o banco fica nos EUA e guarda CPF. Decidir entre migrar para São Paulo (recomendado, igual aos outros sistemas) ou manter com as cláusulas-padrão da ANPD (Res. 19/2024).
- Indicar o encarregado (DPO) ou canal de privacidade da Embrag e da ASBRAS.
- Avaliar pedir o CPF só na primeira retirada.
- Ligar no GitHub (Settings → Code security) os alertas e correções do Dependabot.
