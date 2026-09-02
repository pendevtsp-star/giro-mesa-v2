# GiroMesa Edge Hub

Serviço local da unidade. Ele recebe os comandos operacionais, persiste-os antes de responder, sincroniza com a nuvem e contém as portas de integração com hardware.

## Segurança

- `/health` e `/v1/pair` são as únicas rotas públicas locais.
- O pareamento exige `Hub:EnrollmentCode` e devolve um token aleatório armazenado somente como hash.
- As demais rotas exigem `X-GiroMesa-Device-Token`.
- O banco local usa SQLCipher v4 e o processo falha de forma segura se `Hub:DatabaseKey` estiver ausente, tiver menos de 32 caracteres ou se o provedor de criptografia não estiver carregado.
- `Hub:CloudSyncKey` autentica o hub na nuvem e deve ser tratado como segredo. A API guarda apenas o hash SHA-256 da chave entregue uma única vez no cadastro do dispositivo.
- No fluxo normal, o gerente gera um código de 8 caracteres válido por 5 minutos. O instalador resgata o código uma única vez, gera a chave do banco local e protege ambas as credenciais com DPAPI no escopo da máquina. A pasta fica acessível somente para `SYSTEM` e administradores.
- `Hub__DatabaseKey` e `Hub__CloudSyncKey` permanecem disponíveis somente para desenvolvimento e recuperação controlada; nunca os grave no repositório ou em logs.

## Instalador Windows

O workflow `publish-edge-hub.yml` publica `GiroMesa-Conector-Setup.exe` somente em tags `edge-hub-v*`. A publicação falha se `EDGE_HUB_CODESIGN_PFX_BASE64` ou `EDGE_HUB_CODESIGN_PASSWORD` não estiverem configurados, e verifica com `SignTool` tanto o serviço incorporado quanto o instalador final. Configure `EDGE_HUB_WINDOWS_INSTALLER_URL` na API com a URL HTTPS do ativo publicado. O instalador pede apenas o código exibido no GiroMesa, registra `GiroMesaEdgeHub` com início automático e configura reinício após falhas.

Enquanto a assinatura pública não estiver disponível, o piloto controlado usa arquivo privado, SHA-256 obrigatório e allowlist de organizações. O procedimento fica em `docs/runbooks/edge-hub-pilot-installer.md`; ele não substitui a assinatura oficial nem autoriza distribuição ampla.

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
- A continuidade offline não confirma pagamento ou documento fiscal. A impressão térmica funciona localmente quando uma impressora ESC/POS de rede está configurada; sem equipamento, falha de forma segura e preserva o estado para nova tentativa.

## Impressão térmica ESC/POS

O Hub envia documentos estruturados por TCP, normalmente na porta `9100`. A configuração canônica é salva por unidade na API e entregue ao Edge por comandos duráveis e revisionados; `Hub:Printer` e `Hub:Printers[]` servem somente para o primeiro bootstrap de uma instalação ainda sem configuração persistida. Cada impressora recebe um ID estável e somente IP privado literal, além de porta, largura (`58` ou `80`), caracteres por linha, code table, corte, suporte gráfico e fallback. A estação de produção é a única fonte de verdade do destino e seleciona `kds_only`, `printer_only`, `both` ou `disabled`, impressora e quantidade de vias. Nomes são apenas exibição; o roteamento usa `stationId` e `printerId` imutáveis. A contingência só ocorre quando a conexão não chegou a ser aberta, evitando reimpressão incerta após envio parcial.

Dispositivos pareados consultam `GET /v1/printer-configurations`, `GET /v1/printers/diagnostics` e `GET /v1/print-jobs`; `POST /v1/printers/{id}/test` emite um teste físico. Esses endpoints locais exigem o token do dispositivo e não alteram configuração. `CodeTable=16` corresponde ao perfil Latin-1/Windows-1252 usado como padrão; ajuste conforme o manual do equipamento. `Cut=false` atende modelos sem guilhotina.

- Cada tentativa usa uma chave idempotente persistida no banco SQLCipher. Repetir a mesma tentativa nunca gera outra via; uma falha confirmada cria uma nova tentativa.
- Conteúdo e nomes passam por sanitização antes dos comandos ESC/POS, impedindo que texto operacional injete comandos na impressora.
- `accepted` significa que todos os bytes foram entregues ao socket da impressora. Falta de papel depois desse ponto depende do sensor/protocolo do modelo e deve ser homologada no equipamento real.
- Mantenha impressoras em VLAN operacional privada. O host vem apenas da configuração protegida do serviço; requisições não escolhem endereços arbitrários.

## Estado atual das integrações

PayGo falha de forma segura com `503` enquanto credenciais e hardware não forem homologados. A impressão ESC/POS TCP está implementada e permanece desabilitada até a configuração de um equipamento real. O adapter Focus NFC-e usa a API v2 oficial, Basic Auth com token por empresa, referência idempotente, consulta, cancelamento e inutilização reconciliáveis. Emissão exige proprietário, gerente ou caixa; consulta também aceita contador; cancelamento e inutilização exigem proprietário ou gerente no snapshot local vigente. Os resultados viram eventos `fiscal.*` duráveis sem token, XML ou resposta bruta do provedor. Para homologar, configure `Hub__Focus__Enabled=true`, `Hub__Focus__Environment=homologation` e `Hub__Focus__Token` no cofre do serviço Windows. Produção exige trocar explicitamente o ambiente para `production`; o token nunca deve ser salvo no JSON ou nos logs.

### Gate local da homologação fiscal

`GET /health/fiscal-homologation` faz somente um preflight local, sem chamar Focus NFe ou SEFAZ. Sem token ativo retorna `503` e `FOCUS_CREDENTIAL_MISSING`; com ambiente diferente de `homologation`, retorna `503` e `FOCUS_HOMOLOGATION_ENVIRONMENT_REQUIRED`. A resposta nunca contém token, certificado ou payload fiscal.

Use `curl.exe --fail-with-body "$EdgeHubUrl/health/fiscal-homologation"`. Um `200` confirma apenas ambiente e presença da credencial no processo Edge; `sefazVerified` permanece `false`. Autorização, rejeição, cancelamento, inutilização, XML/DANFE e certificado continuam exigindo credencial empresarial real e execução contra a Focus/SEFAZ em homologação.

O smoke seguro, sem segredos e sem rede externa, roda com `dotnet test apps/backends/edge-hub.tests/GiroMesa.EdgeHub.Tests.csproj --filter FullyQualifiedName~FiscalHomologationGateTests`.
