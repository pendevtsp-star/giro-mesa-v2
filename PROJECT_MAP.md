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
| Site comercial | `apps/frontends/site/app/page.tsx`, `app/layout.tsx` | `components/`, `styles/`, demais rotas `app/*/page.tsx` |
| Cardápio público | `apps/frontends/customer/app/m/[slug]/page.tsx` | `components/menu/`, `components/services/`, `styles/` |
| Bootstrap do Ops | `apps/frontends/ops/src/main.tsx`, `src/App.tsx` | `src/app/PageContent.tsx`, `src/features/shell/OperationalApp.tsx` |
| Atendimento | `apps/frontends/ops/src/features/salon/SalonPage.tsx` | `operations.shared.tsx`, `operational-dispatch.ts`, API `pilot-operations` |
| Balcão/comanda | `apps/frontends/ops/src/features/counter/CounterPage.tsx` | `features/counter/`, API `pilot-pos.*` |
| Produção KDS | `apps/frontends/ops/src/features/kds/KdsPage.tsx`, `KdsSettingsPage.tsx` | `kds.navigation.ts`, shell `OperationalApp.tsx`, `operations.shared.tsx`, `operational-dispatch.ts`, API `pilot-pos.*`, Edge Hub |
| Cardápio operacional | `apps/frontends/ops/src/features/catalog/CatalogPage.tsx` | `CatalogExperience.tsx`, `components/`, `catalog.css`, API `pilot-catalog.*` |
| Delivery | `apps/frontends/ops/src/features/delivery/DeliveryPage.tsx` | `src/growth.shared.tsx`, `src/realtime.ts`, API `growth/`, `packages/db/src/growth-schema.ts` |
| Estoque e compras | `apps/frontends/ops/src/features/inventory/InventoryPage.tsx`, `features/purchases/PurchasesPage.tsx` | `InventoryWorkspace.tsx`, `InventoryModals.tsx`, `management.shared.tsx`, API `management/`, worker `inventory.ts` e `packages/db/src/management-schema.ts` |
| Pessoas | `apps/frontends/ops/src/features/people/PeoplePage.tsx`, `TimeClockBanner.tsx` | `management.shared.tsx`, `api.ts`, API `management/management.{controller,service,schemas,rules}.ts`, `packages/db/src/management-schema.ts` e `tests/e2e-real/people-production.spec.ts` |
| Fechamento da equipe | `apps/frontends/ops/src/features/waiter-settlements/WaiterSettlementsPage.tsx` | `waiter-settlements.ts`, `api.ts`, API `management/management-settlements.*` e `packages/db/src/settlement-schema.ts` |
| Relatórios | `apps/frontends/ops/src/features/reports/ReportsPage.tsx` | `management.shared.tsx`, API `management/management-report.*`, worker `reports.ts` e `packages/db/src/{management,operations}-schema.ts` |
| Fiscal e Contador | `apps/frontends/ops/src/features/fiscal/FiscalPages.tsx` | `features/fiscal/fiscal.ts`, API `fiscal/`, `packages/db/src/fiscal-schema.ts` e ciclo fiscal do Edge Hub |
| Publicação/QR do Cardápio | `apps/backends/api/src/public-menu/`, `pilot-catalog.service.ts` | `apps/frontends/customer/components/menu-experience.tsx`, tokens de mesa e mídia pública |
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
| Alterar Atendimento | feature `salon`, `operations.shared.tsx`, endpoints POS | teste estreito de salão + E2E real em breakpoints críticos |
| Alterar Produção KDS | feature `kds`, shell `OperationalApp.tsx`, `operations.shared.tsx`, API `pilot-operations`, Edge Hub | regras/contrato + typechecks API/Ops + Edge tests + E2E real KDS em 375 px/dark |
| Alterar Delivery | feature `delivery`, `growth.shared.tsx`, `realtime.ts`, API `growth`, schema `growth` | regras + integração PostgreSQL + teste E2E real em 375 px |
| Alterar Estoque/compras | features `inventory` e `purchases`, `management.shared.tsx`, API `management`, worker `inventory.ts`, schema `management` | regras + integração PostgreSQL + typechecks API/worker/Ops + mobile 390 px |
| Alterar Pessoas/ponto/comissões | feature `people`, `management.shared.tsx`, API `management`, schema `management` | regras de autorização/dinheiro + migration limpa/reaplicada + integração PostgreSQL + E2E real light/dark em 375 px |
| Alterar fechamento da equipe | feature `waiter-settlements`, `api.ts`, API `management-settlements`, schema `settlement` | regras financeiras/RBAC + migration limpa/reaplicada + integração PostgreSQL + typechecks API/Ops + E2E real em 375 px |
| Alterar preço/pagamento | contracts, domain, db, serviço API proprietário | unitário + integração + idempotência/audit |
| Alterar Relatórios | feature `reports`, `management.shared.tsx`, API `management/management-report.*`, worker `reports.ts`, schemas `management`/`operations` | regras financeiras/RBAC + migration PostgreSQL + typechecks API/worker/Ops + E2E real em 375 px |
| Alterar Fiscal/Contador | feature `fiscal`, API `fiscal`, schema fiscal e eventos `fiscal.*` do Edge Hub | unitários de regras + migration + typechecks API/Ops + testes .NET quando houver SDK |
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
