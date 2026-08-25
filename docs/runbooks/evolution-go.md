# Evolution Go no CRM

O GiroMesa usa exclusivamente a Evolution Go `0.7.2`, fixada por digest. Cada unidade recebe uma instância e um token derivado; somente o hash de referência fica persistido. O serviço e seu PostgreSQL usam a rede interna `evolution-private`.

## Ativação

1. Ative a licença da Evolution Go pelo acesso local `127.0.0.1:4000`.
2. Confirme as variáveis `WHATSAPP_EVOLUTION_*` e mantenha `WHATSAPP_EVOLUTION_TOKEN_SECRET` imutável após criar instâncias.
3. Altere `WHATSAPP_PROVIDER_ENABLED=true` e reprocesse o deploy.
4. No CRM da unidade, salve a conexão e abra o QR Code uma única vez.
5. Leia o QR no WhatsApp e use **Atualizar status**. Somente `LoggedIn=true` libera envios.

O polling de status nunca chama `connect`; reconexão é uma ação explícita para evitar esgotamento de sessões no PostgreSQL da Evolution.

## Operação do CRM

- A inbox usa o outbox/realtime existente e cai para polling quando o WebSocket não confirma a assinatura.
- Status, prioridade, responsável, SLA, respostas rápidas e tentativas de automação ficam persistidos por organização e unidade.
- Imagem, áudio, vídeo e PDF são validados por assinatura, limitados a 3 MB e gravados sob `MEDIA_ROOT`; o banco guarda somente chave escopada, tipo, tamanho e hash.
- Campanhas podem usar variação B, grupo de controle e janela de atribuição configurável. A atribuição é last-touch e nunca credita o grupo de controle.
- Falhas definitivas de automação podem ser reenfileiradas pela tela. Timeout ambíguo de envio não é repetido automaticamente para evitar duplicidade.

## Evidência mínima antes de produção

- `/server/ok` saudável e bancos `evogo_auth`/`evogo_users` acessíveis;
- status persistido como `ready` após `LoggedIn=true`;
- mensagem manual recebida no aparelho e webhook gravado na inbox;
- imagem, áudio, vídeo e PDF enviados e recebidos no aparelho correto;
- recibos `delivered` e `read` refletidos na campanha;
- palavra `SAIR` revoga o consentimento e bloqueia novos disparos de marketing;
- reinício dos containers preserva a sessão e não duplica mensagens.

Sem essa evidência, a infraestrutura está instalada, mas o canal continua não homologado.
