# Onda 2R antecipada — observabilidade e carga (Tasks 36 e 39)

Base deliberadamente estável: `c899c4805f999eda18b22cbb8f7d8ebe30603333`. O integrador resolverá apenas imports/AppModule após a Onda 1.

## Task 36

- Instrumentação OpenTelemetry em API e worker com interfaces no Ops.
- Redação fail-closed de tokens, cookies, e-mail/telefone/documentos, PIN, chaves, PAN/CVV/track e payloads arbitrários.
- Budgets de cardinalidade; tenant/unit/device como atributos controlados, nunca identificadores livres de cliente/tabela/comanda.
- Métricas, logs, traces, dashboards/alerts versionados em `infra/observability/` e runbook com owners, SLOs e synthetic checks.
- Vendor-neutral; nenhum endpoint/secret/provider real obrigatório.

## Task 39

- k6 para operação, QR público e multitenancy; 500 mesas, 50 terminais, 2.000 QR/unidade, múltiplos tenants e 2x target.
- Seeds/IDs vêm de env/fixtures seguras; nenhum secret no script/log.
- Thresholds explícitos de erro/latência/isolamento; smoke local leve executável, spike/soak documentados sem fingir execução pesada.
- Runbook define hardware, duração, dados, abort gates e leitura de resultado.

## Processo otimizado

- TDD/gates focados e commit separado por task.
- Não alterar schema/migrations, PWA, salão, financeiro, DoseClub ou deploy.
- Não adicionar dependência se SDK já existir; se lockfile for necessário, justificar e testar supply chain.
- Gate final: API/worker testes focados + typecheck/build, redaction/cardinality, validação sintática k6 ou container local se disponível, Biome/diff.
- Relatório `.superpowers/wave2-reliability-report.md`; worktree limpa, sem push/deploy/provider.
