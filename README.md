# inventario_web
Sistema de inventário patrimonial

### Revisão de segurança do site (1.5.5)

- **Bibliotecas externas com verificação de integridade:** as seis bibliotecas carregadas de CDN (Supabase, QR Code, leitor de QR, PDF, fontes e planilhas) só rodam se forem exatamente os arquivos conferidos. Uma cópia adulterada no CDN é bloqueada pelo navegador.
- **Política de segurança (CSP):** o site só aceita scripts dele mesmo e desses CDNs, e só se conecta ao Supabase do projeto.
- **Exportações CSV sem fórmulas:** texto que começa com `=`, `+`, `-` ou `@` recebe um apóstrofo e é aberto no Excel como texto, sem virar fórmula.
- **Cadastro por convite** não informa mais se um e-mail já tem conta.

Para atualizar uma biblioteca, troque a versão **e** a integridade (`integrity`) juntas; o teste `tests/seguranca-site.cjs` acusa o que ficar diferente. Para aplicar esta versão: publique o site (automático pelo GitHub Pages) e republique a função de cadastro:

```bat
npx.cmd supabase@latest functions deploy register-user --no-verify-jwt
```

### Convites de administrador excluído são cancelados (1.5.4)

Ao excluir a conta de um administrador, os convites que ele gerou e que ainda não foram usados **vencem na hora**, como se tivessem sido cancelados. Antes, eles continuavam válidos por até 48 horas. Vale também para exclusões feitas direto no painel do Supabase. Convites já usados continuam no histórico, sem alteração.

Para aplicar, execute `ATUALIZACAO_1_5_4_CONVITES_ADMIN_EXCLUIDO.sql` no SQL Editor, após backup. Não é preciso republicar o site nem as funções.

### Senhas vazadas recusadas (1.5.3)

Senhas novas e trocas de senha (mínimo de 8 caracteres, como antes) agora são **recusadas se já apareceram em vazamentos de dados conhecidos** (base Have I Been Pwned, a mesma usada pelo Supabase no plano Pro). A senha nunca sai do servidor: só os 5 primeiros caracteres do seu hash SHA-1 são consultados, e a comparação final é feita na função. Se o serviço de consulta não responder, a senha é aceita, para não travar cadastros. Quem já tem conta continua entrando com a senha atual.

Vale para o cadastro por convite, a criação de usuário e a troca de senha pelo administrador. Não há SQL nesta versão. Para aplicar, republique as duas funções e o site:

```bat
npx supabase functions deploy manage-users
npx supabase functions deploy register-user --no-verify-jwt
```

### Auditoria automática de segurança (1.5.2)

Toda segunda-feira, um workflow confere, **somente para leitura**, a configuração de segurança do Supabase (RLS, políticas, permissões, funções e buckets) e falha, gerando alerta, se algo mudar ou violar uma regra básica. Ele usa o usuário de banco `auditoria_leitura`, que não tem acesso a nenhum dado. A mesma versão remove de `anon`/`authenticated` as permissões `TRUNCATE`, `TRIGGER`, `REFERENCES` e `MAINTAIN` em equipamentos e movimentações, que o sistema não usa.

Para aplicar: execute `ATUALIZACAO_1_5_2_AUDITORIA_LEITURA.sql`, defina a senha do usuário e crie o segredo `SUPABASE_AUDIT_DB_PASSWORD`, conforme [AUDITORIA_SUPABASE.md](AUDITORIA_SUPABASE.md). Não é preciso republicar o site nem as funções.

### Cancelar convites pendentes (1.5.1)

Em **Usuários**, o quadro de convites lista os links ainda não usados e dentro da validade, com quem gerou cada um. O botão **Cancelar** faz o link parar de funcionar na hora (o convite vence imediatamente) e registra "Cancelou convite" na Auditoria. O link em si nunca é guardado nem exibido de novo; só o resultado da geração aparece uma vez.

Não há SQL nesta versão. Para aplicar, publique a função `manage-users` (Verify JWT ligado) e o site.

### Trilha de auditoria (1.5.0)

O menu **Auditoria**, visível só para administradores, mostra quem fez cada ação administrativa e quando:

- **Usuários:** convites gerados, cadastros por convite, criação, mudança de perfil (antes → depois), alteração de dados do retirante (apenas quais campos mudaram), bloqueio, desbloqueio, troca de senha e exclusão.
- **Equipamentos e movimentações** editados diretamente: criação, alteração com valor antes e depois de cada campo, e exclusão.
- **Arquivamento, restauração e exclusão de ciclos**, e **importações de planilha**.

Retiradas e devoluções não são duplicadas: continuam no histórico de movimentações. Senhas, CPF e telefone nunca são gravados na auditoria. Os registros não podem ser alterados nem apagados pelo sistema, e continuam lá mesmo que a conta do autor seja excluída (aparece "Conta excluída"). A tela mostra os 1.000 mais recentes, com busca, filtro por tipo e exportação CSV.

Para aplicar, nesta ordem:

1. Faça backup e execute `ATUALIZACAO_1_5_0_AUDITORIA.sql` no SQL Editor do Supabase.
2. Publique as duas funções (mantendo as configurações de JWT de cada uma):
   ```bat
   npx supabase functions deploy manage-users
   npx supabase functions deploy register-user --no-verify-jwt
   ```
3. Publique o site (`index.html` e `app.js`, ou a pasta `SITE_PUBLICAR`), se a hospedagem não atualizar sozinha.

Até o passo 1 ser feito, as funções novas continuam funcionando, só não gravam a auditoria. A tela mostra um aviso se a tabela ainda não existir.

### Convites criam contas como Consulta (1.4.5)

Quem se cadastra por link de convite passa a entrar com o perfil **Consulta**, e não mais **Operador**. Assim, um link que chegue a outra pessoa não dá permissão para registrar retiradas e devoluções. Para quem precisa operar, o administrador altera o perfil em **Usuários** depois do cadastro. Contas já existentes não mudam.

Quem tem perfil Consulta continua podendo ser escolhido como retirante e ver os próprios termos.

Para aplicar, republique a função de cadastro e o site:

```bat
npx supabase functions deploy register-user --no-verify-jwt
```

Depois publique `index.html` (ou a pasta `SITE_PUBLICAR`) na hospedagem, se ela não for atualizada automaticamente. Não há SQL nesta versão.

### Integridade de usuários e situação dos equipamentos (1.4.4)

Execute `ATUALIZACAO_1_4_4_INTEGRIDADE.sql` no SQL Editor do Supabase, após backup. Não é preciso republicar o site nem as Edge Functions, e nenhum dado é alterado ao instalar.

- **Exclusão de usuários:** contas que já cadastraram equipamentos ou registraram retiradas/devoluções agora podem ser excluídas. Os registros permanecem; apenas a referência à conta excluída fica vazia. O nome do retirante continua na movimentação e no termo. Se preferir manter essa referência, use **Bloquear acesso** em vez de excluir.
- **Situação "Em uso":** enquanto houver retirada em aberto, a edição do equipamento não permite trocar a situação para Disponível, Manutenção ou Baixado. Registre a devolução normalmente. As demais edições continuam liberadas.

Ao final, o script mostra duas conferências somente leitura. A segunda lista equipamentos que já estejam inconsistentes; se aparecer algum, edite-o, volte a situação para Em uso e registre a devolução.

### Importar equipamentos em posse de retirantes (1.3.1)

Execute `ATUALIZACAO_IMPORTACAO_EM_USO.sql` no Supabase depois das migrações de importação e termos, antes de publicar. Não importa nem altera equipamentos ao instalar.

Na prévia da planilha, escolha **Vincular ao retirante e registrar a retirada**. A coluna Responsável representa quem está com o equipamento. Um nome correspondente a um único cadastro é sugerido; confira ou selecione o usuário correto. Cadastre primeiro quem não aparecer em Usuários. Para cada item Em uso, informe data/hora real da retirada, local da ação e avarias. O estado vem da planilha e deve ser conferido. Não há data presumida.

A confirmação cria equipamento, retirada e dados do termo na mesma transação. Em uso aparece no inventário e a retirada em Retiradas e devoluções; na devolução, o termo segue o fluxo existente. Duplicados são ignorados sem alterar equipamentos existentes. Repetir o mesmo lote não cria novas retiradas. O arquivo da planilha e seus dados não integram o repositório.
