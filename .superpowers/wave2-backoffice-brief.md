# Onda 2B antecipada — backoffice seguro (Tasks 33–34)

Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`. A integração posterior conectará entidades adicionadas pelas Ondas 1B/1C; não fabrique dados ausentes.

## Task 33

- APIs administrativas para leads, tenant, plano, entitlements, usuários, suspensão, onboarding, billing, suporte, integrações, incidentes e audit.
- Read-only por padrão; cada mutação exige permissão platform explícita, MFA/step-up recente, justificativa, idempotência e audit before/after.
- Ações críticas usam proposta/aprovação dual-control: solicitante não aprova a própria ação, expiração/CAS, exactly-once e rollback/compensação quando aplicável.
- Tenant context obrigatório; nenhuma enumeração cross-tenant ou PII desnecessária.
- Respostas públicas tipadas, paginadas e sanitizadas; segredo nunca retorna.

## Task 34

- UI acionável no Ops: contexto de tenant permanente, modo leitura claro, impacto/justificativa/approvals/audit, estados pending/approved/executed/rejected/expired/failed.
- Não renderizar botões habilitados sem autorização/step-up; 401/403/409/429/5xx recuperáveis.
- Impeccable Operate: alta densidade legível, sem emojis, teclado/touch/reduced motion, desktop/tablet.

## Limites e integração

- Use adapters/projections para domínios ainda ausentes; quando uma entidade Wave1 não existir nesta base, compile o contrato sem criar fake success e documente o wiring pendente.
- Sem schema/migration nova salvo prova inevitável; se dual-control precisar persistência, reservar `0024` mas parar e avisar antes de gerar para evitar conflito.
- Sem providers, deploy, DoseClub, observabilidade ou demo.

## Processo

- TDD; commit por task; gates focados API/PG/RBAC/concurrency e Ops/Playwright/Axe.
- OpenAPI/clientes uma vez no fechamento.
- Relatório `.superpowers/wave2-backoffice-report.md`, Biome/diff, worktree limpa, sem push/deploy.
