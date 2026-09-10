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
