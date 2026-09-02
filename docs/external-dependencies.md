# Dependências externas e gates

O código deve falhar de forma segura quando estas dependências estiverem ausentes, sem substituir integrações reais por dados fictícios.

| Área | Necessário para homologação | Estado inicial |
|---|---|---|
| PayGo | contrato, adquirente, pinpad, credenciais e roteiro de homologação | adapter desabilitado |
| Focus NFe | `FOCUS_NFE_PRIMARY_TOKEN`, chave de cifra, CNPJ, IE/UF, regime, CSC, certificado A1, série e cadastro fiscal dos itens | onboarding multiempresa, tokens cifrados por unidade, emissão Edge, consulta, cancelamento, inutilização e reconciliação implementados; produção permanece desabilitada sem credenciais e homologação reais |
| Asaas | conta sandbox/produção, chave e segredo de webhook, callbacks públicos e roteiro de conciliação | checkout hospedado, webhook idempotente e reconciliação por outbox implementados; permanecem fail-closed sem credenciais e homologação real de cartão/Pix |
| Google | client ID, secret e callbacks locais/produção | OIDC Authorization Code + PKCE implementado; falta carregar as credenciais no ambiente V2 |
| AWS | conta, role OIDC, domínio, certificado e parâmetros de ambiente | Terraform sem apply |
| E-mail | chave Resend, remetente e domínio autenticado | adapter Resend implementado com outbox, retries, idempotência e dead-letter auditável; solicitações contábeis notificam somente a audiência validada no banco, sem conteúdo fiscal sensível na mensagem |
| WhatsApp | Evolution Go 0.7.2, licença ativa, aparelho pareado e consentimento | transporte, inbox realtime, atribuição/SLA, mídia, opt-out e automações/retry implementados e desabilitados por padrão; produção exige ativação da licença, QR com `LoggedIn=true` e jornada real de texto/mídia/recibo |
| Aviso KDS ao cliente | telefone válido, consentimento explícito, template e credenciais | aviso ao garçom é interno via realtime; cliente recebe template somente quando opt-in e o resultado é registrado como aceito pelo provedor, não como entregue |
| Web Push operacional | par VAPID, `WEB_PUSH_VAPID_SUBJECT`, HTTPS e homologação em Android/iOS instalados | assinatura cifrada por sessão e unidade, entrega de `pos.call.opened` pelo outbox, retry e remoção de endpoints 404/410 implementados; fica fail-closed sem VAPID |
| OpenAI | chave, política de dados e base de ajuda aprovada | busca determinística |
| Contabilidade e folha | fornecedores escolhidos, contratos de API e mapeamento contábil | API pública/webhooks disponíveis; nenhum fornecedor presumido |
| Piloto | empresa, rede, impressoras, produtos, mesas, equipe e dados fiscais | depende de tenant real configurado |
| SmartPOS | terminal de desenvolvimento, modelo/Android/firmware exatos, credenciais, contrato do SDK/deeplink, assinatura, loja, atestação disponível e roteiro do fornecedor | PWA, pareamento P-256, matriz/kill switch, tentativas, outbox, estorno, conciliação, observabilidade, UI e bridge fail-closed implementados; Rede/PayGo/Stone/Getnet/Cielo/PagBank permanecem desabilitados sem adaptador, terminal físico e homologação |
| Impressão e bump bar KDS | modelo de impressora, rede/VLAN, tabela de caracteres, largura da bobina e homologação do hardware | ESC/POS TCP, documentos 58/80 mm, corte, configuração cloud revisionada, fila idempotente, roteamento por ID de estação e ponte nativa implementados; `window.print()` permanece como contingência. USB/Bluetooth, leitura de sensores e confirmação física dependem do equipamento escolhido |
| Hub em produção | certificado Authenticode, URL HTTPS pública do instalador e homologação em um Windows real | código temporário de uso único, instalador com serviço automático, DPAPI, ACL, SQLCipher, replay e reconciliação implementados; publicação falha sem certificado e ainda exige tag assinada, URL configurada e teste físico |
| Geocodificação | provedor e chave para converter endereço em coordenadas | coordenadas informadas são validadas por ponto-no-polígono; conversão automática de endereço continua bloqueada |

Documentos jurídicos e procedimentos LGPD são modelos técnicos e exigem revisão profissional antes da publicação comercial.

O par VAPID deve ser gerado uma vez com `pnpm --filter @giromesa/worker exec web-push generate-vapid-keys`, mantendo `WEB_PUSH_VAPID_PRIVATE_KEY` somente no cofre do ambiente. API e worker precisam receber o mesmo par e `OUTBOX_ENCRYPTION_KEY`; o frontend recebe apenas a chave pública pelo endpoint autenticado.

## Gate externo SmartPOS

`config/smartpos-release.json` é a declaração versionada do que pode ser publicado. Ela começa com todos os fornecedores bloqueados. `pnpm smartpos:release-check` impede configurar uma URL de loja para Rede, PayGo ou Stone enquanto o fornecedor não estiver `homologated` com terminal, aplicativo assinado e evidências imutáveis. O gate não valida a autenticidade de um documento externo e não substitui o aceite do fornecedor.

| Fornecedor | Dependência externa ainda necessária | Canal oficial de início |
|---|---|---|
| Rede / Itaú | cadastro da software house, materiais e credenciais aplicáveis, modelo/firmware piloto, assinatura/publicação na Laranjinha Store, roteiro físico e aceite | [Programa Conexão Itaú](https://www.itau.com.br/empresas/conexaoitau/parceiros) |
| PayGo | abertura do atendimento de integração, licenciamento/credenciais, confirmação da matriz terminal/adquirente e envio do roteiro/evidências | [Portal de desenvolvimento PayGo](https://paygodev.readme.io/) |
| Stone | credenciais/canal comercial, modelo e firmware aceitos, deeplink testado no terminal, publicação e aceite | [SDK Android Stone](https://sdkandroid.stone.com.br/reference/explicacao-deeplink) |
| Getnet, Cielo e PagBank | projeto específico conforme as restrições do fornecedor, credenciais, dispositivo, assinatura/publicação e homologação | obter durante o onboarding oficial; nenhum link de aplicativo está configurado |

Links de marketing, deeplinks genéricos e URLs inferidas não são URLs de instalação. `NEXT_PUBLIC_REDE_STORE_URL`, `NEXT_PUBLIC_PAYGO_STORE_URL` e `NEXT_PUBLIC_STONE_STORE_URL` ficam vazias até o fornecedor fornecer e aprovar o endereço específico do aplicativo GiroMesa.

## Fronteira dos terminais KDS

O perfil persistente do terminal web (`installationId`, modo e praça) pertence à API cloud e usa o namespace `kds/terminals`. Ele não é um `deviceEnrollment`: o enrollment identifica e autoriza o Edge Hub para sincronização, enquanto o perfil web configura uma instalação do navegador. O Edge deve anunciar `terminalProfileRead=false` e `terminalProfileManage=false`; não deve copiar perfis web para a tabela local de dispositivos pareados.

Capacidade e recomendação são leituras calculadas no snapshot. Elas podem orientar a equipe, mas não representam limitação automática de pedidos: `automaticThrottling=false` até existir uma integração transacional homologada que realmente aplique o bloqueio.

A prioridade do pedido permanece cloud-only porque a autorização do papel KDS depende do perfil web em modo passe. A disponibilidade simples (`available` e `reason`) pode ser projetada no Edge; limite diário e reativação programada ficam cloud-only enquanto o replay cloud não aceitar `dailyStock` e `resetAt`.
