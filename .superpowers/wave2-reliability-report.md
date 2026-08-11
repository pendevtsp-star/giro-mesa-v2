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
| Fix 36 | `721ae32` | Redaction normalizada em profundidade e Collector fail-closed nos três sinais |
| Fix 36 | `f73e19a` | Interceptor HTTP global e boundary real do dispatch de worker |
| Fix 39 | `0a88052` | Mesas exclusivas no spike e thresholds com abort automático |
| Fix 36 | `e802ecd` | NodeSDK vendor-neutral, exporters OTLP e configuração fail-closed |
| Fix 36 | `ac17f8f` | SDK antes dos entrypoints, lifecycle real e semântica HTTP 4xx |
| Fix 36 | `b7a376a` | Recursos OTel padronizados e prova OTLP HTTP dos três sinais |
| Fix 36 | `79c01bb` | Shutdown garantido mesmo se o force flush falhar |
| Fix 36 | `393804b` | Dono único de sinais, cleanup de bootstrap e nomes de sinais com allowlist finita |

O commit documental posterior registra este relatório e o brief recebido. Os commits de produto permanecem recuperáveis separadamente.

## Correções pós-revisão independente

- RED redaction: valores `pin_`, `cvv_`, `cpf_`, `cookie_` e `phone_` atravessavam atributos permitidos; o teste novo falhou preservando quatro dos seis casos antes do fix.
- RED runtime: o teste de boot não compilava porque o módulo ainda não oferecia backend injetável nem interceptor; o worker não possuía boundary ligado ao dispatch real.
- RED carga: VUs locais 1 e 51 escolhiam a mesma mesa, iterações não tinham estado próprio e os thresholds eram strings sem `abortOnFail`.
- RED SDK: os probes dinâmicos encontraram `ProxyTracerProvider`, `NoopMeterProvider` e `NonRecordingSpan`; API e worker não inicializavam providers/exporters.
- RED HTTP: `BadRequestException(400)` era emitida como `outcome=error`, `HTTP_REQUEST_FAILED` e log de erro de servidor.
- RED recurso: `service.version` e `deployment.environment.name` eram descartados pela allowlist/Collector.
- RED lifecycle: `enableShutdownHooks()` do Nest concorria com o dono de `SIGINT`/`SIGTERM` do runtime, podendo fechar a aplicação duas vezes e encerrar antes do flush; falhas posteriores a `createApplication()` também não fechavam a aplicação.
- RED nomes: nomes arbitrários como `pin_1234`, `cpf_12345678901`, UUIDs e mil dimensões dinâmicas alcançavam o backend e seus caches de instrumentos.
- GREEN: os findings foram cobertos pelos commits de fix acima e pelos gates consolidados deste relatório.

## Task 36 — observabilidade

### RED

- API: o teste falhou com `ERR_MODULE_NOT_FOUND` para `@giromesa/observability`.
- Worker: o teste falhou porque `src/observability.js` ainda não existia.
- Casos adicionais reproduziram rota com UUID livre e token com prefixo conhecido passando pela sanitização antes das correções.

### GREEN

- Runtime OTel: 4/4, incluindo memory exporters e receptor OTLP HTTP local para traces, metrics e logs.
- API redaction/cardinality, boundary HTTP e lifecycle: 16/16.
- Worker signals, dispatch real e lifecycle: 8/8.
- O pacote `@giromesa/observability` inicializa `NodeSDK` com providers reais e exporters OTLP HTTP, sem exporter/provider proprietário.
- API usa `service.name=giromesa.api`; worker usa `service.name=giromesa.worker`. Ambos publicam `service.version` e `deployment.environment.name` como recursos limitados.
- `OTEL_EXPORTER_OTLP_ENDPOINT` ou os três endpoints por sinal são obrigatórios. Protocolo, URLs, headers, timeouts, intervalo de métricas, sampler, service name e transporte inseguro são validados antes de importar a aplicação.
- Headers aceitam apenas nomes válidos e valores sem CR/LF/NUL; falhas citam somente o nome da variável, nunca o valor secreto.
- API e worker inicializam a telemetria antes do bootstrap por import dinâmico. SIGINT/SIGTERM, falha de bootstrap e término do loop fecham o serviço, fazem force flush e shutdown idempotente.
- O runtime da API é o único dono de `SIGINT`/`SIGTERM`; `app.close()` continua executando os lifecycle hooks do Nest sem registrar um segundo listener de processo. Um subprocesso com aplicação Nest real provou `close -> forceFlush -> shutdown` exatamente uma vez antes da saída, inclusive com force flush falhando.
- Validação de porta e falha de `listen()` depois da criação da aplicação executam `app.close()`, force flush e shutdown em sequência. Cada etapa é tentada mesmo quando uma anterior falha, preservando a falha original quando o cleanup termina corretamente.
- HTTP 4xx usa `outcome=client_rejected`, sem `HTTP_REQUEST_FAILED`, `error.type` ou log de erro de servidor; throws/5xx continuam `outcome=error`.
- A allowlist aceita somente dimensões operacionais conhecidas; payloads, cookies, tokens, e-mail, telefone, documento, PIN, chaves, PAN/CVV/track e IDs livres são descartados ou redigidos. Prefixos sensíveis são normalizados com NFKC e detectados sem confundir nomes operacionais como `phonebook-sync`, `cookie_missing` ou `TOKEN_EXPIRED`.
- Organização, unidade, dispositivo, rota, job e erros usam budgets por processo; excesso colapsa em `__overflow__` sem reter cardinalidade ilimitada.
- Nomes de span, métrica e log usam uma allowlist finita dos sinais de produção. Nomes desconhecidos ou sensíveis são descartados antes de alcançar exporters ou os mapas de instrumentos do backend.
- Logs estruturados recebem apenas atributos sanitizados. Exceções de worker registram tipo e código estático, nunca a mensagem arbitrária.
- Ops recebeu somente interfaces de snapshot/alerta/synthetic, sem UI ou dado falso.
- O interceptor HTTP global registra duração, status, outcome e erro sanitizado em toda rota Nest; o worker envolve o dispatch real da outbox. Ambos recebem um `TelemetryBackend` vendor-neutral explícito e testável.
- Collector OTLP, budgets, dashboard lógico, alertas e synthetics foram versionados em `infra/observability/`. Redaction fail-closed e remoção por padrões de dimensões livres são aplicadas a traces, metrics e logs.
- O runbook define SLO 99,95%, owners por rotação, severidades, resposta a dado sensível e checks sintéticos.

### Supply chain

O SDK não existia como dependência direta. Foram adicionados somente pacotes oficiais OpenTelemetry para NodeSDK, recursos, logs, métricas, traces e exporters OTLP HTTP, todos pinados e vendor-neutral. API e worker continuam usando a dependência workspace. O build opcional de `protobufjs` permanece explicitamente negado no workspace; o runtime HTTP/protobuf e `pnpm supply-chain:check` passaram.

Configuração ausente ou inválida impede o boot antes de criar a aplicação/worker. Os executáveis reais foram testados em subprocesso e retornam exit 1 com mensagem genérica, sem imprimir headers ou segredos.

## Task 39 — carga e soak

### RED

- O teste inicial falhou pela ausência de `load/lib/config.js`.
- Os testes de jornada falharam pela ausência de `load/lib/journeys.js`.
- REDs adicionais cobriram seleção de todos os terminais por tenant, fixture path traversal, compatibilidade sem a global `URL`, abertura única por mesa e distribuição local de VUs.
- O primeiro `k6 inspect` encontrou o default `load/load/fixtures`; a correção passou a resolver somente JSON dentro de `./fixtures`.

### GREEN

- Contratos e jornadas Node: 12/12.
- `grafana/k6:1.8.0 inspect` passou nos três entrypoints:
  - `load/k6-operational.js`;
  - `load/k6-public-qr.js`;
  - `load/k6-multitenant.js`.
- `node --check` passou nos entrypoints e runtime compartilhado.
- Fixture JSON parseou com sucesso; campos desconhecidos são rejeitados e cookies só são lidos por nomes de variáveis de ambiente.
- Tags métricas ficam limitadas a `name` e `kind`; nenhum ID de tenant, unidade, dispositivo, mesa ou comanda vira tag.
- O profile `target` exige por unidade 500 mesas, 50 terminais e 2.000 sessões QR. `spike` chega a 2x; `soak` mantém o alvo por 2 h.
- Thresholds: erro abaixo de 0,1%, checks acima de 99,9%, p95 leitura abaixo de 300 ms, escrita abaixo de 500 ms e `isolation_breach == 0`.
- Cada VU operacional mantém estado próprio e recebe mesa exclusiva pelo índice local; VUs 1 e 51 usam mesas diferentes, e iterações posteriores não repetem `tab.open`. Status 409 continua reprovando fixture suja.
- O probe negativo usa a sessão do tenant próprio contra escopo estrangeiro e só aceita 403/404.
- Todos os thresholds usam `abortOnFail`: isolamento sem atraso, erro/checks após 30 s e latência após 1 min.

## Gate consolidado

- Testes focados: observability 6/6, lifecycle da API 9/9, worker 8/8 e load 12/12.
- Regressão ampla: API 155 total (113 aprovados, 42 skips explícitos por banco ausente) e worker 24 total (21 aprovados, 3 skips explícitos por banco ausente), sem falhas.
- Typecheck forçado de observability, API, worker e dependências: 10/10 tasks, sem cache.
- Turbo `typecheck` + `build`: 15/15 tasks para API, worker, Ops, observability e dependências.
- Build Ops/Vite: `459,44 kB`, gzip `129,77 kB` no chunk principal.
- Biome focado: pacote observability, arquivos alterados de API/worker e `infra/observability` + `load/` sem findings.
- JSON: budgets, dashboard e fixture válidos.
- YAML: Collector, alerts e synthetics válidos via PyYAML 6.0.3; Collector validado também pelo comando `validate` da imagem oficial `otel/opentelemetry-collector-contrib:0.157.0`.
- Supply chain: aprovado.
- k6 oficial pinado: 3/3 `inspect` aprovados.
- `git diff --check c899c48..HEAD`: aprovado.
- Auditoria de paths confirmou ausência de schema, migrations, PWA, salão, financeiro, DoseClub e deploy.

## Limites e concerns

- O SDK/provider passa a ser inicializado pelos próprios entrypoints. Ainda assim, sem endpoint OTLP válido o boot falha por desenho e nenhum monitoramento externo é declarado ativo neste trabalho.
- Um receptor OTLP HTTP local confirmou payloads dos três sinais e a imagem oficial confirmou a configuração do Collector; não houve conexão com upstream/provider real.
- `k6 inspect` valida parse, imports e opções; não faz request. Não houve API local com duas sessões/fixtures reais disponível para executar o smoke HTTP.
- `target`, `spike` e `soak` foram modelados e documentados, mas não executados. Nenhum resultado pesado é alegado.
- O exemplo de fixture contém UUIDs deliberadamente não produtivos e precisa ser substituído por IDs de seed local descartável.
- Cookies de carga ainda vêm de variáveis de ambiente por contrato do brief. Eles não são logados; um executor futuro pode adotar `k6/secrets` sem mudar a fixture.
- Nenhum provider, segredo, push, deploy ou prontidão de produção foi declarado.
- Não houve mudança visual; screenshots não se aplicam a esta correção de runtime.

## Referências técnicas

- OpenTelemetry JavaScript: `https://opentelemetry.io/docs/languages/js/instrumentation/`
- Limites de atributos OTel: `https://opentelemetry.io/docs/specs/otel/common/`
- k6 expected statuses: `https://grafana.com/docs/k6/latest/javascript-api/k6-http/expected-statuses/`
- k6 secret sources: `https://grafana.com/docs/k6/latest/using-k6/secret-source/`
