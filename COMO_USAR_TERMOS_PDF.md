# Termo de responsabilidade automático

## Instalação (nesta ordem)

1. No SQL Editor do Supabase, execute somente `ATUALIZACAO_TERMOS_PDF.sql`. Requer as atualizações de perfis e arquivamento já instaladas. Não reexecute o schema original. A atualização não apaga dados e cria o bucket **privado** `modelos-termos`.
2. No Dashboard do Supabase, abra **Storage → modelos-termos**. Confirme que o bucket está **Private** (Public desativado). Envie o PDF original do termo, pelo seu computador, com o nome exato **`termo-v1.pdf`**, na raiz do bucket. Esse arquivo é enviado somente ao Supabase: não o coloque na pasta do site ou no GitHub. Não substitua o arquivo por outro modelo futuramente; uma nova versão deverá usar outro nome para preservar as emissões antigas.
3. Com a versão atualizada do repositório no computador, publique a função de usuários:

   ```bash
   npx supabase functions deploy manage-users --project-ref meqpwvdisjuoacepkljs
   ```

4. Publique o frontend atualizado. Além de `index.html`, `app.js` e `styles.css`, inclua `termos.js` e `termo-fontes.js`. A pasta `SITE_PUBLICAR` contém os cinco arquivos. O carregamento de pdf-lib e fontkit utiliza CDN, assim como as bibliotecas anteriores do sistema.
5. Atualize a página e peça aos operadores para atualizar as abas abertas.
6. Como administrador, vá a **Usuários → Dados do retirante** e complete o cadastro das contas existentes, incluindo sua própria conta e as dos operadores que farão a conferência. Informe nome completo, CPF válido e telefone opcional. Os novos usuários já terão esses campos no cadastro.

## Uso

- Em **Registrar retirada**, escolha o equipamento e o retirante cadastrado. O usuário atual vem selecionado se tiver cadastro completo. Todos os perfis podem ser retirantes; somente Administrador e Operador registram movimentações. Contas bloqueadas e cadastros incompletos não aparecem na seleção.
- Informe local da ação, destino quando necessário, estado e observações. Nome e CPF vêm do cadastro, sem digitação repetida.
- Na devolução, confira horário, conservação e ocorrência. O conferente é o usuário conectado, identificado pelo cadastro completo.
- Ao confirmar a devolução, o sistema prepara o termo e apresenta **Baixar PDF**. Essa etapa de download depende do clique para funcionar também em navegadores de celular.
- Para emitir novamente, use **Termo PDF** na linha da retirada já devolvida. Administradores também podem emitir em **Arquivos anteriores → Consultar**.
- O sistema busca o PDF original no bucket privado para preservar seu formato. A quantidade é 1 por ficha, pois cada retirada corresponde a um equipamento. Os horários são exibidos em UTC-3. Textos longos seguem em anexo. As assinaturas são feitas no papel, após imprimir.

## Privacidade do modelo

O repositório contém somente código e fontes tipográficas abertas. O documento original é enviado separadamente ao Supabase pelo administrador. O código não inclui o PDF, imagens dos logotipos, base64 do modelo nem links públicos/assinados para ele.

Cada emissão usa `download()` com a sessão autenticada. As policies permitem ler somente `termo-v1.pdf` aos perfis Administrador e Operador, e negam o modelo a visitantes e Consulta. Policies restritivas protegem esse bucket mesmo que outro bucket tenha permissões mais amplas. Contas do aplicativo não podem enviar, sobrescrever ou apagar o modelo; essa manutenção é feita no Dashboard por um administrador do projeto.

O navegador autorizado recebe o modelo para produzir o termo. Quem possui permissão e baixa um documento ainda pode compartilhá-lo. O sistema não torna esses documentos públicos por conta própria. O PDF preenchido é gerado no navegador, e sua cópia histórica de dados fica protegida no banco.

## Histórico e permissões

Os dados do retirante e do equipamento são copiados no momento da retirada. A devolução registra seu próprio horário, estado, ocorrência e o nome do conferente. Alterar ou excluir posteriormente a conta do retirante não altera esses dados históricos.

CPF e telefone não entram na listagem geral de movimentações nem nos relatórios CSV. Administradores podem administrar os cadastros pessoais. Operadores veem somente nomes/identificadores na seleção e podem emitir os termos de devoluções do ciclo ativo. Consulta não emite termos. Termos arquivados ficam restritos ao administrador.

A exclusão permanente de um período remove também seus termos. A restauração mantém o vínculo entre a retirada e seu termo. As retiradas antigas continuam funcionando, mas não geram termo automaticamente, pois não possuem a cópia histórica dos dados exigidos. Não são inventados ou preenchidos retroativamente CPFs de registros antigos.

## Validação depois de instalar

1. Confirme que uma tentativa sem login de acessar o modelo é negada. Complete os dados de um retirante e de quem fará a conferência; confira também a criação de uma conta nova.
2. Registre uma retirada de teste e conclua a devolução. Baixe o PDF e confira nome, CPF, equipamento, horários, observações e conferente.
3. Feche a janela e baixe novamente pelo histórico. Alterar o cadastro do retirante não deve alterar esse termo.
4. Confira o acesso de Operador e Consulta, o uso por QR Code e a emissão de um termo arquivado como administrador.

## Testes locais

Dependências de teste: `@electric-sql/pglite`, `typescript@5`, `jsdom`, `playwright`, `pdf-lib` e `@pdf-lib/fontkit`. Instale-as fora da pasta de publicação e configure `NODE_PATH` se necessário. Os testes usam dados fictícios e não acessam o Supabase real.

```bash
node tests/termos-db.cjs
node tests/termos-users.cjs
node tests/termos-dom.cjs
# Opcional: com o Chromium do Playwright instalado
node tests/termos-ui.cjs
```

A validação do banco é feita em PostgreSQL local via PGlite, com usuários e permissões simulados. O teste DOM verifica o fluxo com respostas locais simuladas. O teste opcional de navegador usa Chromium em modo headless. Nesta preparação, o Chromium não pôde ser instalado e esse teste de navegador não foi executado. Os testes locais também verificam RLS do modelo contra visitante, Consulta e tentativas de escrita, inclusive com uma policy ampla simulada, e verificam a mensagem de erro quando o modelo privado não está disponível. Ainda é necessário validar a instalação no projeto Supabase, o envio privado do modelo, a publicação real e o uso no celular.
