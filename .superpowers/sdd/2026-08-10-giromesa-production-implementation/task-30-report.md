# Task 30 — receiver GiroMesa para DoseClub

## Resultado

Implementado o receiver transacional V1/V2 do DoseClub nos dois aliases públicos. O fluxo cobre venda, reserva, consumo, reversão e reconciliação com idempotência estrita, versão contratual, estoque atômico, auditoria/outbox e isolamento por organização/unidade.

## Segurança e persistência

- Chaves de integração são comparadas por SHA-256 e nunca persistidas ou registradas em claro.
- O contexto usa `giromesa_internal` apenas para resolver o escopo e muda para `giromesa_app` com GUCs tenant antes de acessar os dados.
- As três tabelas novas usam `FORCE ROW LEVEL SECURITY`, grants mínimos e fatos operacionais imutáveis.
- Fingerprints canônicos impedem reutilização divergente da mesma chave de idempotência.
- Locks consultivos serializam a chave de idempotência e o clube; reversões V1 conferem consumo, produto e dose originais.
- Rate limit em duas camadas: 6.000/min por IP/bucket e 600/min por hash opaco da chave válida; chaves inválidas continuam limitadas por IP.

## Contratos

- Schemas runtime fechados e específicos para V1/V2.
- OpenAPI projeta somente as operações permitidas em cada endpoint, com resposta discriminada por `contractVersion`.
- Clientes TypeScript e C# foram regenerados; o cliente C# não contém request bodies não tipados nas rotas DoseClub.

## Evidências

- PostgreSQL 17 fresh, migrations 0000–0026: aprovado.
- Upgrade real 0000–0025 → 0026 preservando tenant e verificando RLS/grants: 1/1.
- Integração PostgreSQL/HTTP DoseClub: 9/9, incluindo aliases, V1/V2, replay, concorrência, reversão adversarial e RLS negativo.
- API: 209 testes, 144 aprovados, 65 integrações condicionais puladas, 0 falhas.
- DB: 3 aprovados, 6 integrações condicionais puladas, 0 falhas.
- Contracts: 9/9.
- Workspace typecheck: 14/14 tasks.
- Cliente C# Release: 0 avisos, 0 erros.
- Drizzle drift: nenhuma alteração adicional de schema.
- Biome focado e `git diff --check`: aprovados.

## Limites externos

Nenhum provider, segredo real, push, deploy ou homologação conjunta foi executado. A ativação em produção depende do provisionamento externo das chaves e da homologação do emissor DoseClub V2.
