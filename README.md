# inventario_web
Sistema de inventário patrimonial

### Importar equipamentos em posse de retirantes (1.3.1)

Execute `ATUALIZACAO_IMPORTACAO_EM_USO.sql` no Supabase depois das migrações de importação e termos, antes de publicar. Não importa nem altera equipamentos ao instalar.

Na prévia da planilha, escolha **Vincular ao retirante e registrar a retirada**. A coluna Responsável representa quem está com o equipamento. Um nome correspondente a um único cadastro é sugerido; confira ou selecione o usuário correto. Cadastre primeiro quem não aparecer em Usuários. Para cada item Em uso, informe data/hora real da retirada, local da ação e avarias. O estado vem da planilha e deve ser conferido. Não há data presumida.

A confirmação cria equipamento, retirada e dados do termo na mesma transação. Em uso aparece no inventário e a retirada em Retiradas e devoluções; na devolução, o termo segue o fluxo existente. Duplicados são ignorados sem alterar equipamentos existentes. Repetir o mesmo lote não cria novas retiradas. O arquivo da planilha e seus dados não integram o repositório.
