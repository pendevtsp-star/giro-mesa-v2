# Dependências externas e gates

O código deve falhar de forma segura quando estas dependências estiverem ausentes, sem substituir integrações reais por dados fictícios.

| Área | Necessário para homologação | Estado inicial |
|---|---|---|
| PayGo | contrato, adquirente, pinpad, credenciais e roteiro de homologação | adapter desabilitado |
| Focus NFe | `FOCUS_NFE_PRIMARY_TOKEN`, chave de cifra, CNPJ, IE/UF, regime, CSC, certificado A1, série e cadastro fiscal dos itens | onboarding multiempresa, tokens cifrados por unidade, emissão Edge, consulta, cancelamento, inutilização e reconciliação implementados; produção permanece desabilitada sem credenciais e homologação reais |
| Asaas | conta sandbox/produção, chave e segredo de webhook | porta backend desabilitada |
| Google | client ID, secret e callbacks locais/produção | OIDC Authorization Code + PKCE implementado; falta carregar as credenciais no ambiente V2 |
| AWS | conta, role OIDC, domínio, certificado e parâmetros de ambiente | Terraform sem apply |
| E-mail | chave Resend, remetente e domínio autenticado | adapter Resend implementado com outbox, retries, idempotência e dead-letter auditável |
| WhatsApp | Meta Cloud API, template aprovado e consentimento | adapter transacional implementado e desabilitado por padrão; produção exige credenciais e homologação reais |
| Aviso KDS ao cliente | telefone válido, consentimento explícito, template e credenciais | aviso ao garçom é interno via realtime; cliente recebe template somente quando opt-in e o resultado é registrado como aceito pelo provedor, não como entregue |
| OpenAI | chave, política de dados e base de ajuda aprovada | busca determinística |
| Contabilidade e folha | fornecedores escolhidos, contratos de API e mapeamento contábil | API pública/webhooks disponíveis; nenhum fornecedor presumido |
| Piloto | empresa, rede, impressoras, produtos, mesas, equipe e dados fiscais | depende de tenant real configurado |
| Impressão e bump bar KDS | modelo de impressora, rede/VLAN, tabela de caracteres, largura da bobina e homologação do hardware | ESC/POS TCP, recibo 58/80 mm, corte, fila idempotente e ponte nativa implementados; `window.print()` permanece como contingência. USB/Bluetooth, leitura de sensores e roteamento KDS por praça dependem do equipamento escolhido |
| Hub em produção | certificado TLS local, instalador, provisionamento e cofre de segredos | SQLCipher, replay e reconciliação validados localmente |
| Geocodificação | provedor e chave para converter endereço em coordenadas | coordenadas informadas são validadas por ponto-no-polígono; conversão automática de endereço continua bloqueada |

Documentos jurídicos e procedimentos LGPD são modelos técnicos e exigem revisão profissional antes da publicação comercial.

## Fronteira dos terminais KDS

O perfil persistente do terminal web (`installationId`, modo e praça) pertence à API cloud e usa o namespace `kds/terminals`. Ele não é um `deviceEnrollment`: o enrollment identifica e autoriza o Edge Hub para sincronização, enquanto o perfil web configura uma instalação do navegador. O Edge deve anunciar `terminalProfileRead=false` e `terminalProfileManage=false`; não deve copiar perfis web para a tabela local de dispositivos pareados.

Capacidade e recomendação são leituras calculadas no snapshot. Elas podem orientar a equipe, mas não representam limitação automática de pedidos: `automaticThrottling=false` até existir uma integração transacional homologada que realmente aplique o bloqueio.

A prioridade do pedido permanece cloud-only porque a autorização do papel KDS depende do perfil web em modo passe. A disponibilidade simples (`available` e `reason`) pode ser projetada no Edge; limite diário e reativação programada ficam cloud-only enquanto o replay cloud não aceitar `dailyStock` e `resetAt`.
