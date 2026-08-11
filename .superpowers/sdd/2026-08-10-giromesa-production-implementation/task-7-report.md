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
