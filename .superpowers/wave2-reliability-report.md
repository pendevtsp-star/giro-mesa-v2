# Relatório de entrega — Onda 2R Reliability

Data: 2026-08-11

Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`

Branch: `codex/giromesa-wave2-reliability`

Escopo: Tasks 36 e 39 antecipadas, sem integração com providers ou deploy.

## Commits

| Task | Commit | Entrega |
| --- | --- | --- |
| 36 | `259ca2b` | Observabilidade vendor-neutral, redaction fail-closed, budgets, contratos Ops, infra e runbook |
| 39 | `6c65a5d` | Harness k6 de operação, QR público e multitenancy, fixtures seguras e runbook de gates |

O commit documental posterior registra este relatório e o brief recebido. Os commits de produto permanecem recuperáveis separadamente.

## Task 36 — observabilidade

### RED

- API: o teste falhou com `ERR_MODULE_NOT_FOUND` para `@giromesa/observability`.
- Worker: o teste falhou porque `src/observability.js` ainda não existia.
- Casos adicionais reproduziram rota com UUID livre e token com prefixo conhecido passando pela sanitização antes das correções.

### GREEN

- API redaction/cardinality: 5/5.
- Worker signals: 2/2.
- O pacote `@giromesa/observability` usa `@opentelemetry/api@1.9.0`, sem exporter/provider proprietário.
- A allowlist aceita somente dimensões operacionais conhecidas; payloads, cookies, tokens, e-mail, telefone, documento, PIN, chaves, PAN/CVV/track e IDs livres são descartados ou redigidos.
- Organização, unidade, dispositivo, rota, job e erros usam budgets por processo; excesso colapsa em `__overflow__` sem reter cardinalidade ilimitada.
- Logs estruturados recebem apenas atributos sanitizados. Exceções de worker registram tipo e código estático, nunca a mensagem arbitrária.
- Ops recebeu somente interfaces de snapshot/alerta/synthetic, sem UI ou dado falso.
- Collector OTLP, budgets, dashboard lógico, alertas e synthetics foram versionados em `infra/observability/`.
- O runbook define SLO 99,95%, owners por rotação, severidades, resposta a dado sensível e checks sintéticos.

### Supply chain

O SDK não existia como dependência direta. Foi adicionado apenas `@opentelemetry/api@1.9.0` ao novo pacote compartilhado; API e worker usam dependência workspace. O lockfile mudou para resolver esse peer opcional também em pacotes já presentes. `pnpm supply-chain:check` passou.

O código de instrumentação consome o provider global da API OTel. Sem SDK inicializado antes da aplicação, o comportamento é deliberadamente no-op; endpoint, headers e exporter reais permanecem responsabilidade do ambiente de integração.

## Task 39 — carga e soak

### RED

- O teste inicial falhou pela ausência de `load/lib/config.js`.
- Os testes de jornada falharam pela ausência de `load/lib/journeys.js`.
- REDs adicionais cobriram seleção de todos os terminais por tenant, fixture path traversal, compatibilidade sem a global `URL`, abertura única por mesa e distribuição local de VUs.
- O primeiro `k6 inspect` encontrou o default `load/load/fixtures`; a correção passou a resolver somente JSON dentro de `./fixtures`.

### GREEN

- Contratos e jornadas Node: 11/11.
- `grafana/k6:1.8.0 inspect` passou nos três entrypoints:
  - `load/k6-operational.js`;
  - `load/k6-public-qr.js`;
  - `load/k6-multitenant.js`.
- `node --check` passou nos entrypoints e runtime compartilhado.
- Fixture JSON parseou com sucesso; campos desconhecidos são rejeitados e cookies só são lidos por nomes de variáveis de ambiente.
- Tags métricas ficam limitadas a `name` e `kind`; nenhum ID de tenant, unidade, dispositivo, mesa ou comanda vira tag.
- O profile `target` exige por unidade 500 mesas, 50 terminais e 2.000 sessões QR. `spike` chega a 2x; `soak` mantém o alvo por 2 h.
- Thresholds: erro abaixo de 0,1%, checks acima de 99,9%, p95 leitura abaixo de 300 ms, escrita abaixo de 500 ms e `isolation_breach == 0`.
- A jornada abre cada mesa uma única vez; 409 reprova fixture suja em vez de produzir uma falsa escrita rápida.
- O probe negativo usa a sessão do tenant próprio contra escopo estrangeiro e só aceita 403/404.

## Gate consolidado

- Testes focados: API 5/5, worker 2/2, load 11/11.
- Turbo `typecheck` + `build`: 15/15 tasks para API, worker, Ops, observability e dependências.
- Build Ops/Vite: `459,44 kB`, gzip `129,77 kB` no chunk principal.
- Biome focado: pacote observability, API, worker, Ops e `load/` sem findings.
- JSON: budgets, dashboard e fixture válidos.
- YAML: Collector, alerts e synthetics válidos via PyYAML 6.0.3.
- Supply chain: aprovado.
- k6 oficial pinado: 3/3 `inspect` aprovados.
- `git diff --check c899c48..HEAD`: aprovado.
- Auditoria de paths confirmou ausência de schema, migrations, PWA, salão, financeiro, DoseClub e deploy.

## Limites e concerns

- O SDK/provider global OTel e imports de runtime não foram ligados nesta branch antecipada. Até a integração, as chamadas da API OTel são no-op e nenhum monitoramento externo está ativo.
- O Collector foi validado sintaticamente como YAML, não inicializado contra exporter/endpoint real.
- `k6 inspect` valida parse, imports e opções; não faz request. Não houve API local com duas sessões/fixtures reais disponível para executar o smoke HTTP.
- `target`, `spike` e `soak` foram modelados e documentados, mas não executados. Nenhum resultado pesado é alegado.
- O exemplo de fixture contém UUIDs deliberadamente não produtivos e precisa ser substituído por IDs de seed local descartável.
- Cookies de carga ainda vêm de variáveis de ambiente por contrato do brief. Eles não são logados; um executor futuro pode adotar `k6/secrets` sem mudar a fixture.
- Nenhum provider, segredo, push, deploy ou prontidão de produção foi declarado.

## Referências técnicas

- OpenTelemetry JavaScript: `https://opentelemetry.io/docs/languages/js/instrumentation/`
- Limites de atributos OTel: `https://opentelemetry.io/docs/specs/otel/common/`
- k6 expected statuses: `https://grafana.com/docs/k6/latest/javascript-api/k6-http/expected-statuses/`
- k6 secret sources: `https://grafana.com/docs/k6/latest/using-k6/secret-source/`
