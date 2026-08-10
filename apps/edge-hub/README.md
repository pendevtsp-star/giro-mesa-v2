# GiroMesa Edge Hub

Serviço local da unidade. Ele recebe os comandos operacionais, persiste-os antes de responder, sincroniza com a nuvem e contém as portas de integração com hardware.

## Segurança

- `/health` e `/v1/pair` são as únicas rotas públicas locais.
- O pareamento exige `Hub:EnrollmentCode` e devolve um token aleatório armazenado somente como hash.
- As demais rotas exigem `X-GiroMesa-Device-Token`.
- O banco local usa SQLCipher v4 e o processo falha de forma segura se `Hub:DatabaseKey` estiver ausente, tiver menos de 32 caracteres ou se o provedor de criptografia não estiver carregado.
- `Hub:CloudSyncKey` autentica o hub na nuvem e deve ser tratado como segredo. A API guarda apenas o hash SHA-256 da chave entregue uma única vez no cadastro do dispositivo.
- Produção exige certificado TLS local e armazenamento protegido das configurações pelo instalador Windows. Configure os segredos por cofre do instalador/serviço ou por `Hub__DatabaseKey` e `Hub__CloudSyncKey`; nunca os grave no repositório ou em logs.

Um arquivo SQLite antigo sem criptografia não é convertido automaticamente. Antes da atualização, exporte-o para um novo banco SQLCipher com `sqlcipher_export`, valide a cópia e substitua o arquivo em uma janela de manutenção. Guarde um backup protegido até validar a nova instalação.

## Sincronização Cloud ↔ Edge

- O hub persiste eventos locais e comandos recebidos da nuvem antes de confirmá-los.
- O lote usa idempotência; uma repetição idêntica é aceita e um uso conflitante da mesma chave é rejeitado.
- A organização e a unidade são derivadas da credencial do hub, nunca do corpo da requisição.
- Terminais locais não recebem credencial da nuvem: o `deviceId` identifica a origem local e é atestado pelo hub autenticado. A nuvem ainda exige que o ator seja uma membership ativa com papel na mesma organização/unidade.
- Eventos rejeitados ficam em quarentena local com o motivo. Falhas de rede mantêm a fila para nova tentativa.
- Um dispositivo revogado deixa de sincronizar imediatamente. Comandos da nuvem expirados ou já confirmados não são reenviados.
- O menu público só informa confirmação depois do ACK durável do hub; em timeout, retorna estado pendente e seguro para nova consulta/tentativa.
- O snapshot operacional recebido da nuvem fica no mesmo banco criptografado. Comandas, pedidos, KDS, transferências, unificações, divisões, serviço, gorjeta, desconto e cancelamento atualizam snapshot e fila na mesma transação, preservando a operação após reinício.
- Desconto e cancelamento só funcionam offline enquanto o cache de gestores escopados estiver vigente e o PIN Argon2 for validado localmente. O cache nunca é exposto pelos endpoints operacionais.
- Terminais pareados consultam o cache em `/v1/operational-state/catalog`, `/floor`, `/tabs`, `/tabs/{id}`, `/kds` e acompanham rejeições em `/v1/operational-state/reconciliation`.
- A continuidade offline não confirma pagamento, documento fiscal ou impressão: essas ações continuam indisponíveis até a homologação dos respectivos provedores e equipamentos.

## Estado atual das integrações

PayGo e impressoras falham de forma segura com `503` enquanto credenciais e hardware não forem homologados. O adapter Focus NFC-e usa a API v2 oficial, Basic Auth com token por empresa, referência idempotente e consulta de reconciliação. A emissão também exige um ator ativo com papel de proprietário, gerente ou caixa no snapshot local vigente. Para homologar, configure `Hub__Focus__Enabled=true`, `Hub__Focus__Environment=homologation` e `Hub__Focus__Token` no cofre do serviço Windows. Produção exige trocar explicitamente o ambiente para `production`; o token nunca deve ser salvo no JSON ou nos logs.
