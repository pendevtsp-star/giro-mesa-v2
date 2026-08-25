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

O E2E deve concluir abertura de mesas, pedido, unificação, divisão persistida, pedido de conta, confirmação da impressão pelo navegador, restauração do contexto após reload e sinalização offline. O teste PostgreSQL de `pilot-pos.integration.test.ts` deve confirmar que duas aberturas concorrentes da mesma mesa produzem exatamente uma comanda.

Para 500 mesas e 50 terminais, execute o profile `target` descrito em [load-gates.md](./load-gates.md). Smoke local não aprova capacidade.

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
