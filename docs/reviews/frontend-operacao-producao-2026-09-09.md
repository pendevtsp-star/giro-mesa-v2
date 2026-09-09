# Revisão do frontend para operação de restaurante e bar

Data: 09/09/2026. Objetivo: escolher melhorias de UI/UX e de fluxo antes da entrada em operação comercial.

## Parecer

A prioridade é encurtar atendimento, conferência e recuperação de falhas. O produto já tem recursos importantes: favoritos, repetição de pedido, divisão de pagamento, transferência de itens/mesas, recepção integrada, produção por estação e passe, alergias, espera/liberação por etapa, contingência e aprovações. Não recomendo uma reformulação visual completa nem uma nova coleção de módulos antes do piloto.

Preservar a linguagem do Cardápio e os componentes de `@giromesa/ui`, mas reduzir controles administrativos nas telas usadas durante o serviço. Uma tela compacta deve mostrar mais trabalho útil, sem comprimir valores, alvos de toque ou mensagens essenciais.

## Cobertura e limites

- Mapeadas as 23 rotas do Ops em `src/router.ts`, seu despacho em `src/app/PageContent.tsx` e a navegação por permissões. Incluídos shell, acesso, equipamentos e a experiência pública de pedido por QR.
- Navegador: Salão, comanda/Pedido/Conta, Balcão, KDS, Caixa, Delivery, Recepção e Cardápio. Inspeção visual por imagem do Salão/comanda e leitura da árvore de acessibilidade nas demais telas. Conta também inspecionada em viewport de 375 × 812 px.
- Sessão do navegador: perfil de proprietária em unidade identificada como demonstração/homologação. Há registros identificados como testes; tempos e totais dessa sessão não representam desempenho de um restaurante real.
- Código local: HEAD `d879ff5315c18f63d5de26ad291581129d9ee605`; grafo local atualizado antes da revisão. Não foi comparado o SHA do navegador com o checkout.
- Não foram realizados lançamentos, cobranças, alterações de pedidos, configuração, publicação ou deploy. Nenhuma integração externa ou equipamento físico foi homologado nesta revisão. Não houve execução de suites de testes nem certificação de acessibilidade completa; dark mode e outros perfis ainda precisam de inspeção funcional.
- P0: corrigir ou esclarecer antes do piloto do canal afetado. P1: melhoria de uso diário a priorizar. P2: evolução após observar a operação real. Essas prioridades são julgamento de produto, não um resultado automático de testes.

## Achados prioritários

### 1. O valor de confirmação é cortado no celular — P0

**Observado no navegador.** Na Conta da comanda, em 375 px, o botão `Confirmar R$ 29,59` corta parte do texto. A medição DOM mostrou largura de 96 px, área interna de 94 px e conteúdo de 100 px. A altura era 44 px: o problema observado é a largura e a distribuição das ações.

**Proposta:** dar a linha principal ao botão de confirmação, com forma de pagamento e valor integral legíveis. Ações auxiliares podem ocupar outra linha ou o menu já existente. Aplicar o ajuste ao componente compartilhado de Salão/Balcão.

**Aceite:** valores curtos e longos continuam legíveis em 375 px; teclado virtual não encobre o campo nem a confirmação; pagamento parcial mantém saldo e valor recebido inequívocos. Evidência de código: `apps/frontends/ops/src/features/counter/CounterWorkspace.tsx:4919` e `counter.css`.

### 2. Salão e comanda gastam espaço antes da tarefa principal — P1

**Observado visualmente.** Na captura desktop do Salão, a primeira linha de mesas começa aproximadamente em y=533. Antes dela aparecem título, contexto do operador, prontidão, turno, busca, filtros, carga e modos de organização. Dentro da comanda, o primeiro produto também aparece abaixo de vários blocos de contexto e atalhos.

**Proposta:** uma faixa compacta com unidade/turno/conexão, busca e filtros essenciais; configuração de espaço, distribuição de equipe e indicadores em painéis sob demanda. Na comanda, encurtar o cabeçalho e a área de favoritos; manter busca, produtos e resumo do pedido próximos. Usar o modo Lista já existente como opção de alto giro, com ordenação explícita e estável.

**Aceite:** abrir uma mesa e localizar/adicionar um produto exige menos rolagem; total, destino de produção e pedido em edição permanecem claros; manter o contexto da mesa ao fechar o painel. Não medir sucesso só pelo número de elementos removidos.

### 3. Delivery apresenta uma divergência entre telas — P0 para investigar

**Observado na mesma sessão, sem criação de pedidos.** O Balcão mostrava duas comandas identificadas como Delivery; o KDS tinha um ticket Delivery pronto; a página Delivery, em Todos e sem busca preenchida, exibia zero pedidos em operação.

Isso não prova perda de pedido. Pode envolver origem, vínculo de expedição, registros antigos de homologação ou regra da projeção. O checkout e a versão servida também não tiveram seus SHAs comparados.

O código ajuda a delimitar a investigação: `DeliveryPage.tsx:255` lê a fila Growth; `pilot-pos.service.ts:10183` e `:10233` tratam seu vínculo/projeção com o POS. Comparar também `tabId/orderRef` e elegibilidade, não apenas o texto do canal.

**Proposta:** reproduzir com um novo pedido controlado e rastrear o mesmo identificador entre Balcão → KDS → Delivery. A interface deve distinguir claramente comanda de canal delivery, pedido aguardando endereço/liberação e entrega elegível para despacho. Se faltar uma etapa, oferecer a ação que a conclui. Evitar um estado vazio que pareça significar inexistência de trabalho.

**Aceite:** o operador consegue explicar onde cada pedido está e o que falta para despachá-lo; cancelamento, entrega e filtros não escondem divergências de vínculo.

### 4. O acompanhamento do QR para após a confirmação — P0 se o canal prometer acompanhamento

**Confirmado por inspeção de código; não reproduzido com pedido público nesta sessão.** `menu-experience.tsx:442` só inicia consulta periódica enquanto o pedido está em `draft`; quando chega a `sent`, a consulta para. `TableOrderFlow.tsx` já possui apresentações para preparo, pronto e servido. A API pública consulta o estado persistido do pedido, e o POS atualiza esse estado a partir dos itens.

**Proposta:** continuar acompanhando os estados não terminais pela API existente, respeitando aba oculta, sessão expirada, falha de rede e encerramento. Mostrar última atualização e recuperação quando a consulta falhar. Corrigir também `Total confirmado`, exibido atualmente na apresentação de tracking inclusive para `draft`, para um rótulo condizente com a etapa.

**Aceite:** confirmação → preparo → pronto → servido aparece sem recarregar; uma falha não vira sucesso nem autoriza duplicar pedido. Fontes: `apps/frontends/customer/components/menu-experience.tsx:442`, `components/menu/TableOrderFlow.tsx:11`, `apps/backends/api/src/public-menu/public-table.service.ts:293` e `apps/backends/api/src/pilot-operations/pilot-pos.service.ts:14822`.

### 5. Alertas precisam ter a mesma linguagem e destino acionável — P1

O sino já abre mesa/comanda específica por `operationalAttentionHref`; não é uma funcionalidade a recriar. Porém o painel Faça agora ainda usa `routeHref(item.route)`, que leva à raiz do módulo. No navegador, o Salão mostrava zero prioridades enquanto o sino mostrava duas atenções: os conceitos podem ser diferentes, mas o operador precisa entender a diferença.

**Proposta:** dar nome e escopo explícitos aos contadores, compartilhar critérios onde representam a mesma pendência e preservar identificadores nos atalhos do dashboard. Uma pendência de pedido deve abrir o pedido, não obrigar outra busca.

**Ponto adicional de código, P0 no perfil Delivery:** esse perfil possui `counter.operate` sem `salon.operate` (`profiles.ts`). Em `OperationalAttentionInbox.tsx:317`, o fallback sem Salão não contém `openTabs`, mas a linha seguinte chama `floor.openTabs.map`. Isso cai no tratamento de erro em vez de produzir a fila. A correção deve preservar a restrição de acesso, não conceder Salão para contornar o problema. Falta reproduzir no navegador com esse perfil.

Fontes: `apps/frontends/ops/src/features/shell/OperationalAttentionInbox.tsx:34`, `:317`, `:655`; `features/dashboard/DashboardPage.tsx:390`; `src/profiles.ts`.

### 6. KDS precisa falar a linguagem da equipe — P1

**Observado no navegador.** Aparecem `RUSH`, `Bump`, `All-day`, `dine_in`, `pickup`, `Fogo e espera por curso` e uma faixa de ETA em decimal com poucas amostras. O sistema já tem estações, passe, preparo por item, ciência de observações e espera/liberação; o ganho imediato é apresentação.

**Proposta:** usar Urgente, Avançar, Total a produzir, Salão, Retirada e Liberar etapa/Manter em espera. Priorizar pedido, mesa, itens, restrições, tempo e próxima ação. Estatísticas e estimativas detalhadas ficam sob demanda. Para ETA, deixar explícito se há base suficiente; não transformar amostra de homologação em promessa ao cliente.

**Aceite:** cozinheiro e pessoa do passe conseguem operar sem conhecer termos de software; estimativa, prazo prometido, tempo decorrido e atraso são distinguíveis. Validar em tela instalada à distância real de leitura.

### 7. Prontidão de cadastro deve permanecer diferente de homologação — P1

`SetupChecklist.tsx` já confere dados do servidor e avisa que cadastro não é homologação. Reutilizar isso. Há um turno chamado Homologação completa na sessão observada; nome de turno e badge de prontidão não constituem evidência de certificação.

**Proposta:** transformar a preparação existente em um resumo por canal usado pela casa, com configuração, teste realizado, evidência e próximo passo. Impressora configurada, comando enviado, papel impresso e pagamento conciliado precisam continuar distintos. Conectar esse resumo ao diagnóstico já existente, evitando outro painel administrativo.

**Aceite:** gerente identifica exatamente quais meios pode usar no primeiro turno e quais exigem conferência manual. Fontes: `apps/frontends/ops/src/features/settings/SetupChecklist.tsx:15`, `docs/external-dependencies.md`.

### 8. Cardápio pode priorizar disponibilidade durante o serviço — P1

Pausar, Esgotar hoje, categorias, preços por canal, adicionais, histórico, CSV, promoções e prévia já existem. No cabeçalho, Matriz BCG, etiquetas, CSV, modificadores e promoções disputam atenção com a manutenção diária.

**Proposta:** manter produto/preço/disponibilidade/destino de produção como caminho curto; ferramentas de análise, impressão, importação e configuração no menu existente. Dar clareza à diferença entre pausar temporariamente, esgotar hoje e inativar cadastro. Consolidar os caminhos de QR e importação sem retirar capacidades.

**Aceite:** durante o pico, a equipe consegue localizar e suspender o item correto, com efeito por canal explícito; alterações de preço/publicação não parecem já publicadas quando ainda são rascunho. Fontes: `features/catalog/components/CatalogManagementHeader.tsx:91`, `CatalogProductsPanel.tsx`, `features/settings/SettingsPage.tsx:742`.

### 9. Comprovante de fechamento depende de um turno que já deixou de estar aberto — P0

**Confirmado por inspeção de código; não foi fechado caixa nesta revisão.** Depois da confirmação, `CashPage.tsx:355` atualiza a consulta. O comprovante em `:1560` continua usando a variável do turno aberto para operador, abertura e fundo inicial. O documento também contém o título fixo `GiroMesa Bistrô` e usa o horário atual de renderização como encerramento.

**Proposta:** montar o comprovante exclusivamente com dados do turno fechado e identidade real da unidade, reaproveitando o histórico; enriquecer o resultado da API somente onde faltar campo. Reimprimir deve preservar abertura, encerramento, gaveta, responsável e valores originais.

**Aceite:** fechar, atualizar a página, selecionar outra gaveta e reimprimir não altera a identidade nem os dados históricos do comprovante.

**Ajuste de linguagem relacionado:** `Conferência cega` é correto para o perfil caixa quando o servidor oculta o esperado; owner/manager/finance já podem ver os valores antes de contar. Nesses casos, usar `Conferência assistida`. A observação no perfil proprietária não demonstra quebra da política aplicada ao caixa (`CashPage.tsx:789`, `:876`; `management.service.ts:17048`).

### 10. Recepção precisa prevenir erros e recuperar conflitos — P0/P1

O fluxo Sentar já abre comanda e atualiza a recepção atomicamente; não propor outra integração de reserva com mesa. Os ajustes estão nas bordas do fluxo existente.

- A reserva interna verifica data parseável, enquanto o contrato público já impede data passada. Reusar a validação adequada para reserva futura; se registro retroativo for necessário, torná-lo administrativo e explícito (`ReservationsPage.tsx:351`; `growth.schemas.ts:249`, `:287`).
- Telefone é validado essencialmente por comprimento. Reusar normalização e validação já utilizadas no produto; oito letras não devem gerar um contato aparentemente válido (`ReservationsPage.tsx:557`; `growth.schemas.ts:253`).
- Se outra pessoa ocupar a mesa, o backend rejeita; atualizar as opções e preservar os dados do cliente, devolvendo foco à seleção (`ReservationsPage.tsx:447`).
- Considerar a capacidade dos grupos de mesas já montados, com atalho para a organização existente do Salão, antes de concluir que não há mesa compatível (`ReservationsPage.tsx:165`, `:1125`). Validar o contrato da mesa âncora antes de oferecer a ação.

## Recomendações por módulo

Cada linha distingue o recurso existente da melhoria proposta. A presença de API foi verificada no código; persistência real, autorização de todos os perfis e homologação não foram testadas universalmente nesta revisão.

| Módulo | Base existente | Melhoria recomendada | Prioridade / alcance |
|---|---|---|---|
| Visão geral | Faça agora, assumir/adiar/tratar, fontes parciais e preferências | Abrir a entidade exata da pendência; oferecer pré-fechamento do turno sobre os dados existentes | P1; UI e contrato quando faltar identificador |
| Mesas e comandas | Painel/lista, ambientes, praças, grupos, transferência e limpeza | Mesas acima dos controles administrativos; ordem numérica estável por padrão e opção explícita por urgência; contexto compacto | P1; UI |
| Balcão e retirada | Fila autoritativa, filtros por canal/etapa, promessa e cliente | Equilibrar criação rápida com fila ativa; reduzir seleção duplicada de canal; resumo compacto e ação contextual por pedido | P1; UI |
| Conta/pagamento da comanda | Recebimento parcial, divisão de valor, separação de item, SmartPOS e impressão | Valor integral no botão; forma e saldo sempre claros; chamar Por pessoa de Dividir valor igualmente se não há alocação individual | P0 no corte; P1 clareza; UI |
| Produção KDS e passe | Estações, preparo por item, alertas, liberação por etapa e expedição | Linguagem operacional, tela legível à distância, ETA condizente com a amostra e destaque à entrega parcial | P1; UI e regra da estimativa |
| Contas e caixa | Gavetas, sangria, suprimento, contagem, divergências e histórico | Corrigir comprovante; linguagem de conferência por perfil; um único aviso acionável por problema | P0 comprovante; P1 restante |
| Delivery | Filas/zonas, entregadores, despacho, pagamentos e notificações | Resolver divergência entre filas; destacar método e valor a cobrar na entrega; tratar tentativa frustrada/devolução | P0 divergência; P1 ou requisito do piloto para falhas de entrega; UI + domínio |
| Recepção e espera | Agenda, walk-in, espera, sugestão de mesa e acomodação real | Data/telefone válidos, recuperação de conflito, capacidade de mesas agrupadas; definir conclusão da visita | P0/P1; UI + validação/domínio |
| Cardápio | Adicionais, preços por canal, disponibilidade, promoções, histórico e publicação | Dar prioridade à disponibilidade e edição diária; análise/importação/QR sob demanda; nomes claros para pausa, esgotamento e inativação | P1; UI |
| QR das mesas | Lotes, prévia, testes, versões, rotação e histórico | Conduzir selecionar → conferir → imprimir; explicar Rotacionar como substituir código e invalidar placas antigas; consolidar caminhos vindos do Cardápio | P1; UI, reusar lifecycle |
| Cardápio do cliente | Carrinho, revisão da equipe, consulta de consumo e estados do pedido | Acompanhar após confirmação; evidenciar mesa/canal; apresentar alergia separada como extensão do fluxo | P0 se acompanhamento for parte do canal; P1 alergia com contrato |
| Estoque | Saldos, perdas, contagem, reposição, movimentações e fila offline | Visão Turno com rupturas, reposição e contagem crítica; reduzir as 13 seções concorrentes; substituir prompts por modais existentes | P1; UI |
| Compras | Sugestão de reposição preenchida, aprovação, recebimento parcial, fatura e XML | Recebimento móvel focado em quantidade, lote/validade e divergência; fila Chega hoje/Atrasado | P1 recebimento; P2 agenda; UI + dados já disponíveis |
| Financeiro | Contas, vencimentos, aprovação, pagamento e conciliação | Anexar comprovante por upload privado em vez de exigir URL; filtro por turno e divergências | P1; UI + armazenamento autorizado |
| Relatórios | Exportações, drill-down, cobertura, metas, alertas, agendamentos e visões salvas | Entrada por Hoje/Turno para gerente; distinguir favorito deste navegador de visão salva na conta; manter mês para o perfil financeiro | P1; UI |
| Fiscal | Emissão, rejeições, cancelamento, reconciliação e competência | Fila de rejeições com causa/próxima ação; motivo e impacto em modal; saúde real do provedor antes da ativação | P0 homologação; P1 UI |
| Contador | Pacotes, competências, solicitações e anexos | Pendências por competência com responsável e próximo passo; manter download condicionado ao fechamento confirmado | P1; UI |
| Pessoas | Acesso, convites, PIN/terminais, escalas, ponto, correções e comissões | Hoje no fuso da unidade, não no dispositivo; visão Equipe do turno e correções pendentes | P0 correção de data quando aplicável; P1 UI |
| Fechamento da equipe | Prévia explicitamente local, apuração, aprovação e registro de pagamento | Trocar Marcar pago por Registrar pagamento com referência/meio/comprovante e vínculo financeiro; exibir bloqueadores antes de apurar | P1, antes de usar como controle financeiro exclusivo; UI + domínio |
| Clientes/CRM/WhatsApp | Cliente, consentimento, fidelidade, campanhas e inbox com responsável/SLA | Preset Precisa responder; cliente contextual no atendimento; campanhas fora do caminho do atendente | P1 UI; homologação antes de envio real |
| Multiunidade | Consolidado de delivery, reservas, espera e transferências | Comparar caixa, atrasos, ruptura e operação por unidade com navegação autorizada; reutilizar overview/relatórios | P2 se piloto de uma unidade; P1 se multiunidade |
| Assinatura e cobrança | Plano, onboarding, regularização, checkout e histórico | Clarificar recibo, próximo vencimento e efeito de mudança de plano; edição do meio de pagamento quando suportada | P1 antes da venda paga; não bloqueia ajuste do Salão |
| Configurações | Unidade, marca, horários, publicação, histórico e checklist | Navegação curta por seção e próximo passo; aproveitar checklist para canais utilizados, com evidência de homologação | P1; UI/contrato apenas para evidências ausentes |
| Equipamentos/SmartPOS/impressão | Pareamento, filas, incidentes, diagnóstico e recuperação | Incidente abre tentativa/comanda exata; nomes de impressora/local; estado atualizado enquanto tela visível | P0/P1 conforme uso do equipamento; UI + contrato de incidente |
| Plataforma | Tenants, incidentes, MFA, outbox e ações auditadas | Filtrar por severidade/origem/idade e impacto na operação; visão de pilotos com problemas | P1 suporte; P2 visão salva |
| Acesso e shell | Papéis, PIN por colaborador, atalhos, terminal e navegação mobile | Preservar identificação/unidade; corrigir sino no perfil Delivery; reduzir jargão técnico nos avisos e ajuda | P0 sino; P1 UI |

O site comercial não é módulo de operação do restaurante e não recebeu auditoria de conversão/SEO. O shell nativo foi considerado na fronteira de equipamento/contingência; não foi executado em terminal físico.

## Evidência adicional dos módulos de gestão

- Estoque: `apps/frontends/ops/src/features/inventory/InventoryWorkspace.tsx:313`, `:436`; `InventoryPage.tsx:137`, `:281`.
- Compras: `apps/frontends/ops/src/features/purchases/PurchasesPage.tsx:503`.
- Financeiro: `apps/frontends/ops/src/features/finance/FinancePage.tsx:107`, `:355`, `:647`. Nome + URL de anexo existem; upload privado é proposta de extensão.
- Relatórios: `apps/frontends/ops/src/features/reports/ReportsPage.tsx:90`, `:544`; `ReportEnhancements.tsx:854`. O padrão do período é mês até hoje; favoritos locais já são identificados.
- Fiscal/Contador: `apps/frontends/ops/src/features/fiscal/FiscalPages.tsx:160`, `:442`, `:2420`. Não transformar `window.prompt` em prova de ausência de validação no servidor; a proposta é de contexto, erro e acessibilidade da interface.
- Pessoas: `apps/frontends/ops/src/features/people/PeoplePage.tsx:2329`, `:2655`. O filtro usa `toDateString()` do dispositivo; requer teste de virada do dia no fuso da unidade.
- Equipe: `apps/frontends/ops/src/features/waiter-settlements/WaiterSettlementsPage.tsx:118`, `:243`, `:293`. Registro de estado pago não é execução de transferência bancária.
- CRM: `apps/frontends/ops/src/features/crm/CrmWhatsappWorkspace.tsx:672`; `CrmBenefitsCampaigns.tsx:853`. Inbox/SLA já existem; preset é simplificação de acesso.
- Multiunidade: `apps/frontends/ops/src/features/multiunit/MultiunitPage.tsx:21`.
- Cobrança: `apps/frontends/ops/src/features/billing/BillingPage.tsx:334`.
- Plataforma: `apps/frontends/ops/src/platform.tsx:3268`, `:3315`.
- Equipamentos: `apps/frontends/ops/src/features/device/SmartPosAdminPanel.tsx:250`; `smartpos-admin.ts:58`; `ProductionPrintersPanel.tsx:169`, `:247`, `:1133`.
- Delivery: `apps/frontends/ops/src/features/delivery/DeliveryPage.tsx:103`, `:1540`, `:1580`; `growth.shared.tsx:91`. Existe meio de pagamento no contrato; o destaque na expedição pode reaproveitá-lo. Não entregue/devolvido é evolução de máquina de estados, não só novo botão.

## Ordem de execução sugerida

1. **Correções com risco operacional:** botão monetário, comprovante de caixa, sino por perfil, validação/recuperação de recepção; investigar divergência Delivery. Se QR entrar no piloto, corrigir seu acompanhamento. Conferir o fuso da equipe usada no turno.
2. **Um padrão de atendimento mais direto:** cabeçalhos menores, mesas em ordem estável, comanda com mais área útil, ações principais legíveis, estados e termos consistentes. Aplicar primeiro em Salão/Balcão/Conta/KDS, depois repetir nos módulos de gestão.
3. **Homologar um turno completo na casa:** da preparação ao fechamento, com os dispositivos e canais escolhidos, inclusive caminhos de falha. Corrigir o que impedir a equipe de concluir sem improviso.
4. **Usar o piloto para escolher a próxima funcionalidade:** passagem de turno, rodada selecionada, ruptura assistida ou alocação de pagamento por pessoa. Medir tempo, rolagem, retornos de tela, pedidos corrigidos e necessidade de ajuda; não há metas numéricas nem ganhos percentuais presumidos nesta revisão.

## Funcionalidades a avaliar depois dos ajustes essenciais

Estas são propostas de evolução, não alegações de ausência de toda a infraestrutura correspondente.

1. **Passagem de turno com pendências.** Reunir contas abertas, pedidos ainda não servidos, chamados, falhas de impressão e divergências de caixa; o responsável que entra confirma ciência. Reusar turnos, atribuições, auditoria e transferência já existentes. Não transferir responsabilidade financeira automaticamente.
2. **Alergia explícita no pedido por QR.** O atendimento interno já possui `allergyNote`; o cliente dispõe de observação genérica. Avaliar campo separado com destaque consistente na revisão da equipe, KDS e impressão. Exige contrato e persistência; não inferir alergia automaticamente de uma nota ou prometer ausência de contaminação.
3. **Repor uma rodada selecionada.** Evoluir Repetir último para selecionar apenas as bebidas/itens desejados, ajustar quantidades e revisar preço/disponibilidade atuais. Útil em bar; não precisa de um novo módulo de pedidos.
4. **Resolver ruptura nos pedidos já lançados.** Ao esgotar produto, mostrar pedidos ainda afetados e conduzir substituição ou cancelamento com diferença de valor, autorização e confirmação. Reusar disponibilidade, exceções e mecanismos de cancelamento; pausar novas vendas sozinho não resolve o pedido já aceito.
5. **Liberar etapas pelo atendimento.** Avaliar expor no Salão o mecanismo existente de espera/liberação do KDS: entradas agora, principais depois, sobremesas quando solicitadas. É descoberta e integração do fluxo existente, não motivo para criar outro motor de produção.

## Critérios de aceite para a primeira operação

| Jornada | Evidência necessária |
|---|---|
| Abrir mesa, lançar adicionais e enviar | Mesa/comanda correta, total conferido, destino correto, estado confirmado no segundo dispositivo |
| Bebida e prato em estações diferentes | Preparo e entrega parcial compreensíveis; entrega de um item não encerra indevidamente os demais |
| Receber por pessoa ou outro valor | Total, recebido líquido, saldo e arredondamento corretos; comprovante coerente; sem cobrança duplicada |
| Resposta incerta da maquininha/impressora | Operador orientado a consultar/reconciliar; repetir indiscriminadamente não é a ação padrão |
| Reserva/espera → mesa | Mesa e responsável definidos; não há registro de acomodação separado do atendimento real |
| Delivery do início à entrega | Mesmo pedido rastreável no Balcão/KDS/expedição e pagamento conciliado |
| Pedido QR | Solicitação, confirmação, produção e encerramento acompanhados pela sessão autorizada |
| Falha de internet e retorno | Limite de contingência do equipamento explícito, fila recuperada e conflitos visíveis |
| Fechar e trocar turno | Contagem, pendências, divergências e responsabilidade auditáveis |
| Mobile e acessibilidade | 375 px, tablet e desktop; light/dark; teclado, foco, zoom e ausência de cortes em ações/valores |

Os checks de software não substituem impressora física, terminal de pagamento, emissão fiscal e restauração de backup. Ativar apenas os canais que tenham evidência suficiente no ambiente da casa. Nesta revisão, esses critérios foram definidos, não executados.

Para alvos de toque, preservar o padrão operacional do projeto, em torno de 40–44 px quando aplicável. Isso é uma escolha de usabilidade: o critério AA 2.5.8 da WCAG 2.2 define 24 × 24 CSS px com exceções de espaçamento/equivalência. [Referência W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Mensagens de sincronização, sucesso e erro também devem ser identificáveis por tecnologias assistivas, sem depender apenas da cor ou de um toast que desaparece. [Referência W3C para mensagens de estado](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
