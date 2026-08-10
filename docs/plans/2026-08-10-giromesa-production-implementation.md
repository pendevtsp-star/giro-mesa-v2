# GiroMesa Production Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar o GiroMesa V2 como plataforma operacional completa, segura, extensivel e verificavel, mantendo gates externos explicitos.

**Architecture:** Modular core cloud-first com PostgreSQL como autoridade, PWA para os clientes, Edge Hub opcional para offline/dispositivos, inbox/outbox e adapters versionados para efeitos externos.

**Tech Stack:** TypeScript, NestJS, React/Vite, Next.js, Drizzle/PostgreSQL, Redis, Vitest, Playwright, .NET 10/ASP.NET Edge Hub, Docker Compose e OpenTelemetry.

---

## Regras de execucao

- TDD: teste falha, implementacao minima, teste passa, refactor.
- Nao enfraquecer tipos, autorizacao, validacao ou testes para obter verde.
- Cada migration e aditiva e compativel com N/N-1.
- Cada endpoint e job leva contexto de tenant/unidade e possui teste negativo de isolamento.
- Cada side effect usa idempotencia persistente e dispatch/ack ou inbox/outbox.
- `production-approved` nunca e declarado sem os gates externos do design.

## Lote 0 — Baseline e protecoes de release

### Task 1: registrar baseline reproduzivel

**Arquivos:**
- Modificar: `package.json`
- Criar: `scripts/check-production-baseline.mjs`
- Criar: `docs/runbooks/release-levels.md`
- Testar: `scripts/check-production-baseline.test.mjs`

1. Escrever teste que rejeita release sem nivel, artefato, migration e resultado de gates.
2. Executar o teste e confirmar falha.
3. Implementar manifesto de release e scripts.
4. Rodar `rtk pnpm test`, `rtk pnpm lint`, `rtk pnpm typecheck` e `rtk pnpm build`.

### Task 2: supply chain e scan

**Arquivos:**
- Criar: `.github/workflows/security.yml`
- Modificar: `Dockerfile*`, `docker-compose*.yml` quando existentes
- Criar: `docs/runbooks/vulnerability-response.md`

Adicionar secret scan, dependency/SCA, SBOM, imagens non-root e provenance sem publicar segredos.

## Lote 1 — Fundacao multitenant, eventos e reconciliacao

### Task 3: contexto e RLS

**Arquivos:**
- Modificar: `packages/db/src/schema.ts`
- Modificar: `packages/db/src/operations-schema.ts`
- Modificar: `packages/db/src/management-schema.ts`
- Criar: `packages/db/src/tenant-context.ts`
- Criar: `packages/db/drizzle/0009_tenant_rls_and_event_foundation.sql`
- Criar: `apps/api/src/database/tenant-context.interceptor.ts`
- Testar: `apps/api/src/organizations/tenant-isolation.integration.test.ts`

Testar HTTP, jobs e reaproveitamento de conexao com tenant alternado; aplicar `FORCE RLS`, papeis separados e limpeza de contexto.

### Task 4: command envelope, inbox/outbox e sequencia

**Arquivos:**
- Criar: `packages/domain/src/command-envelope.ts`
- Modificar: `packages/db/src/operations-schema.ts`
- Criar: `packages/db/src/event-schema.ts`
- Modificar: `apps/api/src/sync/sync.service.ts`
- Modificar: `apps/api/src/sync/sync.schemas.ts`
- Testar: `apps/api/src/sync/ordering.integration.test.ts`

Adicionar idempotency, occupancy epoch, resource version, aggregate sequence, inbox, outbox, quarantine e replay seguro.

### Task 5: matriz de conflitos

**Arquivos:**
- Criar: `packages/domain/src/conflict-matrix.ts`
- Criar: `packages/domain/src/conflict-matrix.test.ts`
- Modificar: `apps/api/src/sync/sync-pilot.service.ts`
- Modificar: `apps/edge-hub/Sync/CloudSyncWorker.cs`
- Testar: `apps/edge-hub.tests/ConflictMatrixTests.cs`

Cobrir fechamento, transferencia, preco, cancelamento, pagamento, reorder, duplicacao e lacuna.

## Lote 2 — Autenticacao, verificacao, onboarding e provisionamento

### Task 6: verificacao de e-mail e sessao

**Arquivos:**
- Modificar: `apps/api/src/auth/auth.service.ts`
- Modificar: `apps/api/src/auth/auth.controller.ts`
- Modificar: `apps/api/src/auth/auth.module.ts`
- Modificar: `packages/db/src/schema.ts`
- Criar: `apps/site/app/verificar-email/page.tsx`
- Testar: `apps/api/src/auth/email-verification.integration.test.ts`

Tokens hash-only, expiram, uso unico, resend rate-limited; Google verificado continua valido.

### Task 7: saga de provisionamento

**Arquivos:**
- Modificar: `apps/api/src/onboarding/onboarding.service.ts`
- Modificar: `packages/domain/src/onboarding.ts`
- Modificar: `packages/db/src/schema.ts`
- Criar: `apps/api/src/onboarding/provisioning.integration.test.ts`
- Modificar: `packages/db/src/seed.ts`

Estados recuperaveis, idempotencia, compensacao, seed demo isolado e trial apos checklist minimo.

### Task 8: onboarding operacional completo

**Arquivos:**
- Criar: `apps/ops/src/onboarding.tsx`
- Modificar: `apps/ops/src/App.tsx`
- Modificar: `apps/ops/src/router.ts`
- Modificar: `apps/ops/src/styles.css`
- Testar: `apps/ops/src/onboarding.test.tsx`
- Criar: `e2e/onboarding.spec.ts`

Implementar organizacao, unidade, plano, fiscal, catalogo, mesas, equipe, QR, KDS/impressao e teste de ponta a ponta.

## Lote 3 — PWA, bridge e identidade visual base

### Task 9: bridge seguro no navegador

**Arquivos:**
- Modificar: `apps/ops/index.html`
- Modificar: `apps/ops/src/bridge.ts`
- Criar: `apps/ops/src/bridge.test.ts`

Carregar bridge MAUI apenas quando o host nativo estiver disponivel; navegador puro nao solicita script inexistente.

### Task 10: manifests, service workers e updates

**Arquivos:**
- Criar: `apps/ops/public/manifest.webmanifest`
- Criar: `apps/ops/public/sw.js`
- Criar: `apps/customer/app/manifest.ts`
- Criar: `apps/customer/public/sw.js`
- Criar: `apps/site/app/manifest.ts`
- Criar: `apps/site/public/sw.js`
- Criar: `apps/ops/src/pwa-update.tsx`
- Testar: `e2e/pwa-update.spec.ts`

Adicionar update coordenado, migracao IndexedDB, TTL, limpeza e estados de conectividade por camada.

### Task 11: favicon, icons e eliminacao de pseudo-icones

**Arquivos:**
- Modificar: `apps/site/app/layout.tsx`
- Modificar: `apps/customer/app/layout.tsx`
- Modificar: `apps/ops/src/App.tsx`
- Modificar: `apps/customer/lib/menu.ts`
- Modificar: `apps/customer/components/menu-experience.tsx`
- Modificar: `apps/ops/src/**/*.tsx`
- Criar/Modificar: assets em `apps/*/public/icons/`

Usar uma familia de icones e preservar conteudo livre do cliente.

## Lote 4 — Landing premium e menu publicavel

### Task 12: hero e performance comercial

**Arquivos:**
- Modificar: `apps/site/app/page.tsx`
- Modificar: `apps/site/app/globals.css`
- Criar: `apps/site/app/components/product-carousel.tsx`
- Criar: `apps/site/app/components/product-carousel.test.tsx`
- Criar: `e2e/landing-accessibility.spec.ts`

Remover os dois eyebrows, adicionar carrossel nitido com controles, pausa, teclado, reduced motion e budget de LCP; manter WhatsApp e e-mail.

### Task 13: branding e ciclo do menu

**Arquivos:**
- Modificar: `packages/db/src/growth-schema.ts`
- Criar: `packages/db/drizzle/0010_public_menu_branding.sql`
- Modificar: `apps/api/src/public-menu/public-menu.service.ts`
- Modificar: `apps/api/src/public-menu/public-menu.controller.ts`
- Criar: `apps/api/src/media/media.module.ts`
- Criar: `apps/api/src/media/media.service.ts`
- Modificar: `apps/customer/components/menu-experience.tsx`
- Modificar: `apps/customer/app/globals.css`
- Testar: `apps/api/src/public-menu/public-menu-publish.integration.test.ts`

Draft/preview/version/publish atomico, logo/capa/cores/fotos, upload recodificado e assets imutaveis.

## Lote 5 — Pracas, turnos, ocupacao e mapa operacional

### Task 14: schema e maquina de ocupacao

**Arquivos:**
- Modificar: `packages/db/src/operations-schema.ts`
- Criar: `packages/db/drizzle/0011_operational_map.sql`
- Criar: `packages/domain/src/table-occupancy.ts`
- Criar: `packages/domain/src/table-occupancy.test.ts`
- Modificar: `apps/api/src/pilot-operations/pilot-pos.service.ts`
- Testar: `apps/api/src/pilot-operations/table-occupancy.integration.test.ts`

Adicionar DiningRoom, ServiceArea, layout version, shift, assignment, group, occupancy e transicoes exclusivas.

### Task 15: APIs do mapa

**Arquivos:**
- Criar: `apps/api/src/salon/salon.module.ts`
- Criar: `apps/api/src/salon/salon.controller.ts`
- Criar: `apps/api/src/salon/salon.service.ts`
- Criar: `apps/api/src/salon/salon.schemas.ts`
- Modificar: `apps/api/src/app.module.ts`
- Testar: `apps/api/src/salon/salon.integration.test.ts`

CRUD versionado, publish imutavel, atribuicao de praca, presenca lease/ack e fila de excecoes.

### Task 16: canvas operacional estruturado

**Arquivos:**
- Criar: `apps/ops/src/salon-map.tsx`
- Criar: `apps/ops/src/salon-map.test.tsx`
- Modificar: `apps/ops/src/operations.tsx`
- Modificar: `apps/ops/src/styles.css`
- Criar: `e2e/salon-map.spec.ts`

Mapa com edit/operation, zoom/drag, layout estavel, busca, filtros, praca do garcom e painel lateral completo.

## Lote 6 — QR seguro, chamados e conta parcial

### Task 17: token por ocupacao

**Arquivos:**
- Modificar: `apps/api/src/public-menu/public-menu.service.ts`
- Modificar: `apps/api/src/public-menu/public-menu.controller.ts`
- Criar: `apps/api/src/public-menu/table-session.ts`
- Modificar: `packages/db/src/growth-schema.ts`
- Testar: `apps/api/src/public-menu/table-session.integration.test.ts`

Assinatura, nonce, capabilities, expiracao, revogacao, rate limit e occupancy epoch.

### Task 18: chamados roteados e parcial

**Arquivos:**
- Modificar: `apps/api/src/realtime/realtime.service.ts`
- Criar: `apps/api/src/public-menu/table-service.service.ts`
- Modificar: `apps/customer/components/public-services-experience.tsx`
- Modificar: `apps/customer/lib/public-contracts.ts`
- Testar: `apps/api/src/public-menu/table-service.integration.test.ts`
- Criar: `e2e/customer-table-session.spec.ts`

Estados recebido/encaminhado/atendido, primary/support/fallback e parcial da ocupacao atual.

## Lote 7 — KDS, impressao e Edge Hub

### Task 19: dispatch ledger por destino

**Arquivos:**
- Modificar: `packages/db/src/operations-schema.ts`
- Criar: `packages/db/drizzle/0012_dispatch_ledger.sql`
- Modificar: `apps/api/src/pilot-operations/pilot-pos.service.ts`
- Modificar: `apps/edge-hub/OperationalCommand.cs`
- Modificar: `apps/edge-hub/Storage/HubStore.cs`
- Testar: `apps/api/src/pilot-operations/dispatch.integration.test.ts`
- Testar: `apps/edge-hub.tests/DispatchLedgerTests.cs`

Implementar modos por estacao, ack, reprint, cancelamento, contingencia, DLQ e reconciliacao.

### Task 20: KDS de producao

**Arquivos:**
- Modificar: `apps/ops/src/operations.tsx`
- Criar: `apps/ops/src/kds-board.tsx`
- Criar: `apps/ops/src/kds-board.test.tsx`
- Modificar: `apps/ops/src/styles.css`
- Criar: `e2e/kds.spec.ts`

Legibilidade a distancia, prioridades redundantes, estacoes, SLA, undo curto e estados de dispositivo.

### Task 21: endurecer Edge Hub

**Arquivos:**
- Modificar: `apps/edge-hub/Security/DeviceAuthenticator.cs`
- Modificar: `apps/edge-hub/HubOptions.cs`
- Modificar: `apps/edge-hub/Program.cs`
- Modificar: `apps/edge-hub/Storage/HubStore.cs`
- Criar: `apps/edge-hub/Security/HubIdentity.cs`
- Criar: `apps/edge-hub.tests/HubRecoveryTests.cs`

mTLS, identidade, revogacao, clone/rollback, disco/clock, backup, reinstalacao e runbook.

## Lote 8 — Pagamentos, ledger, fiscal e SmartPOS

### Task 22: ledger monetario

**Arquivos:**
- Modificar: `packages/db/src/management-schema.ts`
- Criar: `packages/db/drizzle/0013_financial_ledger.sql`
- Criar: `packages/domain/src/money-ledger.ts`
- Criar: `packages/domain/src/money-ledger.test.ts`
- Criar: `apps/api/src/payments/payments.module.ts`
- Criar: `apps/api/src/payments/payments.service.ts`
- Testar: `apps/api/src/payments/payments.integration.test.ts`

Partidas balanceadas, parcial, servico, gorjeta, taxa, estorno, chargeback e ajuste.

### Task 23: adapters e estado incerto

**Arquivos:**
- Criar: `packages/domain/src/payment-adapter.ts`
- Criar: `apps/api/src/payments/adapters/simulator.adapter.ts`
- Modificar: `apps/edge-hub/Adapters/GatewayContracts.cs`
- Modificar: `apps/edge-hub/Adapters/DisabledGateways.cs`
- Criar: `apps/edge-hub/Adapters/SmartPosSimulator.cs`
- Testar: `apps/api/src/payments/payment-uncertain.integration.test.ts`
- Testar: `apps/edge-hub.tests/PaymentAdapterTests.cs`

PaymentIntent/Attempt/terminal, lookup, callback, reconcile, manual review e sem PAN/CVV.

### Task 24: fiscal desacoplado

**Arquivos:**
- Modificar: `apps/edge-hub/Adapters/FocusFiscalGateway.cs`
- Criar: `packages/domain/src/fiscal-state.ts`
- Criar: `packages/domain/src/fiscal-state.test.ts`
- Criar: `apps/api/src/fiscal/fiscal.module.ts`
- Criar: `apps/api/src/fiscal/fiscal.service.ts`
- Testar: `apps/api/src/fiscal/fiscal.integration.test.ts`

Venda preservada, documento pending/retry/authorized/rejected/cancelled e homologacao por adapter.

## Lote 9 — Estoque, retornaveis e incidentes

### Task 25: unidades e ficha versionada

**Arquivos:**
- Modificar: `packages/db/src/management-schema.ts`
- Criar: `packages/db/drizzle/0014_inventory_returnables.sql`
- Criar: `packages/domain/src/quantities.ts`
- Criar: `packages/domain/src/quantities.test.ts`
- Modificar: `apps/worker/src/inventory.ts`
- Testar: `apps/worker/src/inventory.integration.test.ts`

Decimal, unidade dimensional, conversao, yield e ficha tecnica effective-dated.

### Task 26: ledger de vasilhames

**Arquivos:**
- Criar: `apps/api/src/returnables/returnables.module.ts`
- Criar: `apps/api/src/returnables/returnables.service.ts`
- Criar: `apps/api/src/returnables/returnables.controller.ts`
- Testar: `apps/api/src/returnables/returnables.integration.test.ts`
- Criar: `apps/ops/src/returnables.tsx`
- Criar: `apps/ops/src/returnables.test.tsx`

Tracking agregado/serializado, fornecedor, lote, deposito, mesa, garcom e reconciliacao fisica.

### Task 27: incidentes gerenciais

**Arquivos:**
- Criar: `apps/api/src/incidents/incidents.module.ts`
- Criar: `apps/api/src/incidents/incidents.service.ts`
- Criar: `apps/ops/src/incidents.tsx`
- Testar: `apps/api/src/incidents/incidents.integration.test.ts`

Linguagem neutra, evidencias, aprovacao e relatorio; nenhuma integracao automatica com folha.

## Lote 10 — Taxa de servico, comissao e participacao

### Task 28: rule engine seguro

**Arquivos:**
- Modificar: `packages/domain/src/commercial.ts`
- Criar: `packages/domain/src/remuneration-rules.ts`
- Criar: `packages/domain/src/remuneration-rules.test.ts`
- Modificar: `packages/db/src/management-schema.ts`
- Criar: `packages/db/drizzle/0015_remuneration_rules.sql`

DSL tipada sem eval, versao, vigencia, simulacao, memoria e freeze.

### Task 29: apuracao e relatorios

**Arquivos:**
- Modificar: `apps/api/src/management/management.service.ts`
- Criar: `apps/api/src/management/remuneration.service.ts`
- Criar: `apps/ops/src/remuneration.tsx`
- Testar: `apps/api/src/management/remuneration.integration.test.ts`
- Criar: `e2e/remuneration-report.spec.ts`

Separar servico, comissao e participacao; estimated/approved/closed; PDF, CSV e print.

## Lote 11 — DoseClub Integration Contract v2

### Task 30: receiver GiroMesa

**Arquivos:**
- Criar: `apps/api/src/integrations/doseclub/doseclub.module.ts`
- Criar: `apps/api/src/integrations/doseclub/doseclub.controller.ts`
- Criar: `apps/api/src/integrations/doseclub/doseclub.service.ts`
- Criar: `apps/api/src/integrations/doseclub/doseclub.schemas.ts`
- Modificar: `packages/db/src/operations-schema.ts`
- Criar: `packages/db/drizzle/0016_doseclub_integration.sql`
- Testar: `apps/api/src/integrations/doseclub/doseclub.integration.test.ts`

Preservar header e idempotencia atuais; introduzir contract version, venda, reserva, consumo, reversao e reconcile.

### Task 31: compatibilidade no DoseClub

**Repositorio:** `C:\Users\maxue\projetos_programação\clube_do_whisky`

**Arquivos:**
- Modificar: `packages/shared/src/giromesa-client.ts`
- Modificar: schemas/outbox existentes localizados pelo teste
- Criar: teste contratual v1/v2 ao lado do client

Manter standalone, flag `inventoryMode`, v1 compativel e migracao explicita para v2.

### Task 32: reconciliacao e UI de mapeamento

**Arquivos:**
- Criar: `apps/worker/src/doseclub-reconciliation.ts`
- Criar: `apps/worker/src/doseclub-reconciliation.test.ts`
- Criar: `apps/ops/src/doseclub-integration.tsx`
- Testar: `e2e/doseclub-integration.spec.ts`

Mapeamento de produtos, divergencias, DLQ, requeue e reconciliacao diaria.

## Lote 12 — Backoffice completo

### Task 33: APIs administrativas seguras

**Arquivos:**
- Modificar: `apps/api/src/platform/platform.service.ts`
- Modificar: `apps/api/src/platform/platform.controller.ts`
- Modificar: `apps/api/src/platform/platform-access.ts`
- Criar: `apps/api/src/platform/platform-actions.integration.test.ts`

Leads, tenant, plan, entitlement, user, suspension, onboarding, billing, support, integration, incident e audit com step-up/dual-control.

### Task 34: UI acionavel

**Arquivos:**
- Modificar: `apps/ops/src/platform.tsx`
- Modificar: `apps/ops/src/platform.test.ts`
- Modificar: `apps/ops/src/styles.css`
- Criar: `e2e/backoffice.spec.ts`

Read-only inicial, contexto permanente, impacto, justificativa, approvals e trilha de auditoria.

## Lote 13 — Demo coerente, observabilidade e LGPD

### Task 35: demo isolada

**Arquivos:**
- Modificar: `packages/db/src/seed.ts`
- Modificar: `apps/ops/src/demo-data.ts`
- Criar: `scripts/reset-demo-tenant.mjs`
- Criar: `scripts/reset-demo-tenant.test.mjs`

120 mesas, pracas, turnos, KDS, estoque, retornaveis, incidentes, pagamentos e DoseClub sem contaminar producao.

### Task 36: OpenTelemetry e runbooks

**Arquivos:**
- Criar: `apps/api/src/observability/observability.module.ts`
- Criar: `apps/worker/src/observability.ts`
- Criar: `apps/ops/src/observability.ts`
- Criar: `infra/observability/`
- Criar: `docs/runbooks/incident-response.md`
- Testar: `apps/api/src/observability/redaction.test.ts`

Metricas/logs/traces, redacao, budgets de cardinalidade, dashboards, alertas, owners e synthetic checks.

### Task 37: ciclo LGPD

**Arquivos:**
- Criar: `docs/privacy/data-inventory.md`
- Criar: `apps/api/src/privacy/privacy.module.ts`
- Criar: `apps/api/src/privacy/privacy.service.ts`
- Testar: `apps/api/src/privacy/privacy.integration.test.ts`

Exportar, corrigir, anonimizar/excluir e propagar conforme politica, inclusive offline e objetos.

## Lote 14 — QA Impeccable, carga, DR e release

### Task 38: refinamento por papel

**Arquivos:**
- Modificar: `apps/ops/src/styles.css`
- Modificar: `apps/site/app/globals.css`
- Modificar: `apps/customer/app/globals.css`
- Modificar: componentes afetados nos lotes anteriores
- Criar: `e2e/visual-roles.spec.ts`

Aplicar Impeccable: hierarquia, tipografia, contraste, densidade, estados, responsividade, reduced motion e alvos touch; capturar desktop/tablet/POS/mobile/KDS.

### Task 39: carga e soak

**Arquivos:**
- Criar: `load/k6-operational.js`
- Criar: `load/k6-public-qr.js`
- Criar: `load/k6-multitenant.js`
- Criar: `docs/runbooks/load-gates.md`

Modelar 500 mesas, 50 terminais, 2.000 QR por unidade, multiplos tenants e 2x alvo com thresholds obrigatorios.

### Task 40: backup/restore e niveis de release

**Arquivos:**
- Criar: `scripts/backup-production.ps1`
- Criar: `scripts/restore-drill.ps1`
- Criar: `docs/runbooks/disaster-recovery.md`
- Modificar: `docs/external-dependencies.md`

Comprovar banco, objetos, configs e versao em RPO 5 min/RTO 30 min. Publicar apenas o nivel comprovado.

## Matriz final de verificacao

Executar, registrar evidencia e corrigir falhas:

```powershell
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk pnpm build
rtk pnpm test:e2e
rtk dotnet test apps/edge-hub.tests/GiroMesa.EdgeHub.Tests.csproj -c Release
rtk pnpm integrations:check
```

Depois:

- migrations em PostgreSQL isolado;
- tenant isolation/RLS negativo;
- contract v1/v2 conjunto com DoseClub;
- Axe e QA visual humano;
- k6 load/spike/soak;
- restore drill;
- smoke staging/piloto e rollback;
- homologacao fisica somente quando as dependencias externas estiverem disponiveis.
