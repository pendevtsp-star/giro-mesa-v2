# Onda 2B — relatório de backoffice seguro

Data: 2026-08-11  
Branch: `codex/giromesa-wave2-backoffice`  
Base confirmada: `c899c4805f999eda18b22cbb8f7d8ebe30603333`

## Resultado

A Onda 2B implementa as Tasks 33–34 sem migration nova, provider, DoseClub, observabilidade, demo, push ou deploy.

Commits recuperáveis:

- `eac17ab` — `feat(platform): add secure tenant-scoped backoffice APIs`
- `348ef25` — `feat(ops): add actionable platform backoffice`
- `8e027d6` — `fix(platform): order action ledger by version`

## Task 33 — APIs administrativas seguras

- Acesso platform fail-closed: allowlist exata, grants explícitos e leitura como padrão.
- Step-up derivado apenas de `auth.mfa_verified` da sessão corrente, com janela máxima de dez minutos.
- Contexto obrigatório por UUID exato; não existe endpoint de enumeração de tenants.
- Projections limitadas e paginadas para tenant, plano, entitlements, usuários, onboarding, billing, integrações e audit.
- E-mail de usuário é mascarado sem `platform.pii.read`; configuração e referências de credencial de integrações nunca retornam.
- Leads, suporte e incidentes, ausentes na base `c899`, usam adapters explícitos `unavailable` e retornam lista vazia, nunca sucesso fabricado.
- Ações críticas cobertas: suspender/restaurar tenant e desativar/restaurar membership.
- Proposta, aprovação, rejeição, execução e falha são persistidas no `audit_events` append-only existente.
- Dual-control impede autoaprovação, valida expiração e versão CAS, aplica idempotência por hash/fingerprint e protege último owner/self-membership.
- Advisory locks transacionais serializam proposta e decisão. O efeito e o evento de execução ficam na mesma transação.
- A reconstrução do ledger ordena pela versão explícita do evento, não pelo timestamp transacional. Isso elimina inversão não determinística quando `approved` e `executed` compartilham o mesmo `now()` do PostgreSQL.
- OpenAPI publica schemas de request/response e headers de idempotência. Clientes TypeScript e C# foram regenerados.

Não foi necessária a migration reservada `0024`.

## Task 34 — Ops acionável

- Command bar e contexto permanente mostram ambiente, modo leitura, tenant, unidade, estado e validade do step-up.
- Recursos são carregados somente após UUID exato e renderizados por allowlist de campos.
- Estados de loading, vazio, indisponível e erro são distintos; indisponibilidade afirma que nenhum dado/sucesso foi simulado.
- Formulário crítico mostra impacto, exige justificativa e confirmação e fica desabilitado sem grants e MFA recente.
- Fila mostra `pending`, `approved`, `executed`, `rejected`, `expired` e `failed`; autoaprovação fica desabilitada no cliente e é novamente negada na API.
- Recuperação é explícita para 401, 403, 409, 429 e 5xx.
- Layout desktop/tablet preserva densidade, teclado, touch targets, foco visível e `prefers-reduced-motion`.

## TDD e gates

RED observado:

- Task 33: imports/módulos de access, actions e projections ainda ausentes.
- Task 34: 10 falhas esperadas por métodos da API e parsers ainda ausentes.
- Gate concorrente: `PLATFORM_ACTION_LEDGER_CORRUPT` reproduzido quando eventos v2/v3 tinham o mesmo timestamp e UUID definia a ordem.

GREEN final:

- API unit/contract/projections/PostgreSQL: 14/14.
- Repetição focada do cenário concorrente PostgreSQL: 5/5 execuções verdes.
- Ops Vitest (`platform.test.ts` + `api.test.ts`): 12/12.
- Turbo `typecheck` + `build`, escopo API/Ops/contracts e dependências: 11/11 tasks.
- Playwright desktop + tablet: 4/4, incluindo dual-control e autoaprovação negada.
- Axe no workspace do backoffice: zero violações.
- Supply-chain: 11/11.
- Biome focado: zero erros; 20 warnings no stylesheet compartilhado. O conjunto inclui `!important` preexistente e avisos de ordem de especificidade entre o bloco novo escopado e seletores globais existentes.
- `git diff --check`: verde.
- OpenAPI, cliente TypeScript e cliente C#: geração concluída. A primeira tentativa de OpenAPI, sem env local, falhou de forma segura em `DATABASE_URL is required`; a geração final usou somente o banco descartável.
- Build do cliente C# não foi executado porque `dotnet` não está instalado no host; Kiota concluiu a geração. Os avisos Kiota sobre formatos email/URI e error types do Sync já pertencem ao contrato geral.

Banco de teste: `giromesa_wave2b_test` foi criado somente no PostgreSQL local, recebeu as migrations existentes até `0016`, usado no gate e removido ao final (`DROP DATABASE`).

## QA visual e detector

Screenshots de fixture contratual (não sessão/provider real):

- `.superpowers/screenshots/wave2-backoffice-desktop.png`
- `.superpowers/screenshots/wave2-backoffice-tablet.png`

O detector Impeccable foi executado exatamente uma vez após a UI. Ele apontou o novo `border-left: 5px` e quatro ocorrências `side-tab` mais um grid decorativo já existentes no stylesheet compartilhado. O novo apontamento foi corrigido para um inset superior discreto; o detector não foi reexecutado para respeitar o limite de uma execução. Não há finding novo conhecido remanescente.

## Limites e concerns

- A base não possui role PostgreSQL exclusiva para suporte platform. O serviço usa a conexão existente e aplica escopo exato em cada query/efeito; o gate PostgreSQL prova negação cross-tenant. Criar uma role least-privilege dedicada é hardening de integração futura.
- Leads, suporte e incidentes precisam ser ligados às entidades/adapters das Ondas 1B/1C quando elas existirem. Até lá, permanecem explicitamente indisponíveis.
- QA visual usou interceptação Playwright apenas para exercitar o contrato da UI. Autorização, isolamento, concorrência e exactly-once foram validados separadamente contra PostgreSQL real descartável.
- Nenhuma sessão externa, provider real, push ou deploy foi realizado.
