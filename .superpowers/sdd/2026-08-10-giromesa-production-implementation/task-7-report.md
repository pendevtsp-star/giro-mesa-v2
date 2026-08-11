# Task 7 - Onboarding e provisionamento recuperavel

## Resultado

O onboarding agora usa evidencias normalizadas e uma saga persistida por organizacao. A ativacao e serializada no PostgreSQL, tem lease, checkpoints, recursos provisorios e compensacao; somente o commit final cria o trial de 14 dias, ativa assinatura/entitlements e grava audit/outbox. O mesmo `Idempotency-Key` devolve a resposta persistida, input diferente e rejeitado e chaves concorrentes nao duplicam efeitos.

## RED capturado

- `pnpm --filter @giromesa/domain test`: falhou primeiro com imports inexistentes da nova maquina de estados/checklist (`CHECKLIST_ITEMS`, `StructuredActivationChecklist`, transicoes e resume state).
- O primeiro teste PostgreSQL da saga ficou em 2/6: revelou a transicao invalida `requested -> provisioning` e `permission denied for table subscriptions`. A correcao tornou explicita a passagem logica por `validating` e usa INSERT column-explicit, sem conceder ao app escrita nos identificadores do provider.

## Modelo e decisoes

- Checklist de 12 itens em `onboarding_checklist_items`: `pending`, `in_progress`, `verified`, `blocked` e `not_applicable`, com fonte, evidencia, ator e horario. Booleanos N-1 viram apenas progresso legado, nunca evidencia verificada.
- Itens verificaveis pelo sistema sao recalculados de recursos persistidos antes da ativacao. Atestados aceitos possuem evidencias estruturadas. Somente owner pode dispensar `fiscalChoice` ou `qr`, com justificativa auditavel.
- Constraints impedem forjar `verified` sem referencia/horario e impedem atestado humano sem ator. Dispensas exigem item permitido, fonte, referencia, ator, horario e motivo.
- `provisioning_runs` e `provisioning_steps` registram estado, checkpoint, tentativas, lease, plano pinado/snapshot/fingerprint, erro e resposta. Advisory lock por organizacao mais indices unicos garantem uma saga viva e efeitos exactly-once.
- Recursos internos usam IDs deterministas. Assinatura e entitlements nascem provisoriamente; falha terminal os deixa `canceled`/`revoked`, sem apagar trilha. Falha transiente solta o lease e retoma do ultimo checkpoint.
- O plano exato e revalidado por ID, versao e fingerprint. Drift nao troca silenciosamente preco ou entitlements.
- O commit final revalida owner, organizacao, plano e checklist; no mesmo commit cria trial, ativa assinatura/entitlements, altera billing state e grava audit/outbox idempotentes. `startsAt` e criado nesse commit, nunca antes.
- A migration `0014_onboarding_provisioning` faz backfill seguro, usa FKs compostas tenant-scoped, FORCE RLS, grants minimos e nega worker/identity/public/internal/legacy. O app nao recebe INSERT de tabela em `subscriptions`, apenas das colunas da saga.
- O seed comercial continua sem tenant ou senha demo. Demo exige flag explicita, ambiente nao produtivo e namespace `demo-*`; producao falha fechado.
- Contratos OpenAPI, TypeScript e C# foram regenerados; `Idempotency-Key` e endpoint de status da saga estao publicados nos aliases atuais.

## Gates executados

- PostgreSQL descartavel: `PostgreSQL 17.10`.
- `node --test apps/api/dist/onboarding/provisioning.integration.test.js` com `PROVISIONING_DATABASE_URL`: **6/6**. No proprio gate: fresh migration, upgrade 0013 -> 0014, backfill, checklist adulterado, crash/retry, checkpoint replay, resposta perdida, input drift, concorrencia com chaves distintas, plan drift, compensacao, `startsAt` somente no commit final, FORCE RLS, isolamento tenant, constraints de evidencia e least privilege.
- `pnpm --filter @giromesa/api test` com PostgreSQL: **91 pass, 21 skips, 0 fail**; todos os 6 testes Task 7 executaram.
- `pnpm --filter @giromesa/domain test`: **32/32**.
- `pnpm --filter @giromesa/contracts test`: **6/6**.
- `pnpm --filter @giromesa/db test`: **3 pass, 1 skip, 0 fail**; seed guard executado, teste legado 0009 sem env permaneceu skip.
- `pnpm test`: **verde em 12 tasks**, incluindo gates de baseline e supply chain; integracoes sem env permanecem skips declarados.
- `pnpm typecheck`: **12/12 tasks**.
- `pnpm build`: **8/8 tasks**.
- Biome nos arquivos-fonte alterados de API/contracts/db/domain: **verde**.
- `pnpm openapi:generate`, `pnpm clients:generate:ts` e `pnpm clients:generate:csharp`: **verdes**; Kiota emitiu apenas warnings preexistentes de formatos `email`/`uri` e erros genericos.
- `git diff --check`: **verde**.

## Concern conhecido

`pnpm check` nao completa porque o lint integral encontra CRLF em arquivos preexistentes e fora da Task 7 (por exemplo `packages/domain/src/billing.ts`, `packages/domain/src/commercial.ts` e paginas do site). Esses arquivos nao foram reformatados para evitar um bulk rewrite fora de escopo. Typecheck, testes, build e lint focado alterado estao verdes. Nao houve push, deploy, provider real ou UI da Task 8.

## Fix round 1

### Correcoes aplicadas

- A selecao explicita de plano e unidade agora antecede a saga. O endpoint `PUT /organizations/:organizationId/onboarding/selection` fixa ID, versao, snapshot, fingerprint e unidade, exige `reselect: true` para trocar uma selecao existente e marca `plan` como `verified`. A criacao do run copia esse pin atomicamente; a saga nunca volta a resolver o slug. O commit final revalida publicacao, fingerprint, snapshot, versao e unidade.
- O readiness e deterministico para `selectedUnitId`: caixa, equipe, mesas, catalogo, QR e producao sao consultados no escopo dessa unidade. Producao `off` e uma escolha valida; `kds`, `print` e `both` so podem passar com capacidade, configuracao e teste persistidos no servidor. Como essa infraestrutura ainda nao existe, evidencias vindas do navegador sao recusadas. QR tambem exige menu, mesas, capacidades, configuracao e teste reais; enquanto ausentes, somente waiver de owner com motivo e trilha auditavel permite prosseguir.
- O GET continua retornando os 12 itens coerentes. Ativacao consome a selecao persistida e mantem compatibilidade segura com payload legado, sem deixar um slug legado alterar um pin existente.
- Toda selecao, waiver e alteracao de checklist grava evento append-only com `before`/`after` completos, motivo, fonte, evidencia, ator e horario. Grants de runtime negam `UPDATE`, `DELETE` e `TRUNCATE` em `audit_events`; o teste confirma que tentativa de sobrescrita nao apaga o historico.
- `Idempotency-Key` passa pelo `ZodPipe`: header malformado retorna erro 400 tipado, nunca 500. OpenAPI publica respostas 200/201, erros, header e os dois aliases; clientes TypeScript e C# foram regenerados e retornam DTOs tipados em vez de `void`/`Stream`.
- GET, status e activate usam projecoes allowlist. Lease owner, fingerprint, snapshot bruto, resposta armazenada, checkpoints internos e mensagem sensivel de erro nao saem da API; testes de blacklist cobrem respostas e clientes gerados.
- Os testes artificiais foram substituidos por falhas observaveis: processo filho encerrado depois do checkpoint deixa lease orfao, retry antes de 30 s nao rouba e retry depois do expiry recupera; socket HTTP abortado perde apenas a resposta enquanto o commit termina; concorrencia same-key e distinct-key usa barreira PostgreSQL e `pg_stat_activity` para provar sobreposicao. Todos confirmam exatamente um trial, uma assinatura, um outbox e nenhuma compensacao duplicada.
- A migration aditiva `0015_onboarding_selection` cria os pins persistidos, FKs tenant-scoped, checks, RLS/grants e endurece a imutabilidade da auditoria.

### Gates do fix

- PostgreSQL 17: integracao Task 7 **11/11**, incluindo fresh migrations e upgrade `0013 -> 0014 -> 0015`, crash real, socket abort, concorrencia forcada, pin drift, RLS e grants.
- PostgreSQL 16 descartavel: o mesmo gate **11/11**; o container temporario foi removido ao final.
- `pnpm test`: **12/12 tasks**; API total **120** quando o banco do gate esta disponivel e skips de integracao permanecem explicitos sem env.
- `pnpm typecheck`: **12/12 tasks**.
- `pnpm build`: **8/8 tasks**.
- Biome focado nos arquivos alterados, geracao OpenAPI/TypeScript/C# e `git diff --check`: **verdes**.
- `pnpm lint` integral continua vermelho apenas pelo baseline de formatacao/CRLF fora deste patch em site, ops, domain e db; nenhum desses arquivos foi reformatado em massa.

### Self-review

- O pin e copiado na mesma transacao que cria o run e e comparado novamente antes do commit; replay da mesma chave devolve o trial original mesmo apos reselecao posterior.
- As projecoes publicas foram revisadas por allowlist e os testes recusam os nomes internos conhecidos.
- Nao existem failpoints de producao: crash, espera e barreiras vivem somente no harness de integracao.
- Nao houve push, deploy, provider real nem expansao para a UI da Task 8.

## Fix round 2

### RED capturado

- O teste de contratos aceitou inicialmente `evidence` com chave `secret` e objeto arbitrario. O RED confirmou que `z.record(unknown)` permitia dados sem contrato e potencialmente sensiveis no checklist.
- Os testes PostgreSQL de corrida foram escritos com gates transacionais antes da correcao: PATCH e ativacao podiam observar readiness em instantes diferentes, e a selecao nao revalidava o papel owner depois de aguardar o lock.

### Correcoes aplicadas

- GET/refresh, PATCH, selecao e ativacao usam o mesmo advisory lock por organizacao. PATCH revalida ativacao/run dentro do lock; o commit final revalida readiness e o pin e usa CAS para impedir commit sobre estado alterado.
- Selecao revalida membership ativa e papel owner dentro da transacao, depois do lock. Democao concorrente falha fechado e nao muda o pin.
- Toda mudanca automatica de evidencia de sistema grava auditoria append-only na mesma transacao, com before/after allowlisted, motivo, evidencia, ator system/null e horario. Refresh sem mudanca nao gera spam; GET, validacao e revalidacao final estao cobertos.
- Reselecao apos drift preserva o pin/snapshot persistido como `before`, classifica corretamente `reselected` e registra apenas snapshots sanitizados.
- O boundary HTTP do onboarding normaliza erros reais em `{ statusCode, code, message, details? }`, com details allowlisted. Zod de header/body, UUID, not found, conflito, readiness incompleto e indisponibilidade foram exercitados nos aliases `/api/v1` e `/v1`.
- Evidencias do navegador agora sao unions estritas por item/status, com enums e limites. Chaves extras, payload oversized e campos com aparencia de segredo retornam 400 e nao chegam ao service. OpenAPI e clientes TypeScript/C# foram regenerados com erros tipados.

### Gates do fix

- PostgreSQL 17: integracao Task 7 **15/15**, incluindo as duas ordens PATCH/ativacao, democao owner, auditoria de drift e historico, fresh migration e upgrade.
- PostgreSQL 16: o mesmo gate **15/15**.
- Pos-formatacao, o teste PostgreSQL focado de auditoria automatica passou **1/1**.
- Contratos: **7/7**; API: **126 total, 90 pass, 36 skips, 0 fail**; HTTP real: **2/2**; OpenAPI gerado: **2/2**.
- `pnpm test`: **12/12 tasks** e **25/25** gates de baseline/supply-chain; `turbo run typecheck`: **12/12 tasks**; `pnpm build`: **8/8 tasks**.
- C# gerado compilou com **0 warnings e 0 errors**. Biome focado dos arquivos alterados e `git diff --check` ficaram verdes.
- `pnpm lint` integral permanece vermelho somente pelo baseline CRLF preexistente fora deste patch (domain/site e outros pacotes). Nenhum arquivo fora do escopo foi reformatado.

### Self-review

- As escritas de readiness nao escapam do lock comum e as auditorias pertencem a mesma transacao da evidencia; refresh no-op e idempotente.
- Respostas e auditorias usam allowlists: nenhuma evidencia arbitraria, segredo, lease, fingerprint bruto ou payload interno e refletido.
- Nao houve push, deploy, provider real ou alteracao de containers compartilhados.

## Fix round 3

### RED capturado

- Os contratos aceitavam apenas `production: off` verificado ou progresso generico; os novos testes falharam para a intencao estrita `kds`, `print` e `both` e para o round-trip exato de `pending`.
- A primeira tentativa de `SELECT ... FOR UPDATE` pelo papel da aplicacao falhou com `permission denied` nas tabelas de autorizacao. O boundary foi movido para uma funcao minima `SECURITY DEFINER`, sem conceder `UPDATE` em memberships/role bindings. Um RED adicional com nomes de GUC incorretos retornou `false` e confirmou o fail-closed.
- Os testes de corrida PostgreSQL pausaram a selecao e o commit final nos dois lados da fronteira de autorizacao. Antes dos locks de linha, a revogacao podia ficar fora da ordem linearizavel esperada.
- O GET pos-ativacao reavaliava recursos operacionais e podia rebaixar checklist/auditoria historicos; o teste removeu produto, mesa e equipe depois da ativacao e capturou essa mutacao indevida.

### Correcoes aplicadas

- A migration aditiva `0016_onboarding_owner_lock` cria uma funcao `public` com `search_path` fixo, tabelas qualificadas, `PUBLIC` revogado e `EXECUTE` exclusivo para `giromesa_app`. Ela valida organizacao/ator contra os GUCs da transacao, bloqueia memberships e depois role bindings em ordem UUID fixa, revalida owner e mantem os locks ate o commit. Selecao, criacao do run e commits de ativacao usam esse mesmo boundary depois do advisory lock.
- Os testes deterministas cobrem selecao e ativacao nos dois sentidos: quando onboarding obtem o lock primeiro, a democao aguarda; quando a democao vence, onboarding aguarda e falha sem selecionar/ativar. Nenhum trial nasce sem owner linearizavel.
- Um onboarding ativado agora projeta o snapshot final persistido com `ready: true`, sem refresh, rebaixamento ou nova auditoria por drift operacional posterior. Saude operacional futura permanece fora desse dominio historico.
- PATCH `pending` persiste exatamente `pending` e limpa referencia/evidencia/ator/verificacao/waiver. `blocked` e `in_progress` continuam distintos no contrato, banco e DTO.
- Producao aceita intencao estrita `kds`, `print` e `both` em progresso, com UUIDs limitados das estacoes/perfis e referencia de configuracao limitada. Chaves extras e modos incompletos sao rejeitados; a intencao nunca promove readiness. `off` explicito continua verificavel.
- Todos os cinco endpoints nos aliases `/api/v1` e `/v1` publicam respostas reais 401, 403 e 500. O filtro converte excecao nao HTTP em corpo allowlisted `INTERNAL_ERROR`, sem stack/segredo. OpenAPI e clientes TypeScript/C# foram regenerados; testes exercitam HTTP real e mappings C#.

### Gates do fix

- PostgreSQL 17.10: integracao Task 7 **20/20**, incluindo fresh migration, upgrade ate `0016`, corridas nos dois commit orders, freeze, pending, modos de producao, RLS e least privilege.
- PostgreSQL 16 descartavel: o mesmo gate **20/20**; o container temporario criado para o gate foi removido.
- `pnpm test`: **12/12 tasks** e gates de baseline/supply-chain **25/25**. API: **131 total, 90 pass, 41 skips declarados sem env, 0 fail**; contratos: **8/8**.
- `pnpm typecheck`: **12/12 tasks**; `pnpm build`: **8/8 tasks**.
- Cliente C# compilou com **0 warnings e 0 errors**. OpenAPI, TypeScript e C# foram regenerados; os testes de contrato HTTP/OpenAPI passaram nos dois aliases.
- `git diff --check`: **verde**.
- `pnpm lint` integral continua vermelho pelo baseline CRLF/formatacao preexistente e fora deste patch em `packages/domain`, `apps/site` e outros arquivos. Nenhum bulk rewrite fora de escopo foi realizado.

### Self-review de seguranca e consistencia

- O `SECURITY DEFINER` nao aceita SQL dinamico, fixa `pg_catalog, public`, qualifica todas as relacoes e a propria chamada, nao devolve dados de autorizacao alem do booleano e nao concede escrita ao app. `PUBLIC` nao possui execute; chamadas sem GUC ou com ator divergente falham fechado. Os GUCs continuam parte do boundary transacional confiavel ja usado pelo RLS; uma credencial de banco comprometida permanece fora do modelo de usuario HTTP e nao ganha nova mutacao por essa funcao.
- O freeze usa apenas snapshot cujo ID, versao e fingerprint ainda conferem internamente. Evidencias e erros continuam saindo por allowlists.
- Nao houve push, deploy, provider real ou remocao de containers compartilhados.
