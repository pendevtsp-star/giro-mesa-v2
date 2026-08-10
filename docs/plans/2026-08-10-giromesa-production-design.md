# GiroMesa Production Platform Design

**Status:** aprovado em 2026-08-10 apos revisao Skeptic, Constraint Guardian, User Advocate e Integrator/Arbiter.

## Objetivo

Evoluir o GiroMesa V2 para uma plataforma cloud-first de operacao de food service, utilizavel em restaurante real, com PWA, mapa operacional, KDS, impressao, estoque e vasilhames, financeiro, SmartPOS, fiscal, integracao DoseClub, onboarding, backoffice, observabilidade e uma experiencia comercial premium.

O produto deve suportar regras especificas por estabelecimento sem transformar o core em um conjunto de excecoes por cliente. A extensibilidade sera entregue por configuracao versionada, capability flags e adapters com contratos estaveis.

## Entendimento aprovado

- O mapa operacional do salao esta no escopo. Ele e estruturado, versionado e orientado a operacao; nao e um editor artistico irrestrito.
- A sincronizacao GiroMesa/DoseClub esta no escopo, preservando repositorios e dominios independentes.
- SmartPOS, PayGo, fiscal, KDS e impressao estao no escopo por contratos, simuladores e adapters. Cada combinacao fisica so recebe status homologado depois do SDK, equipamento e provedor reais.
- Incidentes e perdas geram informacao gerencial. Nao existe desconto salarial automatico.
- KDS, impressao ou ambos podem ser configurados por estacao.
- O GiroMesa e cloud-first. O Edge Hub e opcional e necessario para continuidade multi-terminal offline, impressao automatica e integracoes locais.
- O WhatsApp nao oficial e experimental, opt-in, desligado por padrao, isolado por adapter e nunca sustenta um fluxo critico.
- A regra "sem emojis" vale para a interface e os dados demonstrativos mantidos pelo produto. Conteudo digitado pelo cliente nao sera alterado ou censurado.

## Niveis de prontidao

1. `software-ready`: implementacao, contratos, migracoes, seguranca e suites automatizadas concluidas.
2. `integration-ready`: integracao externa validada em sandbox ou simulador contratual.
3. `pilot-approved`: ambiente piloto, hardware escolhido, rede degradada, restore e jornadas reais validados.
4. `production-approved`: fornecedores homologados, alta disponibilidade e DR comprovados, 14 turnos sem Sev1 e reconciliacao completa.

Nenhum nivel superior pode ser inferido a partir de build verde ou resposta HTTP 200.

## Arquitetura

### Control plane cloud

- APIs NestJS stateless atras de proxy/load balancer.
- PostgreSQL como unica autoridade persistente final.
- Redis para cache com escopo de tenant, rate limiting, presenca efemera e coordenacao de workers; nunca como fonte financeira.
- Workers para outbox, e-mail, relatorios, imagens, webhooks, conciliacao e reconciliacao.
- Object storage/CDN para logos, capas, produtos, relatorios e comprovantes.
- OpenTelemetry para metricas, logs e traces com allowlist e redacao.

### PWA

- Ops, KDS e Customer recebem manifest, icones, service worker e estrategia de atualizacao controlada.
- IndexedDB guarda apenas dados minimos e provisiorios permitidos para o papel, com TTL, limpeza no logout/revogacao e versionamento de schema.
- Compatibilidade N/N-1 entre PWA, API, Edge, banco e DoseClub.
- Operacoes inseguras nao sao aceitas diretamente em modo offline sem Edge.

### Edge Hub opcional

- Journal transacional criptografado e idempotente.
- Identidade exclusiva por instalacao, mTLS, chave protegida e revogavel, deteccao de clone/rollback.
- Monitores de disco, relogio, chave, backlog e conectividade.
- Reconciliacao deterministica com a nuvem e recovery testado.
- Hospeda adapters locais de impressora, PayGo/TEF, pinpad e contingencia fiscal quando necessario.

### Adapters

Os dominios dependem de portas, nao de SDKs concretos:

- `PaymentProviderAdapter`
- `SmartPosAdapter`
- `PayGoAdapter`
- `FiscalAdapter`
- `PrintAdapter`
- `KitchenDispatchAdapter`
- `DoseClubAdapter`
- `NotificationAdapter`
- `ObjectStorageAdapter`

Cada adapter declara capabilities, versao de contrato, health, timeout, politica de retry e estado de homologacao.

## Invariantes distribuidos

- Cada comando possui `commandId`, `idempotencyKey`, `organizationId`, `unitId`, `actorId`, `deviceId`, `aggregateId`, `occupancyEpoch`, `resourceVersion`, `aggregateSequence`, `occurredAt` e `receivedAt` quando aplicavel.
- Estados de comando: `local`, `sent`, `confirmed`, `rejected`, `uncertain`, `reconciled`.
- Entrega de transporte e ao-menos-uma-vez; efeitos de negocio sao efetivamente-uma-vez por constraints persistentes, inbox/outbox e ledgers de dispatch/ack.
- Lacunas de sequencia ou conflito incompativel vao para quarentena; nunca ocorre sobrescrita silenciosa.
- PostgreSQL decide o estado final. Edge e IndexedDB mostram claramente que o estado e provisiorio.
- Migracoes seguem `expand -> migrate -> contract`; mudancas destrutivas so depois da janela de compatibilidade.

## Multitenancy e seguranca

- Contexto de organizacao e unidade obrigatorio no limite da requisicao e do job.
- `FORCE RLS` onde aplicavel, papeis de banco separados e nenhuma execucao da aplicacao como owner/superuser.
- Contexto de sessao e limpo antes de devolver a conexao ao pool.
- Isolamento testado em HTTP, websocket, jobs, cache, relatorios, arquivos, exports e reprocessamentos.
- Backoffice inicia read-only e mantem ambiente, tenant e unidade visiveis.
- Step-up MFA, least privilege e dual-control para suspensao, impersonacao, entitlement, segredo e replay financeiro.
- Segredos ficam fora do codigo, imagem e logs; possuem versao, rotacao sem indisponibilidade, revogacao e runbook de incidente.
- QR publico usa token assinado por ocupacao, curto e revogavel, com capabilities, nonce/replay control, rate limit e rotacao.
- Supply chain exige lockfile, SCA, secret scan, SBOM, imagens non-root, provenance e assinatura de artefatos.

## Salao, pracas e ocupacao

### Modelo

- `DiningRoom`
- `ServiceArea`
- `DiningTable`
- `TableLayoutVersion`
- `ServiceShift`
- `AreaAssignment`
- `TableGroup`
- `TableOccupancy`
- `ServiceIncident`

`TableOccupancy` possui uma `occupancyEpoch` exclusiva. Reserva, abertura, agrupamento, transferencia, divisao, pagamento, fechamento e reabertura sao transicoes validadas e serializadas.

### Mapa operacional

- Modo edicao: posicao, tamanho, zona, numero, capacidade e agrupamento com optimistic locking.
- Versoes publicadas sao imutaveis. Uma nova versao nao reorganiza a operacao ja aberta.
- Modo operacao: mapa estavel, busca por mesa/comanda, filtros por praca/responsavel/estado e fila de excecoes.
- Garcom abre na sua praca; caixa e gerente veem o salao completo.
- Painel lateral concentra comanda, itens, transferencia/fusao, responsavel, chamados, pre-conta, pagamento, impressao e incidentes.
- Acoes destrutivas exibem mesa, valor, itens e consequencia. Acoes reversiveis oferecem desfazer.

### Chamados e presenca

- Responsavel primario por praca, apoio apos timeout e fallback para gerente/caixa.
- Presenca usa lease e acknowledgement, nao apenas websocket conectado.
- Handoff de turno lista chamados, comandas, pedidos, pagamentos incertos, incidentes e filas de impressao.

## QR e conta parcial

- O QR fisico identifica mesa e unidade; uma leitura cria sessao curta ligada a ocupacao atual.
- Capabilities por estabelecimento: cardapio, chamar garcom, pedir conta, ver parcial e pedido direto.
- Chamado mostra `recebido`, `encaminhado` e `atendido`; repeticao acidental e temporariamente bloqueada.
- O parcial mostra mesa, ocupacao, itens, servico, pagamentos e ultima atualizacao.
- Token vencido ou revogado orienta nova leitura. Funcao desligada nao aparece.

## KDS e impressao

- Um evento canonico de pedido alimenta consumidores independentes.
- Configuracao por estacao: `kds`, `print`, `both`, `kds_with_contingency_print`, `off`.
- Dispatch e acknowledgement independentes por destino, com reprint, cancelamento, atraso, DLQ e reconciliacao.
- KDS usa identificador unico, estacao, origem, horario e prioridade; atraso nao depende apenas de cor.
- Conclusao possui retorno imediato e janela curta de desfazer.
- Falha de KDS aciona contingencia configurada; falha de impressao mantem fila visivel e auditavel.

## Pagamentos, caixa e fiscal

### Modelo monetario

- `PaymentIntent`, `PaymentAttempt`, `PaymentTerminal`, `ProviderTransaction`, `Receipt`, `ExpectedFee`, `Settlement`, `Reconciliation`, `Refund`.
- Ledger imutavel e balanceado para venda, pagamento, servico, gorjeta, taxa, estorno, chargeback, ajuste e diferenca.
- Valores em centavos ou Decimal com moeda e regra de arredondamento explicitas.
- Fechamento e serializavel, idempotente, versionado e congelado; alteracoes posteriores sao novos ajustes.
- PAN e CVV nunca sao armazenados.

### Resultado incerto

- `UNCERTAIN` nunca vira sucesso visual.
- O sistema tenta consulta segura ao provedor, aguarda callback e reconcilia.
- Retry incompativel e bloqueado; revisao manual mostra terminal, horario, valor, provedor e proximas acoes.

### Modos de pagamento

- SDK SmartPOS por adapter.
- PayGo/TEF e pinpad via Edge Hub.
- POS independente com autorizacao manual e posterior conciliacao.
- Link/QR/hosted payment por provider.
- Terminais sao pareados, revogaveis e escopados por unidade.

### Fiscal

- Maquina de estados separada da venda.
- Falha fiscal deixa documento pendente; nunca apaga a venda.
- Focus permanece desabilitado sem cadastro fiscal, token, certificado e homologacao por UF/empresa.

## Estoque, vasilhames e incidentes

- Consumiveis, produtos acabados e embalagens retornaveis possuem ledgers separados.
- Quantidade usa Decimal e unidade dimensional; conversoes e fichas tecnicas sao versionadas.
- Retornaveis possuem `trackingMode`: agregado por SKU/lote ou serializado por unidade.
- Estados: cheio, circulando, vazio devolvido, enviado/recebido do fornecedor, quebrado, perdido e ajustado.
- Movimento registra mesa, comanda, produto, garcom, turno, motivo, aprovador, deposito, fornecedor e lote quando aplicavel.
- Incidentes: quebra, perda, nao consumido, saida sem pagar, cortesia, cancelamento, diferenca de caixa e vasilhame ausente.
- A linguagem e neutra; incidente nao representa divida nem alimenta desconto automatico.

## Servico, comissao e participacao

Tres motores independentes:

1. distribuicao de taxa de servico;
2. comissao;
3. participacao de resultados.

Regras sao tipadas, versionadas, `effective-dated` e executadas por builder seguro, sem `eval`. O usuario pode simular antes de publicar. Cada calculo preserva regra, periodo, dados de origem, memoria, aprovacao e ajustes. Estados: `estimated`, `approved`, `closed`. Participacao so fecha depois do periodo financeiro.

## Integracao DoseClub

- DoseClub continua produto vendavel isoladamente.
- No modo integrado, GiroMesa e autoridade do estoque fisico; DoseClub e autoridade de clubes, direitos e doses do cliente.
- `Integration Contract v2` e versionado e compativel com o contrato atual.
- Fluxos de venda, consumo, reversao e reconciliacao usam sagas compensaveis, idempotencia, webhook assinado, inbox/outbox, retry, DLQ e requeue administrativo.
- Nenhum agregado possui dois writers concorrentes.
- Estados de volume no GiroMesa: disponivel, reservado, em consumo, consumido, perdido e revertido.
- Divergencias ficam visiveis e bloqueiam fechamento incompativel ate reconciliacao.

## Landing, menu e identidade

### Landing

- Remover os eyebrows "Gestao operacional para food service" e "Uma so verdade operacional".
- Hero com carrossel de capturas reais e nitidas, controles manuais, pausa, teclado, `prefers-reduced-motion` e autoplay lento.
- Imagens responsivas, preloads seletivos e performance budget de LCP.
- WhatsApp e e-mail coexistem.
- Favicon, PWA icons e metadata coerentes em Site, Ops e Customer.

### Menu publico

- Logo, capa, nome, descricao e cores dentro de limites acessiveis.
- Foto real por produto, crop, ordem, fallback por icone da familia oficial e sem emoji do produto.
- Ciclo `draft -> preview -> version -> publish` atomico.
- Upload valida tipo, tamanho, dimensao e pixels; recodifica, remove metadados e publica assets imutaveis em CDN sem execucao ativa.

### Principios de UI

- Uma familia de icones, com rotulos ou nomes acessiveis; nenhuma acao essencial depende de hover, gesto oculto ou somente cor.
- Alvos de toque de 48x48 px na operacao.
- Fluxos: reconhecer chamado e abrir mesa em ate 2 toques; repetir item em ate 3.
- Rascunhos sobrevivem a navegacao, reautenticacao e reconexao.
- Operacao prioriza estabilidade e velocidade; movimento premium fica no contexto comercial.
- WCAG 2.2 AA, teclado, leitor de tela, movimento reduzido, modo paisagem, brilho forte e uso com uma mao entram no QA.

## Onboarding, backoffice e ciclo comercial

### Onboarding

- Verificacao de e-mail ou identidade Google.
- Organizacao, unidade, plano, fiscal, catalogo, mesas, equipe, QR, KDS, impressao e checklist operacional.
- Progresso recuperavel com dependencias e testes praticos.
- Provisionamento e uma saga idempotente com estados, compensacao e cleanup.
- O trial de 14 dias inicia apenas apos o checklist minimo concluido.

### Backoffice

- Leads, tenants, planos, entitlements, usuarios, suspensao, onboarding, billing, suporte, integracoes, incidentes e auditoria.
- Ambiente, tenant e unidade sempre visiveis.
- Acoes transversais exigem justificativa, step-up MFA e, quando criticas, dual-control.
- Dados demonstrativos e credenciais piloto sao isolados, rotacionaveis e removiveis; nunca entram em producao por seed implicito.

## Confiabilidade, privacidade e operacao

- Meta de producao: SLO mensal 99,95%, RPO 5 minutos, RTO 30 minutos.
- Alvo por unidade: 500 mesas, 50 terminais e 2.000 sessoes QR simultaneas.
- Gate de carga: jornadas reais, multiplos tenants e 2x do alvo; p95 leitura <300 ms e escrita <500 ms no alvo, erro <0,1%, lag e saturacao dentro dos budgets.
- Quotas e backpressure por tenant evitam vizinho ruidoso.
- VPS unica e ambiente piloto; nao atende `production-approved`.
- Backup inclui banco, objetos, configuracoes e versoes; restore drills comprovam RPO/RTO.
- Inventario LGPD cobre finalidade, base legal, retencao, exportacao, correcao, anonimização/exclusao e propagacao a cache, fila, objetos e backup conforme politica.
- Observabilidade nao captura payloads sensiveis; alertas possuem owner, severidade e runbook.

## Testes e gates

- Unitarios para maquinas de estado, regras, arredondamento e conflitos.
- Integracao com PostgreSQL real e RLS forcado.
- Contratos OpenAPI e adapters.
- E2E por papel, tenant e unidade.
- PWA offline, update e compatibilidade N/N-1.
- Edge restart, replay, reorder, clone, disco cheio e relogio divergente.
- KDS, impressao, contingencia e cancelamento.
- SmartPOS/PayGo/Focus por simulador; depois dispositivo e sandbox reais.
- DoseClub venda, consumo, reversao, atraso, divergencia e reconciliacao.
- Playwright, Axe e QA visual nos breakpoints e condicoes aprovados.
- Carga, spike, soak, fila e vizinho ruidoso.
- Backup e restore integral.

`production-approved` exige zero efeito duplicado ou pedido perdido nos cenarios aprovados, zero vazamento entre tenants, restore comprovado, nenhum Sev1, 14 turnos piloto e reconciliacao integral.

## Decision Log

| ID | Decisao | Motivo | Consequencia |
|---|---|---|---|
| D-01 | Modular core cloud-first com Edge opcional | Escala sem obrigar instalacao local | Offline multi-terminal completo requer Edge |
| D-02 | PostgreSQL e autoridade final | Elimina dual-master operacional | Estados locais sao provisiorios e reconciliados |
| D-03 | Efeitos efetivamente-uma-vez | Transporte exatamente-uma-vez nao e realista | Constraints e ledgers sao obrigatorios |
| D-04 | `FORCE RLS` e contexto por tenant | Reduz risco sistemico de vazamento | Jobs, cache e websockets tambem precisam de contexto |
| D-05 | Ledger monetario imutavel | Suporta parcial, estorno, taxa e reconciliacao | Correcao posterior e novo ajuste, nao edicao |
| D-06 | QR ligado a ocupacao | QR fisico pode ser copiado | Sessao curta e revogacao por epoch |
| D-07 | KDS e print como consumidores independentes | Coexistencia sem acoplamento | Ack e reconciliacao por destino |
| D-08 | DoseClub sem dual-master | Preserva autonomia dos produtos | Giro domina estoque; Dose domina direitos |
| D-09 | Regras financeiras versionadas e seguras | Permite especificidade sem codigo por cliente | Sem `eval`; calculos congelados |
| D-10 | Incidentes fora da folha | Evita automatismo trabalhista inadequado | Apenas apuracao gerencial auditada |
| D-11 | WhatsApp nao oficial experimental | Risco contratual e operacional | Off por padrao, kill switch e sem fluxo critico |
| D-12 | Quatro niveis de prontidao | Dependencias externas nao podem ser mascaradas | Hardware bloqueia o nivel, nao o desenvolvimento |
| D-13 | VPS atual apenas para piloto | Ponto unico de falha | Producao exige HA e DR comprovados |
| D-14 | Mapa estruturado, nao Canva livre | Operacao exige previsibilidade | Versoes publicadas e layout estavel |
| D-15 | Sem emojis na UI propria, nao no conteudo do cliente | Consistencia visual sem censura | Dados do usuario sao preservados |

## Dependencias externas bloqueadoras

- SDK/modelo/adquirente de SmartPOS.
- Contrato PayGo, pinpad e roteiro de homologacao.
- Cadastro fiscal Focus por empresa e UF.
- Impressoras e rede reais do piloto.
- Ambiente DoseClub conjunto com chaves e mapeamentos reais.
- Infraestrutura de alta disponibilidade para `production-approved`.
- Revisao juridica dos documentos e politicas LGPD.

Esses itens nao bloqueiam contratos, simuladores, testes e implementacao interna, mas bloqueiam o nivel de prontidao correspondente.
