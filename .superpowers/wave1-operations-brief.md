# Onda 1B — núcleo operacional (Tasks 13–21)

Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`.

## Escopo e ordem

Implementar Tasks 13–21 do plano em commits separados, respeitando dependências:

1. Branding/menu draft-preview-version-publish e media recodificada/imutável.
2. Schema + máquina formal de ocupação.
3. APIs versionadas do mapa, publish imutável, praça, presença lease/ack e exceções.
4. Canvas operacional edit/operate acessível, zoom/drag, busca, filtros e painel completo.
5. Token QR por ocupação com nonce, capabilities, expiração/revogação/rate limit/epoch.
6. Chamados roteados e parcial somente da ocupação atual.
7. Dispatch ledger por destino, ack/reprint/cancel/contingência/DLQ/reconcile.
8. KDS de produção legível à distância, SLA/estação/undo/estado de dispositivo.
9. Edge Hub: mTLS, identidade, revogação, clone/rollback, disco/clock, backup/reinstalação e runbook.

Migrações reservadas nesta branch: `0017` branding, `0018` mapa/ocupação, `0019` dispatch. Não use números `0020+`. O integrador reconciliará journal com outras trilhas.

## Invariantes

- RLS/FORCE RLS e RBAC unit-scoped em todas as tabelas/endpoints.
- State machines com CAS/epoch/idempotência; sem booleanos soltos ou last-write-wins.
- QR nunca autoriza ocupação antiga; capabilities server-side e rate limit.
- Parcial não cruza ocupação/mesa/tenant.
- Dispatch exactly-once por efeito, at-least-once no transporte, ack/replay auditável.
- KDS/print/both coexistem; nenhuma impressão ou dispositivo fictício.
- Upload recodifica e valida MIME/bytes, quotas, tenancy e nomes imutáveis.
- Edge fail-closed, secrets hash/envelope, recuperação real e nenhuma PAN/CVV.

## UI

Use Impeccable para mapa/KDS: modo Operate, sem emojis, teclado/touch/reduced motion, estados offline/erro/vazio, QA desktop/tablet/POS/KDS em uma rodada batelada.

## Processo otimizado

- RED/GREEN + gate focado por task; commit por task.
- PostgreSQL descartável pode permanecer ativo na trilha, com database isolado por gate.
- Gere OpenAPI/TS/C# apenas no fechamento ou quando um gate contratual exigir.
- Gate da trilha: domain/API/PG fresh+upgrade+RLS negativo+concorrência, Ops Playwright focado, Edge .NET, Biome/diff.
- Relatório `.superpowers/wave1-operations-report.md`.
- Sem push/deploy/providers reais/Task 22+.
