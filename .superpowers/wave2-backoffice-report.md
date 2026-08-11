# Onda 2B — relatório de backoffice seguro

Data: 2026-08-11  
Branch: `codex/giromesa-wave2-backoffice`  
Base confirmada: `c899c4805f999eda18b22cbb8f7d8ebe30603333`

## Resultado

As Tasks 33–34 e os achados da revisão cruzada foram concluídos sem provider, DoseClub, observabilidade, sessão externa, push ou deploy.

Commits recuperáveis:

- `eac17ab` — `feat(platform): add secure tenant-scoped backoffice APIs`
- `348ef25` — `feat(ops): add actionable platform backoffice`
- `8e027d6` — `fix(platform): order action ledger by version`
- `37a4b1d` — `docs(backoffice): record wave 2B evidence`
- `08a4859` — `fix(platform): harden cross-tenant admin actions`
- `5a567c1` — `fix(platform): publish typed projection contracts`
- `d6ea5a5` — `fix(ops): complete platform tab accessibility`

## Segurança e banco

- A migration reservada `0024_platform_backoffice_rls` cria `giromesa_platform` como role `NOLOGIN`, `NOSUPERUSER`, `NOINHERIT` e `NOBYPASSRLS`, com grants apenas por coluna e policies de organização exata.
- O contexto HTTP platform entra em transação dedicada somente depois de `SessionGuard` e `PlatformAdminGuard`, registra ator/sessão/organização e nunca depende de membership tenant.
- O overview cross-tenant retorna somente contagens por função `SECURITY DEFINER`; o owner `giromesa_migrator` recebe somente `SELECT (id, billing_state)`.
- Mutações continuam exigindo grant platform explícito e step-up recente no serviço antes de qualquer efeito.
- O lock organizacional serializa alterações de membership; a contagem de owners é revalidada dentro do lock, impedindo duas desativações concorrentes do último owner.
- Erros de domínio são allowlisted e sanitizados como 400, 403, 409 ou 410. Erros desconhecidos retornam 503 genérico, sem detalhes internos.
- O ledger aceita somente `pending -> approved -> executed`; aprovação exige ator diferente do solicitante e execução exige o mesmo aprovador. Ação/status divergentes e sequências adulteradas falham fechadas.
- A chave idempotente de decisão fica vinculada ao fingerprint de organização, proposta, comando e corpo (`expectedVersion`); reuso divergente retorna 409.
- Proposta, decisão, efeito e auditoria permanecem transacionais, append-only e ordenados por versão explícita.

## Contratos e clientes

- As 11 projeções são um `oneOf` discriminado por `resource`, com DTO próprio e `additionalProperties: false`.
- Tenant, plano, entitlements, usuários, onboarding, billing, integrações e audit têm itens concretos. Leads, suporte e incidentes continuam `unavailable`, com lista obrigatoriamente vazia e sem sucesso sintético.
- OpenAPI e cliente TypeScript foram regenerados sem `Record<string, never>[]` nas projeções.
- O cliente C# foi regenerado por Kiota e compilado com .NET 10: 0 erros e 0 avisos.

## Ops e acessibilidade

- Tabs usam roving tabindex, `aria-controls`, ids estáveis, `tabpanel`/`aria-labelledby` e navegação ArrowLeft/ArrowRight/Home/End.
- Axe cobre o `.app-shell` inteiro. O contraste do rodapé da sidebar foi ajustado após o novo escopo revelar a violação.
- A captura visual espera fontes, imagens e dois frames de layout, volta ao topo sem sleep arbitrário e verifica que shell/command bar estão dentro do viewport.
- Desktop e tablet preservam topo, shell, contexto tenant, indisponibilidade verdadeira e controles de dual-control.

## TDD e gates

RED observado:

- HTTP real retornava 500 sem membership platform e payload inválido vazava para o handler genérico.
- Duas desativações concorrentes removiam os dois owners; reuso divergente da mesma chave de decisão não era rejeitado.
- O ledger aceitava execução sem aprovação independente e ação/status incompatíveis.
- OpenAPI/TS/C# descreviam `items` como objeto vazio.
- Tabs não tinham relação tab/panel, foco roving nem navegação por teclado.
- Axe ampliado ao shell encontrou contraste insuficiente no rodapé da sidebar.

GREEN final:

- PostgreSQL 17 upgrade: platform actions 3/3 e HTTP real 2/2, incluindo aliases `/v1` e `/api/v1`, RLS sem membership, corrida de owners e erros 400/403/409/410.
- PostgreSQL 16 fresh: migration completa e os mesmos gates focados 5/5.
- API completa: 155 testes, 0 falhas; contratos/projeções gerados 2/2.
- Ops Vitest: 58/58.
- Playwright desktop + tablet: 4/4; Axe no shell inteiro sem violações.
- Turbo `typecheck`, `test` e `build`: 15/15 tasks no escopo API/Ops/contracts/db.
- OpenAPI, TypeScript, Kiota C# e build .NET 10 concluídos.
- Biome focado de TS/TSX/E2E: zero erros. O stylesheet compartilhado mantém 20 warnings preexistentes (`!important` e ordem de especificidade), sem erro relacionado ao patch.
- `git diff --check`: verde.

Screenshots inspecionados:

- `.superpowers/screenshots/wave2-backoffice-desktop.png`
- `.superpowers/screenshots/wave2-backoffice-tablet.png`

## Limites e concerns

- O login da aplicação precisa receber membership na role `giromesa_platform` durante provisioning operacional; a migration não presume o nome da role de login e não executa deploy.
- Leads, suporte e incidentes dependem dos adapters reais das ondas correspondentes e permanecem explicitamente indisponíveis.
- QA visual usa fixture HTTP somente para exercitar a UI; autorização, RLS, concorrência e exactly-once foram verificados separadamente em PostgreSQL real descartável.
- Os avisos Kiota sobre formatos email/URI e error types do Sync são preexistentes e fora do contrato platform.
- Nenhum provider, sessão externa, push ou deploy foi executado.
