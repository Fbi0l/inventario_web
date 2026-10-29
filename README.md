# inventario_web
Sistema de inventário patrimonial

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
