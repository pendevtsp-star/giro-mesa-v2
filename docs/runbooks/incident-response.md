# Resposta a incidentes de confiabilidade

## Objetivos e responsáveis

| Sinal | Objetivo | Owner primário |
| --- | --- | --- |
| Disponibilidade da API | 99,95% mensal | `platform-oncall` |
| Leitura HTTP | p95 menor que 300 ms no alvo | `platform-oncall` |
| Escrita HTTP | p95 menor que 500 ms no alvo | `platform-oncall` |
| Erro HTTP e de jobs | menor que 0,1% no alvo | `platform-oncall` / `operations-oncall` |
| Checks sintéticos críticos | nenhuma sequência de 3 falhas | `operations-oncall` |
| Vazamento de dado em telemetria | zero | `security-oncall` |

Os nomes de owner representam rotações operacionais, não pessoas ou endereços fictícios. A ferramenta de incidentes deve mapear esses aliases para a escala vigente fora do repositório.

## Severidade e primeira resposta

- `sev1`: indisponibilidade, isolamento violado, perda operacional ou suspeita de dado sensível. Reconhecer em até 5 minutos, congelar mudanças e acionar `platform-oncall`; em suspeita de dado, incluir `security-oncall`.
- `sev2`: degradação sustentada de latência, erro ou worker. Reconhecer em até 15 minutos e proteger o fluxo crítico com redução de carga ou rollback aprovado.
- `sev3`: budget de cardinalidade, cobertura ou tendência sem impacto imediato. Triar no mesmo turno operacional.

Não colocar tokens, cookies, payloads, e-mail, telefone, documentos, PIN, chaves, PAN, CVV ou track data em tickets, chats, screenshots ou consultas salvas.

## Triagem comum

1. Confirmar ambiente, serviço e janela; não filtrar por cliente, mesa ou comanda.
2. Comparar métrica, trace e log pelo trace ID técnico, sem copiar payload.
3. Verificar saturação de CPU, memória, pool, fila e dependências.
4. Confirmar se houve mudança versionada e se o rollback é compatível.
5. Registrar impacto, horário, decisão, owner e evidência sanitizada.
6. Encerrar apenas após o sinal voltar ao objetivo e o synthetic crítico ficar verde por 15 minutos.

## API availability

Para burn rápido, congelar rollout, verificar health do banco e erros por rota template/status. Se a regressão coincidir com release, seguir rollback aprovado. HTTP 200 isolado não comprova recuperação: validar taxa de erro, p95 e synthetic.

## Latência

Separar leitura e escrita. Verificar saturação, conexões, locks, cache e backlog. Nunca adicionar ID livre como label durante a investigação. Se a causa for vizinho ruidoso, aplicar quota/backpressure já aprovada; não alterar isolamento manualmente.

## Worker

Comparar `giromesa.worker.jobs.completed`, `giromesa.worker.jobs.failed` e `giromesa.worker.job.duration` por `job.type`, organização e unidade dentro dos budgets. Pausar consumidor somente com owner e plano de drenagem; não apagar fila, inbox, outbox ou DLQ.

## Cardinalidade

Qualquer `telemetry.cardinality_overflow_count` exige identificar o instrumento e a dimensão controlada. Aumentar budget requer estimativa de tenants/unidades/dispositivos, custo e aprovação. Cliente, mesa, comanda, pedido e payload continuam proibidos, mesmo durante incidente.

## Synthetics

Os checks versionados ficam em `infra/observability/synthetics/checks.yaml`. `api-health` e `ops-shell` não usam credenciais. `public-menu` usa slug de fixture não sensível fornecido por ambiente. Três falhas consecutivas abrem `sev1`; uma resposta isolada não comprova toda a jornada.

## Suspeita de dado sensível

1. Interromper o exporter ou pipeline afetado sem destruir evidência.
2. Revogar/rotacionar o segredo potencialmente exposto fora dos logs.
3. Restringir acesso ao artefato e acionar `security-oncall`.
4. Investigar pela allowlist e pelo código de redaction, sem reproduzir o valor.
5. Definir retenção/eliminação com privacidade e registrar a decisão.

## Ativação e limites

O código usa a API OpenTelemetry e permanece no-op até que um SDK/provider global seja inicializado antes da aplicação. Collector, exporter e backend são configurados por ambiente; este repositório não contém endpoint nem segredo real. A presença destes arquivos não declara monitoramento de produção ativo nem substitui validação de staging, alert routing e exercícios operacionais.
