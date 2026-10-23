# Importação de equipamentos

## Instalação

1. No SQL Editor do Supabase, execute somente `ATUALIZACAO_IMPORTACAO_PLANILHA.sql`. Requer as atualizações de perfis e arquivamento existentes. O script instala a função e os campos de origem/data; não importa nem apaga equipamentos.
2. Publique os arquivos atualizados e o novo `importar-planilha.js`. A pasta `SITE_PUBLICAR` contém as cópias necessárias. Não envie sua planilha ao GitHub ou à pasta de publicação.
3. Feche abas antigas, reabra o sistema e confira **Versão 1.3.0**. Não é necessário atualizar `manage-users`.

## Utilização

1. Entre como administrador e abra **Equipamentos → Importar planilha**.
2. Escolha o arquivo `.xlsm`, `.xlsx` ou `.csv` no seu computador. O arquivo é lido no navegador e as macros não são executadas. A biblioteca SheetJS 0.20.3 é carregada do CDN oficial apenas quando necessário.
3. Escolha a aba. Se houver **Cadastro**, ela será selecionada automaticamente. O cabeçalho precisa conter **TAG** e **Descrição**, dentro das primeiras 20 linhas.
4. Confira a prévia. O sistema identifica TAG ou patrimônio repetido no arquivo e no ciclo ativo. Os campos de código de origem e data de aquisição são preservados. Patrimônio zero fica sem valor; identificadores com zeros à esquerda são preservados quando presentes no arquivo.
5. Para equipamentos **Em uso**, escolha explicitamente entre **não importar essas linhas** ou **importar como Disponível e registrar as retiradas depois**. Nesse segundo caso, a situação original será anotada nas observações. O sistema não inventa responsáveis, datas ou termos de retiradas.
6. O botão informa quantos equipamentos válidos serão enviados. Linhas inválidas, duplicadas ou ignoradas ficam fora do envio, conforme a prévia e a confirmação. Corrija os erros na planilha e selecione-a novamente quando necessário.
7. Confirme e aguarde o resultado. O banco confere novamente as duplicidades. Nenhum equipamento existente é sobrescrito.

Limites: 10 MB por arquivo e 2000 equipamentos por lote. Estado e Situação vazios viram **Bom** e **Disponível**. São aceitos os mesmos estados do cadastro e as situações **Disponível, Manutenção, Baixado**; outras situações exigem correção no arquivo. Datas aceitas: datas do Excel, `dd/mm/aaaa` ou `aaaa-mm-dd`, entre 1900 e 2100. Valores devem ser não negativos e ter até duas casas decimais.

O campo ID da planilha é salvo como **Código de origem**; o sistema mantém seu próprio UUID para QR Codes e relacionamentos. Código de origem e data de aquisição podem ser conferidos em **Editar** e na exportação CSV de equipamentos.

## Confiabilidade e permissões

A função SQL exige administrador autenticado. Importa somente no ciclo ativo e não executa operações de retirada/devolução. O lote é transacional: um erro de validação no servidor desfaz os novos cadastros daquele envio. Duplicidades são ignoradas e relatadas. O bloqueio da tabela coordena a importação com o arquivamento e impede duas importações simultâneas de cadastrar o mesmo identificador.

Se houver falha de conexão, tente confirmar novamente com a mesma prévia. O lote tem um identificador que impede a repetição da importação, mesmo se a resposta anterior não tiver chegado ao navegador. Se você alterar a seleção depois de uma resposta incerta, selecione o arquivo novamente para criar outro lote; o banco continuará verificando duplicidades.

A planilha original não é armazenada no sistema ou publicada no repositório. Somente as linhas válidas confirmadas são enviadas ao banco.

## Verificação após publicar

- Conferir a prévia do arquivo original, escolher como tratar Em uso e revisar conflitos com os equipamentos já cadastrados.
- Importar e conferir as contagens e os campos de alguns itens no cadastro.
- Selecionar o mesmo arquivo novamente: os equipamentos existentes devem aparecer como duplicados.
- Conferir que Operador e Consulta não têm acesso à importação.
