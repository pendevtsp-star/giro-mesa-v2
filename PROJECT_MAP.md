# GiroMesa V2 — mapa de código

Mapa de entrada para agentes e revisores. Ele complementa a [wiki gerada pelo Code Review Graph](./.code-review-graph/wiki/index.md); consulte primeiro a linha da tarefa e abra somente os arquivos indicados.

## Topologia

```text
Browser público ──> frontends/site e frontends/customer ──> backends/api
Operação web ─────> frontends/ops ────────────────────────> backends/api
Aplicativo nativo ─> native/ops-shell ─> bundle Ops + edge-hub
API ───────────────> packages/contracts/domain/db ────────> PostgreSQL
Worker ────────────> outbox do banco + provedores externos homologados
```

## Entry points por aplicação

| Área | Comece por | Expanda para |
|---|---|---|
| Site comercial | `apps/frontends/site/app/page.tsx`, `lib/commercial.ts`, `proxy.ts` | catálogo/landing/SEO/ofertas/legais/A-B públicos, `components/`, `styles/` e formulários/rotas `app/*/page.tsx` |
| Cardápio público | `apps/frontends/customer/app/m/[slug]/page.tsx` | `components/menu/`, `components/services/`, `styles/` |
| Bootstrap do Ops | `apps/frontends/ops/src/main.tsx`, `src/App.tsx` | `src/app/PageContent.tsx`, `src/features/shell/OperationalApp.tsx` |
| Atendimento | `apps/frontends/ops/src/features/salon/SalonPage.tsx`, seletores operacionais em `salon-operations.ts` | editor interno da configuração física em `FloorPlan.tsx`, `salon.css`, `operations.shared.tsx`, `operational-dispatch.ts`, geometria em `packages/domain/src/floor-geometry.ts`, API `pilot-operations`, `tests/e2e-live/salon-live.spec.ts` e `docs/runbooks/salon-production-homologation.md` |
| Balcão/comanda e impressão | `apps/frontends/ops/src/features/counter/CounterPage.tsx`, `CounterWorkspace.tsx` | API `pilot-pos.*`, jobs em `packages/db/src/operations-schema.ts`, formatter/gateway do Edge Hub e bridge do shell nativo |
| Dose Club por consumo | seletor em `CounterWorkspace.tsx`, cliente em `apps/frontends/ops/src/api.ts` | API `doseclub-integration/`, orquestração em `pilot-pos.service.ts`, `packages/db/src/doseclub-schema.ts`, provisionamento automático em `worker/src/doseclub-provisioning.ts` disparado por `worker/src/billing.ts`, consumo em `worker/src/doseclub.ts`/`outbox.ts` e `docs/runbooks/doseclub-reconciliation.md` |
| SmartPOS/PWA | `apps/frontends/ops/src/features/counter/SmartPosPaymentModal.tsx`, `src/features/device/{DeviceSetupPage,SmartPosAdminPanel}.tsx`, `src/pwa.ts` | API `pilot-payment-*.controller.ts`/`pilot-{pos,smartpos}.service.ts`, `packages/db/src/operations-schema.ts`, `apps/native/ops-shell/SmartPos*.cs`, `docs/runbooks/smartpos.md` |
| Produção KDS e impressoras | `apps/frontends/ops/src/features/kds/KdsPage.tsx`, `KdsSettingsPage.tsx`, `features/device/ProductionPrintersPanel.tsx` | `ProductionPrinterForm.tsx`, `ProductionStationPolicies.tsx`, `kds.navigation.ts`, `api.ts`, API `pilot-pos.*`, contratos/schema operacionais, fila cloud e Edge Hub |
| Cardápio operacional | `apps/frontends/ops/src/features/catalog/CatalogPage.tsx` | `CatalogExperience.tsx`, `components/`, `catalog.css`, API `pilot-catalog.*` |
| QR das mesas | `apps/frontends/ops/src/features/table-qrs/TableQrsPage.tsx` | geração em `table-qrs.print.ts`, upload/reuso de branding, API `pilot-catalog.*`/`pilot-pos.*`/`public-menu/public-table.service.ts`, métricas anônimas e código diário em `operations-schema.ts`, Customer `menu-experience.tsx` e Web Push em `pwa.ts`/`OperationalAttentionInbox.tsx`/worker `operational-push.ts` |
| Delivery | `apps/frontends/ops/src/features/delivery/DeliveryPage.tsx` | `src/growth.shared.tsx`, `src/realtime.ts`, API `growth/`, `packages/db/src/growth-schema.ts` |
| Clientes, CRM e WhatsApp | `apps/frontends/ops/src/features/crm/CrmPage.tsx`, `CrmWhatsappWorkspace.tsx` | API `growth/` e `evolution-go.ts`, realtime `src/realtime.ts`, worker `whatsapp.ts`/`outbox.ts`, schema/mídia privada em `packages/db/src/growth-schema.ts` e `whatsapp-artifacts.ts`, migration `0074_crm_operational_inbox.sql`, `docs/runbooks/evolution-go.md` |
| Estoque e compras | `apps/frontends/ops/src/features/inventory/InventoryPage.tsx`, `InventoryControls.tsx`, `features/purchases/PurchasesPage.tsx` | `InventoryWorkspace.tsx`, fila `inventory-offline.ts`, API `management.inventory-controls.*`, worker `inventory.ts` e `packages/db/src/management-schema.ts` |
| Pessoas | `apps/frontends/ops/src/features/people/PeoplePage.tsx`, `TimeClockBanner.tsx` | `management.shared.tsx`, `api.ts`, API `management/management.{controller,service,schemas,rules}.ts`, `packages/db/src/management-schema.ts` e `tests/e2e-real/people-production.spec.ts` |
| Configurações do estabelecimento | `apps/frontends/ops/src/features/settings/SettingsPage.tsx`, `settings.ts` e `settings.css` | Ops `api.ts`/shell, API `organizations/establishment-settings.service.ts` (revisão, cópia, histórico, restauração e resumo especializado), mídia do catálogo e `packages/contracts`/`packages/domain` |
| Assinatura e cobrança | `apps/frontends/ops/src/features/billing/BillingPage.tsx` | API/worker `billing/`, catálogo comercial e `packages/db/src/schema.ts` |
| Fechamento da equipe | `apps/frontends/ops/src/features/waiter-settlements/WaiterSettlementsPage.tsx` | `waiter-settlements.ts`, `api.ts`, API `management/management-settlements.*` e `packages/db/src/settlement-schema.ts` |
| Relatórios | `apps/frontends/ops/src/features/reports/ReportsPage.tsx` | famílias em `features/reports/families/`, recursos persistentes em `ReportEnhancements.tsx`, `management.shared.tsx`, API `management/management-report.*`, worker `reports.ts` e `packages/db/src/{management,operations}-schema.ts` |
| Fiscal e Contador | `apps/frontends/ops/src/features/fiscal/FiscalPages.tsx` | `features/fiscal/fiscal.ts`, API `fiscal/`, `packages/db/src/fiscal-schema.ts` e ciclo fiscal do Edge Hub |
| Back office da plataforma | `apps/frontends/ops/src/platform.tsx`, `src/api.ts` | API `platform/`, RBAC/MFA, auditoria, outbox e `docs/runbooks/platform-backoffice.md` |
| Publicação/QR do Cardápio | `apps/backends/api/src/public-menu/`, `pilot-catalog.service.ts` | `apps/frontends/customer/components/menu-experience.tsx`, sessão curta da mesa, consumo/pedido público, tokens de mesa e mídia pública |
| Shell/UI global | `apps/frontends/ops/src/features/shell/OperationalApp.tsx` | `src/styles/`, `packages/ui` |
| API bootstrap | `apps/backends/api/src/main.ts`, `src/app-factory.ts` | módulo proprietário em `src/<domínio>` |
| Operação piloto API | `apps/backends/api/src/pilot-operations/` | `pilot-pos.service.ts`, `pilot-catalog.service.ts`, schemas e controllers |
| Banco | `packages/db/src/schema.ts` | `operations-schema.ts`, `management-schema.ts`, `growth-schema.ts`, `drizzle/` |
| Worker | `apps/backends/worker/src/main.ts` | consumidores/outbox no mesmo workspace |
| Edge Hub | `apps/backends/edge-hub/Program.cs` | serviços locais e `apps/backends/edge-hub.tests` |
| Shell MAUI | `apps/native/ops-shell/GiroMesa.OpsShell.csproj` | `MauiProgram.cs`, `MainPage*`, `Resources/Raw/wwwroot` |
| Design system | `packages/ui/src/index.ts`, `src/index.css` | `tokens/`, `themes/`, `components/`, `patterns.css` |
| Contratos | `packages/contracts/src/index.ts` | `generated-api.ts`; origem OpenAPI em `apps/backends/api/openapi` |
| Domínio puro | `packages/domain/src/index.ts` | máquinas/regras exportadas pelo pacote |

## Roteamento por tarefa

| Tarefa | Arquivos mínimos | Check inicial |
|---|---|---|
| Alterar UI do Cardápio | `DESIGN.md`, feature `catalog`, `packages/ui` | `pnpm --filter @giromesa/ops typecheck` + teste real do Cardápio |
| Alterar QR das mesas | feature `table-qrs`, API `pilot-catalog`/`pilot-pos`/`public-menu`, schema operacional, contracts, Customer e PWA | RBAC/tenant + migration PostgreSQL + idempotência/rotação/presença + métricas sem PII + clientes gerados + builds API/Ops/Customer + E2E 375/1440 px |
| Alterar Atendimento | feature `salon`, `operations.shared.tsx`, `packages/domain/src/floor-geometry.ts`, endpoints/schema POS | geometria + RBAC/concorrência PostgreSQL + typechecks API/Ops + E2E real em 375/1440 px |
| Alterar comanda/impressão | `CounterWorkspace.tsx`, API/schema POS, Edge Hub e shell nativo | regras financeiras + integração PostgreSQL + snapshots 58/80 mm + typechecks/builds Ops/API/.NET |
| Alterar integração Dose Club | seletor do Balcão, API `doseclub-integration`, POS, schema `doseclub`, worker de provisionamento/consumo e contrato M2M do Dose Club | migrations nos dois sistemas + entitlement explícito + tenant/credenciais + idempotência + ciclo reserva/commit/reversão + teste conjunto real |
| Alterar Produção KDS | feature `kds`, shell `OperationalApp.tsx`, `operations.shared.tsx`, API `pilot-operations`, Edge Hub | regras/contrato + typechecks API/Ops + Edge tests + E2E real KDS em 375 px/dark |
| Alterar Delivery | feature `delivery`, `growth.shared.tsx`, `realtime.ts`, API `growth`, schema `growth` | regras + integração PostgreSQL + teste E2E real em 375 px |
| Alterar Estoque/compras | features `inventory` e `purchases`, `management.shared.tsx`, API `management`, worker `inventory.ts`, schema `management` | regras + integração PostgreSQL + typechecks API/worker/Ops + mobile 390 px |
| Alterar Pessoas/ponto/comissões | feature `people`, `management.shared.tsx`, API `management`, schema `management` | regras de autorização/dinheiro + migration limpa/reaplicada + integração PostgreSQL + E2E real light/dark em 375 px |
| Alterar configurações do estabelecimento | feature `settings`, shell/auth, API `organizations`, branding/publicação do catálogo e contratos/domínio | contratos + RBAC/tenant + API/Ops/customer typechecks + publicação pública + mobile/dark/WCAG |
| Alterar fechamento da equipe | feature `waiter-settlements`, `api.ts`, API `management-settlements`, schema `settlement` | regras financeiras/RBAC + migration limpa/reaplicada + integração PostgreSQL + typechecks API/Ops + E2E real em 375 px |
| Alterar assinatura/preço do GiroMesa | feature `billing`, API/worker `billing`, contracts e schema base | RBAC owner/tenant + migration + pró-rata + idempotência/webhook + typechecks API/worker/Ops + E2E 375/1440 px |
| Alterar SmartPOS | feature `counter`/`device`, `src/pwa.ts`, API `pilot-payment-*`/`pilot-pos`, schema de operações e shell MAUI | contratos + concorrência PostgreSQL + typechecks API/Ops + self-check nativo + E2E 360 px + terminal homologado antes de produção |
| Alterar Relatórios | feature `reports`, `management.shared.tsx`, API `management/management-report.*`, worker `reports.ts`, schemas `management`/`operations` | regras financeiras/RBAC + migration PostgreSQL + typechecks API/worker/Ops + E2E real em 375 px |
| Alterar Fiscal/Contador | feature `fiscal`, API `fiscal`, schema fiscal e eventos `fiscal.*` do Edge Hub | unitários de regras + migration + typechecks API/Ops + testes .NET quando houver SDK |
| Alterar back office da plataforma | `platform.tsx`, `api.ts`, API `platform/` e runbook | RBAC + MFA + auditoria/idempotência + testes API/Ops + E2E 375 px/WCAG |
| Alterar site/catálogo comercial | Site `lib/commercial.ts`, `app/page.tsx`, `proxy.ts`, formulários e páginas legais; back office/API comercial correspondentes | publicação versionada + fail-closed + SEO/mídia/alt + preço promocional calculado + consentimento/atribuição + A-B sem preço/entitlement + site test/lint/typecheck/build |
| Alterar autenticação/tenant | API `auth/common/organizations`, Ops `auth` | testes de autorização e isolamento de tenant |
| Alterar schema | `packages/db`, migration Drizzle, consumers do campo | schema test + migration + typecheck dos consumidores |
| Alterar contrato HTTP | controller/schema/service, OpenAPI, contracts/client C# | gerar clientes e exigir diff limpo dos gerados |
| Alterar componente visual | `packages/ui` e consumidor | lint/typecheck/test do UI + light/dark/mobile |
| Alterar deploy | Dockerfile, `.github/workflows`, `deploy/vps`, `infra` | build da imagem/configuração afetada |
| Alterar shell nativo | `apps/native/ops-shell`, bundle Ops | build Ops, `sync-ops-bundle.ps1`, build .NET quando SDK existir |

## Testes ativos

- `tests/e2e`: jornadas públicas e acessibilidade; config `playwright.config.ts`; executado no CI.
- `tests/e2e-real`: interface operacional com contratos reais mockados; config `playwright.real.config.ts`.
- Testes unitários/integração ficam junto dos workspaces proprietários.

## Code Review Graph

- Wiki: `.code-review-graph/wiki/index.md` e páginas de comunidade adjacentes.
- Antes de revisar: `get_minimal_context_tool(task=...)`.
- Para impacto: `detect_changes_tool(detail_level="minimal")` e `get_impact_radius_tool`.
- Para arquitetura: `get_architecture_overview_tool(detail_level="minimal")`.
- Depois de moves/refactors: `build_or_update_graph_tool` e `generate_wiki_tool`.
- `graph.db` contém paths absolutos e é local/regenerável; a wiki Markdown é o mapa portátil.

## Arquivos de decisão

- `AGENTS.md`: como agentes devem trabalhar.
- `DESIGN.md`: regras visuais de produção.
- `MEMORY.md`: fatos estáveis e preferências.
- `docs/external-dependencies.md`: integrações ainda dependentes de homologação.
- `deploy/vps` e `infra`: operação, rollback e infraestrutura; não tratar como documentação descartável.
