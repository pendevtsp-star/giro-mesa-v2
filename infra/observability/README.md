# Observabilidade GiroMesa

Este diretório contém contratos vendor-neutral para receber e encaminhar OTLP, além de budgets, dashboards, alertas e checks sintéticos versionados.

## Princípios

- A aplicação só emite atributos da allowlist implementada em `@giromesa/observability`.
- Identificadores de organização, unidade e dispositivo passam por budgets por processo.
- IDs de cliente, mesa, comanda e payloads livres nunca viram dimensões.
- O Collector remove novamente nomes sensíveis conhecidos antes de exportar traces e logs.
- Nenhum endpoint, header ou segredo de fornecedor é mantido no repositório.

## Ativação

API e worker inicializam o NodeSDK antes de importar a aplicação e registram providers globais de traces, metrics e logs. O ambiente deve fornecer `OTEL_EXPORTER_OTLP_ENDPOINT` (ou os três endpoints por sinal) e, quando necessário, `OTEL_EXPORTER_OTLP_HEADERS` por secret reference. HTTP exige `OTEL_EXPORTER_OTLP_INSECURE=true`; o único protocolo aceito é `http/protobuf`. Service names são fixos (`giromesa.api` e `giromesa.worker`) e o recurso usa `service.version` e `deployment.environment.name`.

O arquivo `otel-collector.yaml` encaminha OTLP para um endpoint configurado no ambiente. Sem endpoint válido, a observabilidade externa permanece deliberadamente não configurada; a aplicação não inventa um backend.

Para diagnóstico local ou durante o piloto, `deploy/vps/compose.observability.yaml` oferece um Collector fixado por digest que usa somente o exporter `debug`. Esse overlay não possui porta pública nem armazenamento durável e, portanto, não atende retenção, alertas ou auditoria de produção. Um backend externo aprovado continua obrigatório para observabilidade operacional.

Arquivos:

- `cardinality-budgets.json`: limites aprovados por dimensão.
- `dashboards/operations-overview.json`: painéis e consultas lógicas, independentes de fornecedor.
- `alerts/slo-alerts.yaml`: condições, severidade, owner e runbook.
- `synthetics/checks.yaml`: checks sem credenciais embutidas.
