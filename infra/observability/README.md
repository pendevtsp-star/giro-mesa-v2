# Observabilidade GiroMesa

Este diretório contém contratos vendor-neutral para receber e encaminhar OTLP, além de budgets, dashboards, alertas e checks sintéticos versionados.

## Princípios

- A aplicação só emite atributos da allowlist implementada em `@giromesa/observability`.
- Identificadores de organização, unidade e dispositivo passam por budgets por processo.
- IDs de cliente, mesa, comanda e payloads livres nunca viram dimensões.
- O Collector remove novamente nomes sensíveis conhecidos antes de exportar traces e logs.
- Nenhum endpoint, header ou segredo de fornecedor é mantido no repositório.

## Ativação

O processo deve inicializar um SDK OpenTelemetry antes da aplicação e registrar o provider global consumido por `@opentelemetry/api`. O deploy fornece `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` e, quando necessário, `OTEL_EXPORTER_OTLP_HEADERS` por secret reference.

O arquivo `otel-collector.yaml` encaminha OTLP para um endpoint configurado no ambiente. Sem endpoint válido, a observabilidade externa permanece deliberadamente não configurada; a aplicação não inventa um backend.

Arquivos:

- `cardinality-budgets.json`: limites aprovados por dimensão.
- `dashboards/operations-overview.json`: painéis e consultas lógicas, independentes de fornecedor.
- `alerts/slo-alerts.yaml`: condições, severidade, owner e runbook.
- `synthetics/checks.yaml`: checks sem credenciais embutidas.
