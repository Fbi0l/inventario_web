# Plano de resposta a incidentes de segurança

**Inventário Web** — atualizado em 20/11/2026.

**Incidente** é qualquer situação em que dados do sistema possam ter sido vistos, copiados, alterados ou apagados por quem não devia: senha de um usuário vazada, conta de ex-funcionário ainda ativa, celular perdido com o sistema aberto, chave do Supabase exposta, termo de responsabilidade ou relatório com CPF enviado ao destino errado, alerta da auditoria semanal do Supabase.

**Responsável:** o administrador do sistema, que avisa de imediato a direção da Embrag e da ASBRAS e o encarregado de dados (quando houver). A decisão de comunicar à ANPD é das empresas, como controladoras.

## 1. Conter (na primeira hora)

- [ ] Anote **quando** e **como** soube do problema (data, hora, quem avisou).
- [ ] Conta suspeita ou de ex-funcionário: em **Usuários**, bloqueie a conta (o acesso cai na hora) e troque a senha.
- [ ] Chave vazada: no Supabase, *Project Settings → API Keys*, gere uma nova chave secreta e publique de novo as funções `register-user` e `manage-users`. Se foi a senha do banco, troque em *Database → Reset database password* e atualize o segredo do backup no GitHub.
- [ ] Alerta da **Auditoria de segurança do Supabase** (workflow semanal): veja o que mudou em relação à foto aprovada e desfaça a mudança se não foi intencional.
- [ ] Convite enviado à pessoa errada: cancele em **Usuários** e confira se alguém entrou com ele.
- [ ] Termo, relatório ou planilha com CPF enviado ao destino errado: peça a exclusão e anote quem recebeu.
- [ ] **Não apague** a tabela `auditoria`, os logs do Supabase (*Logs*) nem os backups: eles mostram o que aconteceu.

## 2. Avaliar (em até 24 horas)

1. Quais dados foram atingidos? (nome, **CPF**, telefone, termos de responsabilidade, histórico de retiradas)
2. De quantas pessoas?
3. Alguém de fato viu ou alterou, ou só poderia ter acessado? Confira a **Auditoria** e os logs.
4. Que dano isso pode causar? (uso indevido do CPF, fraude, constrangimento)

**Precisa comunicar** à ANPD e aos titulares se o incidente puder trazer **risco ou dano relevante**. Vazamento de **CPF** costuma ser considerado relevante, porque facilita fraudes.

## 3. Comunicar (em até 3 dias úteis)

Prazo da Resolução CD/ANPD nº 15/2024, contado de quando as empresas souberam que o incidente atingiu dados pessoais.

- [ ] **Direção da Embrag e da ASBRAS e encarregado:** no mesmo dia.
- [ ] **ANPD:** formulário de comunicação de incidente no site da ANPD (gov.br/anpd), enviado pelas empresas.
- [ ] **Pessoas atingidas:** aviso simples dizendo o que aconteceu, quais dados, o que já foi feito e o que a pessoa pode fazer (por exemplo, ficar atenta a uso indevido do CPF).

Modelo de aviso:

> Olá, [nome]. Em [data] identificamos [o que aconteceu, em uma frase]. Os dados seus que podem ter sido atingidos são [quais]. Já [medidas tomadas]. Recomendamos [o que fazer]. Se tiver dúvidas, fale com [contato].

## 4. Registrar e corrigir a causa

- [ ] Preencha o registro abaixo, **mesmo que não tenha sido preciso comunicar**: a ANPD pode pedir o histórico dos últimos 5 anos.
- [ ] Corrija a causa, acrescente um teste que pegaria o problema (`npm test`) e, se a mudança for de segurança, atualize `docs/auditoria-supabase-esperado.txt`.
- [ ] Se for preciso recuperar dados, siga `docs/RECUPERACAO_BACKUP.md`.

## Registro de incidentes

| Data em que soube | O que aconteceu | Dados e pessoas atingidos | Comunicou ANPD? Quando? | Comunicou titulares? Quando? | Medidas tomadas |
|---|---|---|---|---|---|
| | | | | | |
