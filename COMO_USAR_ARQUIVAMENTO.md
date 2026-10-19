# Arquivamento do inventário por ciclos

Este recurso **não apaga** equipamentos nem movimentações. A opção **Arquivos anteriores** aparece somente para o perfil Administrador.

## Antes de publicar

1. Faça backup do banco Supabase (incluindo equipamentos e movimentações). CSVs são úteis, mas não substituem backup completo.
2. Em Supabase > SQL Editor, no projeto correto, execute **ATUALIZACAO_ARQUIVAMENTO_CICLOS.sql**. **Não reexecute** os scripts de criação originais.
3. Verifique que o SQL terminou com *Success* e não ocorreu erro em políticas, índices ou funções.
4. Só então aprove o Pull Request para publicar a nova interface no Cloudflare Pages e GitHub Pages.
5. Atualize o navegador com Ctrl+F5 e valide com uma conta Administrador e outra Operador/Consulta.

## Como funciona

- A opção **Arquivar ciclo atual** move equipamentos **e** movimentações para o mesmo arquivo lógico, sem excluir registros.
- **Não permite arquivar** quando existe equipamento em uso ou retirada pendente de devolução.
- Abre listas atuais vazias (equipamentos, retiradas/devoluções, painel, relatórios e exportações CSV).
- Na seção Arquivos anteriores, o administrador pode consultar os registros e exportar dois CSVs.
- **Restaurar** devolve um arquivo às listas ativas somente quando as listas ativas estão vazias. Para recuperar um histórico, arquive o ciclo atual antes, se necessário.
- Contas e perfis de usuário **não são arquivados**.
- A operação é transacional e o servidor verifica o perfil Administrador. Registros arquivados não podem ser movimentados pelos RPCs normais.
- **Arquivo restaurado** é indicado na lista de arquivos e não pode ser restaurado uma segunda vez.
- Confirme os resultados em equipamentos, retiradas/devoluções, relatórios, e exportação antes de utilizar com dados reais.

## Verificação sugerida

Em um ambiente de testes (preferencial), cadastre um equipamento de teste, registre uma retirada e tente arquivar; o banco deve recusar. Registre a devolução e arquive. As listas devem ficar vazias. Confira o histórico em Arquivos anteriores; após restaurar, confirme que o registro reaparece nas listas ativas.

## Atenção

O campo TAG pode ser reutilizado após arquivar, pois a exclusividade passa a valer entre equipamentos **ativos**. É uma estratégia para ciclos separados; use o número patrimonial e o identificador UUID quando precisar referenciar itens históricos sem ambiguidade.
