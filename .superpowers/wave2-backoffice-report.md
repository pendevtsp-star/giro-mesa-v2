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
- `1cf2242` — `docs(backoffice): record hardening evidence`
- `9762fab` — `fix(platform): preserve failed outcomes across HTTP context`
- `fe7061a` — `fix(ops): discard stale platform responses`

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
- Falhas de execução agora encerram a transação interna sem efeito parcial, persistem o outcome `failed` e só voltam ao mapper HTTP depois do commit do contexto platform; o 409 não apaga o ledger.
- UUID inválido de organização falha como 400 estável (`INVALID_PLATFORM_ORGANIZATION_ID`) nos dois aliases antes da abertura do contexto de banco.

## Contratos e clientes

- As 11 projeções são um `oneOf` discriminado por `resource`, com DTO próprio e `additionalProperties: false`.
- Tenant, plano, entitlements, usuários, onboarding, billing, integrações e audit têm itens concretos. A integração final da migration `0029_platform_incident_projection_actions` adiciona filas globais sanitizadas de leads/suporte e incidentes tenant-scoped acionáveis; texto livre, evidências, hashes e configuração sensível permanecem fora dos DTOs.
- OpenAPI e cliente TypeScript foram regenerados sem `Record<string, never>[]` nas projeções.
- O cliente C# foi regenerado por Kiota e compilado com .NET 10: 0 erros e 0 avisos.

## Ops e acessibilidade

- Tabs usam roving tabindex, `aria-controls`, ids estáveis, `tabpanel`/`aria-labelledby` e navegação ArrowLeft/ArrowRight/Home/End.
- Axe cobre o `.app-shell` inteiro. O contraste do rodapé da sidebar foi ajustado após o novo escopo revelar a violação.
- A captura visual espera fontes, imagens e dois frames de layout, volta ao topo sem sleep arbitrário e verifica que shell/command bar estão dentro do viewport.
- Desktop e tablet preservam topo, shell, contexto tenant, indisponibilidade verdadeira e controles de dual-control.
- Leituras platform usam `AbortController` e epoch por overview, contexto, projeção e ações; resposta superada ou de tenant anterior não atualiza a tela.

## TDD e gates

RED observado:

- HTTP real retornava 500 sem membership platform e payload inválido vazava para o handler genérico.
- Duas desativações concorrentes removiam os dois owners; reuso divergente da mesma chave de decisão não era rejeitado.
- O ledger aceitava execução sem aprovação independente e ação/status incompatíveis.
- OpenAPI/TS/C# descreviam `items` como objeto vazio.
- Tabs não tinham relação tab/panel, foco roving nem navegação por teclado.
- Axe ampliado ao shell encontrou contraste insuficiente no rodapé da sidebar.
- O 409 de precondição persistia só `proposed`: o `failed` era revertido junto com a exceção do contexto HTTP.
- UUID de organização malformado chegava ao PostgreSQL e retornava 503 em vez de erro de cliente estável.
- Uma projeção lenta podia sobrescrever a aba ou o tenant mais recente na UI.

GREEN final:

- PostgreSQL 17 upgrade: platform actions 3/3 e HTTP real 4/4, incluindo aliases `/v1` e `/api/v1`, RLS sem membership, corrida de owners, ledger `failed` durável e erros 400/403/409/410.
- PostgreSQL 16 fresh: migration completa, platform actions 3/3 e HTTP real 4/4.
- API completa: 157 testes, 116 aprovados, 41 skips condicionados a ambientes não configurados e 0 falhas; contratos/projeções gerados 2/2.
- Ops Vitest: 60/60; typecheck e build de produção verdes.
- Playwright desktop + tablet: 6/6; Axe no shell inteiro sem violações e cenário concorrente sem projeção obsoleta.
- API typecheck e build de produção verdes.
- OpenAPI, TypeScript, Kiota C# e build .NET 10 concluídos.
- Biome focado de TS/TSX/E2E: zero erros. O lint integral continua atingido pela formatação CRLF preexistente no baseline do repositório; nenhum arquivo foi normalizado em massa.
- `git diff --check`: verde.

Screenshots inspecionados:

- `.superpowers/screenshots/wave2-backoffice-desktop.png`
- `.superpowers/screenshots/wave2-backoffice-tablet.png`

## Limites e concerns

- O login da aplicação precisa receber membership na role `giromesa_platform` durante provisioning operacional; a migration não presume o nome da role de login e não executa deploy.
- Leads e suporte são filas globais somente leitura porque o modelo atual não possui vínculo tenant confiável para mutação. Incidentes são tenant-scoped e só oferecem transições explicitamente permitidas pelo estado projetado, unidade e separação entre relator/aprovador.
- QA visual usa fixture HTTP somente para exercitar a UI; autorização, RLS, concorrência e exactly-once foram verificados separadamente em PostgreSQL real descartável.
- Os avisos Kiota sobre formatos email/URI e error types do Sync são preexistentes e fora do contrato platform.
- Nenhum provider, sessão externa, push ou deploy foi executado.

## Integração final das Tasks 33–34

- Commits integrados no candidato final: `d4bdc4a`, `31a403f`, `c310984`, `4a2eb65` e `a34b5aa`.
- PostgreSQL 16 e 17 passaram em fresh e upgrade até `0029`, com RLS/FORCE, grants por coluna, dual-control e função `SECURITY DEFINER` restrita.
- O teste HTTP PostgreSQL percorreu 506 incidentes em seis páginas keyset, sem duplicação, omissão ou quebra do isolamento tenant; 8/8 cenários passaram no PostgreSQL 17.
- Leads e suporte usam paginação keyset global; incidentes usam paginação keyset por organização/unidade e a interface oferece carregamento incremental para manter incidentes antigos acionáveis.
- A autorização antecipada da interface falha fechada se o incidente não estiver projetado, bloqueia autoaprovação e deriva `expectedState` do estado real (`approved` ou `rejected`).
- Gates finais deste bloco: API 169 pass/69 skips condicionais, Ops 109/109, Playwright desktop+mobile 10/10, typecheck, build, Axe, Biome nos arquivos funcionais alterados e `git diff --check` verdes.
