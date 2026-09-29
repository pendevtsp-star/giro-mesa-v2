# Homologação de Mesas e Comandas

Este roteiro separa prova de software de homologação física. A entrega só recebe **GO de produção** quando os dois blocos estiverem aprovados no mesmo artefato.

## Gate automatizado

Em banco PostgreSQL descartável:

```powershell
$env:SALON_E2E_DATABASE_URL = "postgresql://..."
rtk pnpm test:e2e:salon-live
rtk pnpm --filter @giromesa/ops exec vitest run src/features/salon/SalonPage.test.ts src/features/salon/FloorPlan.test.ts
rtk pnpm --filter @giromesa/ops typecheck
```

O E2E deve concluir abertura de mesas, pedido, unificação, divisão persistida, pedido de conta, restauração do contexto após reload e sinalização offline. Impressão local exige confirmação explícita do operador; jobs cloud exigem resultado autenticado do Edge Hub. O teste PostgreSQL de `pilot-pos.integration.test.ts` deve confirmar que duas aberturas concorrentes da mesma mesa produzem exatamente uma comanda raiz.

Para 500 mesas e 50 terminais, execute o profile `target` descrito em [load-gates.md](./load-gates.md). Smoke local não aprova capacidade.

## Contas do mesmo atendimento

A partir da migration `0083_linked_service_accounts`, separar consumo sem escolher outra mesa mantém `tableId` e vincula a nova conta por `serviceRootTabId`. Na mesma tela, selecione Principal ou uma conta vinculada para operar, imprimir, receber e finalizar. Também é possível mover quantidades para outra conta aberta do mesmo atendimento. Os valores confirmados vêm da API; a prévia da divisão é uma estimativa.

- Atualize a página e confirme as mesmas contas, itens, pagamentos e saldo. O resumo `getTab.service` soma o atendimento; `relatedTabs` mantém valores e situação de cada conta.
- Divida quantidades com desconto e taxa cujo arredondamento produza resto de centavo. A soma deve permanecer idêntica após recarregar; o ajuste da taxa fica persistido. Repetir a mesma chave idempotente não cria outra conta nem outra baixa de consumo.
- Confirme que itens já enviados mantêm quantidade e estágio no KDS sem novo preparo ou nova baixa de estoque. Itens ainda não enviados devem ser divididos separadamente dos já enviados.
- Origem e destino devem estar abertos e sem pagamento, perda aprovada ou cobrança reservada. A divisão para conta existente exige o mesmo atendimento, mesa e percentual de taxa. Transferir um atendimento com contas vinculadas para outra mesa permanece bloqueado.
- Receba cada conta individualmente. Finalizar a Principal mantém a mesa ocupada enquanto houver outra conta aberta; somente a última finalização envia a mesa para limpeza. Execute também duas finalizações concorrentes.
- Imprima vias da Principal e de uma conta nomeada: os nomes das contas devem diferir, com a mesma mesa identificada separadamente. A situação de um job não pode ser inferida da abertura de uma janela de impressão.

O teste real dedicado usa `tests/e2e-live/unified-service.config.ts` e `unified-service-live.spec.ts`. Execute-o somente com banco e serviços locais descartáveis configurados; registre a cobertura efetivamente observada em desktop e 375 px.

## Destino da pré-conta

Em Dispositivo/Impressão, a política por unidade define `notify_cashier` (avisar o caixa, padrão), `cashier_printer` (impressora cadastrada no caixa via Edge Hub) ou `local_terminal` (perfil local autorizado). A política tem revisão para detectar alterações concorrentes. Ela não altera o destino dos comprovantes de pagamento ou de fechamento.

Em `cashier_printer`, o Conector precisa anunciar `financial_print_jobs_v1` no heartbeat. Uma instalação antiga recebe a orientação para atualizar e pode continuar usando `notify_cashier`; versão textual ou conexão online não comprovam suporte. Com a capacidade já anunciada, o job e seu comando cloud persistem mesmo quando o Hub está offline; a fila mostra o diagnóstico. Reconectar não pode duplicar a via. Um comando expirado exige conferência do resultado; o navegador não pode confirmar nem reivindicar o job cloud. Falha confirmada permite nova tentativa auditada; resultado desconhecido exige resolução explícita antes disso.

O workflow `publish-edge-hub.yml` exige certificado de assinatura e gera o instalador assinado do commit escolhido. A publicação na VPS/GitHub não atualiza os computadores do restaurante: execute a opção Reparar do instalador atualizado e confirme o anúncio da capacidade antes de habilitar a pré-conta cloud. Sem certificado ou homologação física, essa integração permanece pendente; não distribua um executável sem assinatura como substituto.

## Gate físico 58 e 80 mm

Executar em cada combinação homologada de modelo, conexão, firmware, largura e code page:

- imprimir pré-conta com e sem logo, acentos, modificadores, desconto, taxa opcional, pagamento parcial e divisão;
- enviar um pedido com itens de cozinha e bar, confirmar um ticket por estação e validar os modos `kds_only`, `printer_only`, `both` e `disabled`;
- renomear uma estação e confirmar que o destino permanece o mesmo pelo ID; trocar a impressora da estação e confirmar a aplicação da nova revisão no Edge;
- confirmar legibilidade, largura, corte, ordem dos campos e fallback textual da logo;
- desligar a impressora antes do envio, durante o envio e após o spool;
- verificar que resultado desconhecido fica `confirmation_required`, não recebe retry automático e exige confirmação ou marcação de não impresso;
- reimprimir somente após motivo e confirmar que a auditoria mantém job original e nova tentativa;
- validar no caixa/gerência a fila global, o estado desejado/aplicado da configuração e, no garçom, somente os jobs permitidos.

Guardar fotos dos papéis, IDs dos jobs, modelo/serial, firmware, rede, horário e resultado esperado. `window.print()` prova a contingência do navegador, não a saída física.

## Gate SmartPOS e operação

Seguir [smartpos.md](./smartpos.md) para pareamento, assinatura, recuperação e fornecedor. Sem SDK, credenciais, APK assinado e terminal físico homologados, `homologated_pos` permanece bloqueado.

Com caixa, gerente e garçom reais, validar em 1440 px e 375 px:

- troca de praça, apoio, remanejamento com expiração e junção entre praças;
- perda de conexão antes e depois de cada mutação, sem duplicar comanda, pedido, cobrança ou impressão;
- conflito de revisão entre dois terminais com atualização e reaplicação consciente;
- fullscreen operacional, teclado, foco, leitor de tela, dark mode e ausência de overflow;
- pedido de conta local e encaminhado ao caixa, incluindo impressora offline.

## Decisão

Registrar commit, artefatos, ambiente, responsáveis e exceções. Qualquer duplicidade, perda financeira, vazamento entre tenants, impressão sem estado persistido ou integração SmartPOS fail-open é **NO-GO**.

## Revisão local de UX — 19/09/2026

Alterações mantidas no checkout, sem commit, push ou deploy. O Salão reutiliza o PDV do Balcão: Pedido, Conta e Pré-conta têm conteúdos separados; ações ocasionais continuam no menu Mais e nas respectivas janelas. O panorama usa fundo gelo no tema claro, estados com contraste, contadores legíveis e cartões de mesa destacados. Configuração e organização do turno permanecem separadas do atendimento.

Correções encontradas durante a inspeção:

- Os indicadores incluíam comandas de balcão. Agora consideram somente comandas abertas em mesas ativas, sem duplicar pessoas nas contas vinculadas do mesmo atendimento.
- A janela de Salão bloqueava os atalhos do PDV. Agora Alt+1/2/3 alternam Pedido/Conta/Pré-conta dentro dela, preservando o bloqueio quando uma janela secundária está aberta.
- Escape propagava o fechamento de uma janela secundária para a comanda. O cancelamento fica restrito à janela ativa; regras de tamanho também se aplicam apenas à janela proprietária.
- Editar Observação removia o item do rascunho antes de salvar. Agora cancelar preserva o item e salvar atualiza a mesma linha, sem duplicação.
- Repor rodada usava o último pedido do operador, mesmo em outra mesa. O histórico local desse atalho agora pertence à própria comanda; favoritos e produtos recentes continuam disponíveis entre atendimentos.
- O perfil de garçom podia ver o formulário manual de recebimento num terminal de caixa. A UI agora respeita perfil e modo do terminal, mantendo consulta por pessoa e pedido de conta ao caixa. Cobrança integrada continua dependendo de terminal e integração autorizados.
- A projeção do salão marcava mesas livres como somente panorama, mesmo quando o garçom estava escalado para atendê-las. Agora a abertura considera a praça efetiva do turno e remanejamentos válidos. Mesas ocupadas continuam exigindo acesso à comanda existente; escalas antigas não concedem capacidade de abertura a um perfil sem permissão.

Validação executada no navegador do Codex, com API/PostgreSQL locais e cadastros sintéticos:

| Área | Evidência observada |
| --- | --- |
| Panorama | Painel/lista, ordenação, busca/filtros, prioridades, configuração de praça/equipe, ajuda e abertura de mesas. |
| Comanda | Pedido, Conta, Pré-conta, Mais, histórico, edição do atendimento, cadastro de cliente, separar consumo, transferir item e unificar; janelas de ações estruturais foram inspecionadas e canceladas, sem executar transferências reais nesta rodada. |
| Rascunho | Adicionar item, cancelar edição com Escape, salvar observação sem perder ou duplicar a linha e enviar à produção. Repor rodada aparece na própria comanda após o envio e não aparece ao mudar para outra mesa. |
| Caixa | Conta de R$ 16,80: recebimento parcial de R$ 10,00, saldo R$ 6,80, segundo recebimento em dinheiro de R$ 10,00 com troco automático de R$ 3,20. Abertura e cancelamento do seletor de correção de pagamento. |
| Ciclo da mesa | Abertura, envio à produção, pagamentos, encerramento sem imprimir, assumir limpeza e liberar mesa. |
| Garçom | Abertura de mesa livre da própria praça pela interface, envio à produção, consulta por pessoa (R$ 16,80 / 2 = R$ 8,40), solicitação da conta ao caixa e ausência do formulário manual de pagamento. |
| Responsividade | Inspeção em 1440 px, 768 px e 375 px; temas claro/escuro, foco, atalhos e janelas secundárias. Nenhum overflow horizontal observado nos cenários inspecionados. |
| Impressão | Solicitação real de pré-conta com pagamento parcial; job exigiu conferência e foi marcado como não impresso. Não houve confirmação de saída física. |

Checks: suite Ops de 89 arquivos/437 testes durante a implementação; após os ajustes finais, testes direcionados de Salão, workspace, pagamentos e atalhos (40 testes), typecheck de Ops/UI e Biome dos arquivos alterados. Na API, build, typecheck e integração PostgreSQL de permissões passaram: praça atribuída, fora da praça, cobertura ativa/inativa, comanda invisível e perfil sem capacidade de abertura. A API local em 3218 foi atualizada e a aba original em 3118 voltou a carregar normalmente. O cenário automatizado adicionado em `tests/e2e-real/salon-production.spec.ts` cobre isolamento das abas, edição do rascunho e Escape; ele não foi executado pelo runner Playwright nesta rodada, que utilizou QA visual pelo navegador.

Limites: o turno usado no QA estava em `quick_service`; a abertura em `full_service` não foi executada visualmente nesta rodada. O contrato materializa praças novas somente na abertura de turno, por isso a configuração do turno existente foi preservada. Esta validação também não homologa impressora física, SmartPOS, carga, operação offline ou o ciclo completo de transferências/unificações concorrentes. Permanecem aplicáveis os gates acima. Os arquivos anteriores desta rodada foram preservados fora do Git em `C:\Users\maxue\.codex\backups\giromesa-salon-unification-20260919\before`; eventual retorno deve usar o diff desta rodada, sem descartar alterações anteriores do checkout.
