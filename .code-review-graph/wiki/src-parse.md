# src-parse

## Overview

Directory-based community: apps/frontends

- **Size**: 3085 nodes
- **Cohesion**: 0.3060
- **Dominant Language**: tsx

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| RootLayout | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/layout.tsx | 14-25 |
| generateMetadata | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/m/[slug]/page.tsx | 5-18 |
| PublicMenuPage | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/m/[slug]/page.tsx | 20-45 |
| PublicServicesPage | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/m/[slug]/servicos/page.tsx | 4-29 |
| Page | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/page.tsx | 1-12 |
| PrivacyPage | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/app/privacidade/page.tsx | 1-23 |
| CategoryNav | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/CategoryNav.tsx | 1-41 |
| ProductList | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/ProductList.tsx | 4-38 |
| applyTheme | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/ThemeSelector.tsx | 18-21 |
| ThemeSelector | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/ThemeSelector.tsx | 23-65 |
| followSystem | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/ThemeSelector.tsx | 37-41 |
| selectTheme | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/menu/ThemeSelector.tsx | 46-54 |
| Busy | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/services/PublicServiceForms.tsx | 4-4 |
| ReservationForm | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/services/PublicServiceForms.tsx | 6-49 |
| WaitlistForm | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/services/PublicServiceForms.tsx | 51-84 |
| CouponForm | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/services/PublicServiceForms.tsx | 86-114 |
| ConsentField | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/components/services/PublicServiceForms.tsx | 116-126 |
| test:totaliza quantidade e adicionais em centavos@L46 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 46-59 |
| test:busca considera nome, descrição e tags@L61 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 61-64 |
| test:busca desconsidera acentos@L66 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 66-78 |
| test:rejeita cardápio remoto incompleto antes de renderizar@L80 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 80-83 |
| test:aceita branding e versão opcionais sem confiar em metadata desconhecida@L85 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 85-125 |
| test:só confirma comando após aceite explícito da operação@L127 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 127-141 |
| test:aceita somente o token opaco do QR no parâmetro mesa@L143 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 143-155 |
| test:aceita somente token público de opt-out dentro do contrato@L157 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 157-161 |
| test:normaliza respostas públicas sem aceitar IDs ou confirmações implícitas@L163 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 163-172 |
| test:reusa a chave idempotente apenas enquanto o conteúdo da tentativa é igual@L174 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 174-182 |
| createKey | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/menu.test.ts | 176-176 |
| isCommandAccepted | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 1-8 |
| readTableAccessToken | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 10-17 |
| normalizeOptOutToken | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 19-23 |
| isPublicSubmissionAccepted | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 25-32 |
| readCouponValidation | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 34-48 |
| MutationAttempt | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 50-50 |
| resolveMutationAttempt | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/public-contracts.ts | 52-58 |
| test:normaliza e resolve a preferência visual do cardápio@L5 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/theme.test.ts | 5-11 |
| ThemePreference | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/theme.ts | 1-1 |
| normalizeThemePreference | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/theme.ts | 5-7 |
| resolveTheme | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/customer/lib/theme.ts | 9-11 |
| describe:shared report scope@L4 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/App.test.ts | 4-12 |
| it:requires organization and unit together@L5 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/App.test.ts | 5-11 |
| ErrorBoundary | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/ErrorBoundary.tsx | 4-32 |
| getDerivedStateFromError | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/ErrorBoundary.tsx | 7-9 |
| componentDidCatch | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/ErrorBoundary.tsx | 11-13 |
| render | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/ErrorBoundary.tsx | 15-31 |
| loadAuthenticatedAccess | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/app/access.ts | 20-23 |
| toScopeSource | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/app/access.ts | 25-32 |
| sessionForScope | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/app/access.ts | 34-79 |
| terminalSessionForView | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/app/access.ts | 81-100 |
| platformSession | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/app/access.ts | 102-127 |

*... and 924 more members.*

## Execution Flows

- **PublicMenuPage** (criticality: 0.71, depth: 5)
- **Home** (criticality: 0.68, depth: 5)
- **RootLayout** (criticality: 0.68, depth: 3)
- **verifyMfa** (criticality: 0.68, depth: 3)

## Dependencies

### Outgoing

- `expect` (506 edge(s))
- `map` (217 edge(s))
- `toBe` (194 edge(s))
- `useState` (180 edge(s))
- `Button` (161 edge(s))
- `stringify` (101 edge(s))
- `filter` (98 edge(s))
- `Input` (96 edge(s))
- `toEqual` (92 edge(s))
- `equal` (85 edge(s))
- `trim` (83 edge(s))
- `setMessage` (82 edge(s))
- `fn` (72 edge(s))
- `get` (69 edge(s))
- `objectContaining` (67 edge(s))

### Incoming

- `expect` (506 edge(s))
- `toBe` (194 edge(s))
- `toEqual` (92 edge(s))
- `equal` (85 edge(s))
- `stringify` (71 edge(s))
- `fn` (69 edge(s))
- `objectContaining` (67 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/features/shell/OperationalApp.tsx::OperationalApp` (56 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/features/salon/FloorPlan.tsx` (56 edge(s))
- `stringContaining` (55 edge(s))
- `toMatchObject` (50 edge(s))
- `toContain` (47 edge(s))
- `stubGlobal` (43 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/site/lib/commercial.ts` (42 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/frontends/ops/src/features/counter/CounterWorkspace.tsx::TabWorkspaceSession` (39 edge(s))
