# Registro das operações de tratamento de dados (LGPD, art. 37)

**Inventário Web** — atualizado em 20/11/2026 (versão 1.11.0). Revise sempre que entrar uma tabela, um campo ou um fornecedor novo.

**Papéis.** A **Embrag** e a **ASBRAS** usam o sistema em conjunto para controlar os equipamentos da equipe e são as **controladoras** dos dados. O sistema é de uso interno, com acesso por convite e três perfis (administrador, operador e consulta).

## Operações

| # | Operação | Dados | Titular | Finalidade | Base legal | Onde fica | Quem acessa | Por quanto tempo |
|---|---|---|---|---|---|---|---|---|
| 1 | Contas de acesso | e-mail, senha (só o hash), perfil, último acesso, bloqueio, versão e data do aceite do termo de uso | usuários | entrar no sistema e controlar o que cada perfil pode fazer | relação de trabalho ou de prestação de serviço (art. 7º, V) | Supabase Auth (`auth.users`), `perfis_usuarios` | o próprio usuário; administradores | até a pessoa deixar de usar o sistema (exclusão da conta) |
| 2 | Cadastro do retirante | nome, CPF, telefone (opcional) | usuários que retiram equipamentos | identificar quem retira e preencher o termo de responsabilidade | art. 7º, V | `dados_retirantes` | **só administradores** (RLS) | até a exclusão da conta |
| 3 | Retiradas e devoluções | equipamento, data e hora, local da ação, estado na saída e na volta, ocorrências, previsão de devolução | retirantes | saber com quem está cada item e identificar atrasos | art. 7º, V | `movimentacoes` | equipe autorizada, conforme o perfil | 5 anos após a devolução |
| 4 | Termo de responsabilidade | nome, CPF, equipamento, datas e condições, em PDF gerado a partir do modelo oficial | retirantes | responsabilizar quem ficou com o equipamento e apurar perdas e danos | exercício regular de direitos (art. 7º, VI) e art. 7º, V | `termos_equipamentos` (conteúdo só por função do servidor); modelo no bucket privado `modelos-termos` | o próprio retirante e administradores | 5 anos após a devolução |
| 5 | Equipamentos | TAG, patrimônio, descrição, responsável, localização, situação, valor | — (o campo "responsável" pode conter nome de pessoa) | controle patrimonial | legítimo interesse (art. 7º, IX) | `equipamentos` | equipe autorizada | enquanto o item existir; ciclos arquivados ficam como histórico |
| 6 | Convites | hash do link, perfil, validade, quem criou e quem usou | usuários | dar acesso com segurança | legítimo interesse (art. 7º, IX) | `convites_cadastro` | só funções do servidor e administradores | histórico |
| 7 | Auditoria | quem, quando e o que mudou em ações administrativas (sem CPF, telefone ou senha) | usuários | rastrear alterações e prevenir fraude | legítimo interesse e segurança (arts. 7º, IX, e 46) | `auditoria` | só administradores | 5 anos |
| 8 | Relatórios exportados | colunas do relatório escolhido (PDF, Excel ou CSV), gerados no próprio aparelho | retirantes | prestação de contas interna | art. 7º, IX | arquivo no aparelho de quem exportou | quem exporta e quem recebe | fora do sistema: seguir a política interna das empresas |
| 9 | Leitura de QR Code | imagem da câmera, processada só no aparelho, sem gravar | — | localizar o equipamento | — | não é armazenada | — | — |

## Fornecedores (operadores)

| Fornecedor | O que faz | Onde | Observação |
|---|---|---|---|
| Supabase | banco de dados, login, armazenamento do modelo do termo e funções `register-user` e `manage-users` | **Estados Unidos (Oregon, us-west-2)** | dados principais, inclusive CPF: **transferência internacional** (art. 33) |
| GitHub (Pages e Actions) | hospeda o site; roda o backup diário, a auditoria semanal e o check-up | Estados Unidos | o site não guarda dados; o backup sai criptografado (age) e fica 14 dias (transferência internacional, art. 33) |
| Cloudflare R2 (opcional) | cópia externa do backup, se configurada | conforme a conta | só arquivos criptografados |
| jsDelivr e SheetJS (CDN) | entregam bibliotecas ao navegador | global | recebem só o pedido do arquivo (IP e navegador); integridade conferida (SRI) |
| Have I Been Pwned | confere se a senha nova já vazou | global | recebe só os 5 primeiros caracteres do hash da senha |

O sistema **não usa** cookies de rastreamento, analytics, pixels nem inteligência artificial.

## Transparência

- **Aviso de privacidade** na tela de entrada, no formulário de cadastro (onde o CPF é pedido), na tela do termo e na página Privacidade (menu e rodapé). Texto único em `#privacyNoticeTpl` no `index.html`.
- **Termo de uso do sistema** aceito por cada usuário no primeiro acesso e a cada versão (`TERMO_USO_VERSAO` no `app.js`; registro em `perfis_usuarios`). Não substitui o termo de responsabilidade dos equipamentos.

## Segurança (art. 46)

- RLS em todas as tabelas; CPF e telefone só para administradores; termo de responsabilidade só por função do servidor.
- Check-up automático a cada envio (banco fictício, interface, termo PDF, acessibilidade no navegador) e backup diário criptografado com restauração ensaiada.
- Auditoria semanal da configuração do Supabase com o usuário `auditoria_leitura`, que não lê nenhum dado (`AUDITORIA_SUPABASE.md`).
- Dependabot avisa de atualizações e falhas conhecidas nas bibliotecas de teste e nas ações do GitHub.

## Direitos dos titulares (art. 18)

- **Acesso e cópia:** o administrador vê e exporta os dados do usuário; o retirante vê os próprios termos no sistema.
- **Correção:** o administrador edita nome, CPF e telefone em **Usuários**.
- **Exclusão:** o administrador exclui a conta; os termos de responsabilidade ficam pelo prazo de guarda (5 anos após a devolução), com a titularidade desligada da conta, porque servem para apurar perdas e danos.
- Prazo de resposta: até 15 dias (art. 19, II).

## Pendências

- [ ] **Transferência internacional:** o banco fica nos Estados Unidos. Escolher entre (a) migrar o projeto para São Paulo (sa-east-1), como o Carreta+ e o Avaliação Física, o que elimina a transferência; ou (b) manter e garantir a base do art. 33, com as cláusulas-padrão da Resolução CD/ANPD nº 19/2024 no contrato com o fornecedor.
- [ ] Indicar o encarregado (DPO) ou um canal de contato sobre dados da Embrag e da ASBRAS. Até lá, o canal é o administrador do sistema.
- [ ] Rotina de exclusão após 5 anos (hoje manual, pelo administrador).
- [ ] Avaliar pedir o CPF só na primeira retirada, e não no cadastro de quem tem só o perfil Consulta.
