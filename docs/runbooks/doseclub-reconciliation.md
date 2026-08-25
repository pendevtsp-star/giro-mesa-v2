# Integração operacional GiroMesa ↔ Dose Club

## Escopo e fonte de verdade

Esta integração opera exclusivamente por **consumo de doses pré-pagas**. Não há reserva, custódia ou consumo de garrafa do cliente.

- O GiroMesa é a autoridade da assinatura comercial do combo; o Dose Club é a fonte de verdade da associação ao clube, elegibilidade e saldo de doses.
- O GiroMesa é a fonte de verdade da comanda, KDS, venda/fiscal e estoque físico em mililitros.
- `doseclub_redemptions` registra a orquestração local por item da comanda; não substitui o ledger de doses do Dose Club.
- Os sistemas mantêm bancos separados e se comunicam somente pela API M2M autenticada.

## Configuração e ativação

### Combo com provisionamento automático

O plano publicado no GiroMesa precisa conter o entitlement explícito `doseclub.subscription`,
`doseclub` ou `bundle`. Depois do `CHECKOUT_PAID` confirmado pelo Asaas, a mesma transação que
ativa a assinatura grava `doseclub.provisioning_requested` na outbox. O worker:

1. relê a assinatura e os entitlements vigentes;
2. cria uma integração `pending` por unidade e deriva uma credencial HMAC exclusiva, sem gravar o token;
3. chama `POST /v1/internal/integrations/giromesa/provision` no Dose Club;
4. o Dose Club faz upsert idempotente de tenant, proprietário federado, filiais, contas M2M,
   mappings de tenant/filial e entitlement de estoque compartilhado;
5. o worker confirma o `health` de cada unidade e somente então marca a integração como `active`.

Configure no GiroMesa `DOSECLUB_PROVIDER_ENABLED=true`, `DOSECLUB_API_BASE_URL`,
`DOSECLUB_PROVISIONING_KEY`, `DOSECLUB_CREDENTIAL_SECRET` e `GIROMESA_API_BASE_URL`. No Dose Club,
configure o mesmo `GIROMESA_PROVISIONING_KEY` e `GIROMESA_FEDERATION_ISSUER`. As chaves devem ter ao
menos 32 caracteres e as URLs devem usar HTTPS em produção.

Produtos legados continuam em `waiting_product_mappings` até serem relacionados por UUID no painel
de Integrações do Dose Club. Não existe fallback por nome. Clientes também precisam de um mapping
real antes da primeira consulta de saldo. Cancelamento ou downgrade da assinatura enfileira a mesma
reconciliação e revoga as contas M2M e o estoque compartilhado.

### Ativação manual legada

No Dose Club:

1. mantenha o tenant em `trial` ou `active`, com `inventoryMode=giromesa` e entitlement ativo `integration.shared_inventory`;
2. crie uma `IntegrationAccount` ativa para o provider `giromesa`, com `clientId`, `secretRef` e, se aplicável, `branchId`;
3. disponibilize o segredo indicado por `secretRef` no ambiente da API;
4. crie os mappings `customer`, `branch` e `product`. Os IDs externos são, respectivamente, os UUIDs de cliente, unidade e produto do GiroMesa.

No GiroMesa:

1. defina `DOSECLUB_PROVIDER_ENABLED=true` na API e no worker;
2. disponibilize o mesmo segredo em uma variável de ambiente, por exemplo `DOSECLUB_INTEGRATION_KEY`;
3. como `owner`, configure `POST /api/v1/organizations/:organizationId/growth/integrations/doseclub` com:

```json
{
  "unitId": "<uuid-da-unidade-ou-null>",
  "credentialReference": "DOSECLUB_INTEGRATION_KEY",
  "config": {
    "apiBaseUrl": "https://doseclub.exemplo",
    "clientId": "<client-id-da-integration-account>"
  }
}
```

4. ative por unidade com `POST /api/v1/organizations/:organizationId/units/:unitId/integrations/doseclub/activate`.

A ativação somente grava estado `active` depois de um `GET /v1/integrations/giromesa/health` autenticado com `x-giromesa-client-id` e `x-giromesa-integration-key`. Em produção, a URL do Dose Club deve usar HTTPS. Uma configuração específica da unidade prevalece sobre a configuração da organização.

## Fluxo real de consumo

1. A comanda precisa ter um cliente vinculado. O Ops consulta `GET /api/v1/organizations/:organizationId/units/:unitId/integrations/doseclub/tabs/:tabId/memberships`; o GiroMesa repassa cliente, unidade e, opcionalmente, produto ao Dose Club.
2. O atendente escolhe um clube elegível e adiciona a quantidade de doses. O item entra na comanda como pré-pago, por R$ 0, sem modificadores, ligado ao produto local que representa a bebida e ao `externalClubId`.
3. Ao enviar a comanda, o GiroMesa reserva primeiro o saldo no Dose Club por `POST /v1/integrations/giromesa/consumption-reservations`. Saldo insuficiente, mapping ausente, clube inativo ou indisponibilidade impedem o envio; uma reserva já criada é cancelada se a transação local não concluir.
4. Na transação local, o resgate passa para `commit_pending`, o pedido é enviado ao KDS e o evento `pos.order.sent` é persistido na outbox.
5. O worker processa `pos.order.sent`: primeiro baixa o estoque físico do GiroMesa em mililitros; somente depois confirma a reserva por `POST /v1/integrations/giromesa/consumption-reservations/:operationId/commit`. O saldo de doses só é consumido no `commit`.

Pedidos QR públicos não aceitam Dose Club. Itens Dose Club também não podem ser movidos ou divididos, porque o saldo pertence ao cliente e ao clube escolhidos na comanda original.

## Cancelamento e reversão

O cancelamento do item persiste `pos.item.canceled` e marca o resgate como pendente. O worker reverte primeiro o estoque físico e consulta `GET /v1/integrations/giromesa/operations/:operationId`:

- operação `reserved`: cancela a reserva em `POST .../consumption-reservations/:operationId/cancel`, sem consumir saldo;
- operação `committed`: cria uma reversão em `POST .../consumption-reversals` e devolve as doses;
- operação `canceled`, `expired` ou `reversed`: trata como resultado final idempotente.

## Idempotência e estados

Cada item de comanda possui um único registro local e uma chave estável por etapa (`reserve`, `commit`, `cancel` e `reverse`), enviada no header `Idempotency-Key` e, quando exigido pelo contrato, também no corpo. O Dose Club impõe unicidade por conta de integração, item externo e chave; repetir a mesma requisição retorna a operação existente, enquanto reutilizar a chave com conteúdo diferente retorna conflito.

- Estados remotos: `reserved`, `committed`, `canceled`, `expired`, `reversed`.
- Transições locais usadas no fluxo: `pending_reservation`, `reserved`, `commit_pending`, `committed`, `cancel_pending`, `canceled`, `expired` e `reversed`. O schema também aceita `reverse_pending` e `failed`, embora o fluxo atual não os grave explicitamente.
- A reserva remota expira automaticamente; o TTL padrão é 120 segundos e pode ser configurado no Dose Club por `GIROMESA_M2M_RESERVATION_TTL_SECONDS` entre 30 e 900 segundos.

## Falhas, retries e DLQ

- Timeout, falha de rede, HTTP `408`, `429` e `5xx` são repetidos pela outbox com backoff exponencial limitado a uma hora.
- Erros permanentes, como credencial/configuração inválida ou resposta incompatível, vão direto para dead letter.
- Erros transitórios do Dose Club vão para dead letter após 12 tentativas.
- A outbox grava `DEAD_LETTER:<código>`, emite `outbox.delivery_dead_lettered` e o resgate conserva `lastErrorCode`/`lastErrorMessage` para diagnóstico.
- Reprocessar exige corrigir primeiro credencial, mapping, entitlement, disponibilidade ou divergência remota. As chaves idempotentes tornam seguro repetir a entrega; não altere saldo diretamente em nenhum dos bancos.

## Checklist de Go Operacional

- [ ] migrations aplicadas no GiroMesa e no Dose Club;
- [ ] plano combo publicado no GiroMesa com entitlement Dose Club explícito;
- [ ] chaves de provisionamento iguais nos dois serviços e `DOSECLUB_CREDENTIAL_SECRET` guardado no cofre;
- [ ] tenant Dose Club ativo, `inventoryMode=giromesa` e entitlement `integration.shared_inventory` ativo;
- [ ] `IntegrationAccount` gerenciada ativa e mappings reais de cliente e produto (tenant e unidade são automáticos);
- [ ] credencial gerenciada validada no health: token derivado apenas no GiroMesa e somente hash armazenado no Dose Club;
- [ ] `DOSECLUB_PROVIDER_ENABLED=true` na API e no worker do GiroMesa;
- [ ] ativação por unidade concluída e health M2M respondendo `status=ok`;
- [ ] teste conjunto real de consulta, reserva, envio/KDS, baixa em ml e `commit`;
- [ ] teste conjunto real de cancelamento antes do commit e reversão depois do commit;
- [ ] retry e dead letter observados sem duplicar baixa física nem doses;
- [ ] alarmes para outbox em dead letter, `lastErrorCode`, resgates pendentes e reservas próximas da expiração;
- [ ] credenciais de produção, TLS e runbook de reprocessamento homologados.
