# Atualização 1.4.0 — Consulta de termos por dia e cadastro por convite

## Instalação
1. No **Supabase > SQL Editor**, execute integralmente `ATUALIZACAO_CONVITES_CADASTRO.sql`. Esta migração cria uma tabela de convites com RLS sem acesso público e funções de reserva/consumo.
2. No terminal do projeto Supabase, publique as funções:
   ```bat
   npx supabase functions deploy manage-users
   npx supabase functions deploy register-user --no-verify-jwt
   ```
   O segundo endpoint precisa receber um pedido de cadastro sem sessão; sua autorização é o convite de uso único, verificado no servidor.
3. Publique na hospedagem os arquivos atualizados da pasta `SITE_PUBLICAR` (HTML e JS). Não publique a pasta `supabase` no site.
4. Teste com um convite novo num navegador sem sessão e confirme o perfil Consulta em Usuários (a partir da versão 1.4.5; antes era Operador). Depois teste o mesmo link novamente: ele deve ser recusado.
5. Teste a consulta de termos em **Retiradas e devoluções** escolhendo **Dia da ação** e **Retirada** ou **Devolução**.

## Comportamento
- O administrador gera um convite válido por 48 horas, de uso único e sem associação prévia ao e-mail. Encaminhe cada link de forma privada ao destinatário.
- O novo usuário preenche nome, CPF, telefone (opcional), e-mail e senha. O servidor impõe o perfil **consulta** (desde a 1.4.5; antes era operador); só o administrador pode alterar a permissão depois, em **Usuários**.
- O cadastro preenche também `dados_retirantes`, para uso nos termos.
- A consulta traz **somente termos concluídos do ciclo atual**, consultando os registros diretamente no Supabase (não se limita às últimas 500 movimentações). Quando a retirada e a devolução caíram em dias diferentes, o filtro usa o dia correspondente à ação selecionada.
- A geração do PDF permanece disponível apenas após a devolução, conforme regra já existente no sistema.

## Segurança
Não envie a chave `service_role` para o navegador; ela pertence apenas às Edge Functions. Convites são salvos somente por hash SHA-256 no banco. A reserva é atômica e permite que apenas um cadastro consuma o mesmo convite. Se uma falha ocorrer, a função tenta reverter o usuário incompleto e liberar a reserva; uma reserva abandonada pode expirar após cinco minutos.

## Limitações
A consulta, nesta versão, não inclui arquivos de ciclos anteriores. A listagem mostra no máximo 10.000 registros por busca; um aviso aparece se atingir esse limite. Confirme os testes de integração no ambiente Supabase antes de mesclar a atualização na versão oficial.
