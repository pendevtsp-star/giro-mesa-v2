# Task 8 — onboarding operacional completo

## Resultado

O Ops agora conduz o primeiro acesso até uma ativação verificável usando somente a API real da Task 7. O fluxo reúne os 12 requisitos em quatro blocos, mantém plano e unidade pinados pelo servidor, atualiza o contexto ativo ao trocar a unidade, não promove evidência local e só habilita o trial quando `ready=true` e `missingItems=[]`.

Owner e manager podem consultar/atualizar o onboarding, mas seleção, reseleção, waiver de QR e ativação permanecem exclusivas de owner. Perfis sem permissão recebem bloqueio local seguro sem request. Um 403 preserva o snapshot e mantém mutations bloqueadas mesmo após refresh; um 401 encerra a sessão visual.

## RED capturado

- `pnpm --filter @giromesa/ops test -- onboarding.test.tsx` falhou inicialmente com `Cannot find module './onboarding'`; 37 testes legados passaram e o novo contrato ainda não existia.
- A primeira matriz Playwright mobile falhou porque o link do onboarding estava fora do viewport no sidebar fechado. O shell passou a fechar o menu ao navegar e o teste usa o botão móvel visível.
- O primeiro gate axe encontrou contraste `4.42:1` no texto secundário do novo fluxo. O token foi escurecido somente no escopo do onboarding e o gate WCAG ficou sem violações.
- A inspeção visual desktop revelou `scrollLeft=38` dentro de um `section` após interagir com formulários largos, recortando o cabeçalho. Os grids passaram a usar colunas flexíveis e o E2E exige `scrollLeft === 0` em todos os quatro blocos.
- O teste de retry passou a devolver 503 no primeiro status da saga. Antes da correção o polling parava; agora incrementa a tentativa, respeita o backoff e conclui na segunda consulta.

## Implementação e decisões

- `apps/ops/PRODUCT.md` registra usuários, propósito, linguagem, marca, princípios, evidências e decisões abertas usando os fatos aprovados no brief, sem reabrir discovery.
- O primeiro acesso sem memberships válidos aceita somente o caso consistente de zero organizações e cria organização/unidade atomicamente por `POST /v1/organizations`; o contexto é recarregado da API e nenhum trial local é criado.
- Os tipos de create/select/update/activate derivam do OpenAPI. Respostas de erro expõem somente `code`, `message` e detalhes allowlisted. Timeout e `AbortSignal` externo são compostos; cancelamento voluntário não vira falso timeout.
- Fiscal registra `disabled`, `focus` ou `external` sem simular provider. QR exige prova server-side ou waiver de owner com motivo auditável. Treinamento e ensaio exigem confirmação consciente e ficam somente leitura após a resposta verificada.
- Produção `off` usa o PATCH tipado verificável. `kds`, `print` e `both` permanecem `in_progress` e só podem carregar UUIDs reais já projetados pelo servidor; na ausência deles, a opção fica bloqueada e aponta para Produção. Não foi criado CRUD paralelo nem estação/perfil fictício.
- A seleção persiste antes da ativação, exige confirmação explícita para reseleção e troca a unidade ativa do shell somente após sucesso do servidor, mantendo atalhos e escopo operacional coerentes.
- A ativação mantém uma chave opaca por organização em `sessionStorage`, reutiliza a chave em reload/retry e a remove somente em estado terminal. O polling é cancelável, limitado a 30 tentativas, usa backoff, pausa offline/fora de foco e oferece retomada.
- As confirmações resolvidas são leitura somente. Formulários internos foram achatados com divisores e espaçamento, sem cartões aninhados; a topbar do fluxo usa superfície opaca.

## Segurança e escopo

- Rota e navegação exigem `onboarding.manage`, concedido somente a owner/manager; waiter não dispara GET nem mutation.
- Owner-only é aplicado novamente no cliente para seleção, reseleção, waiver e activate, sem substituir o RBAC do backend.
- O cliente não registra body de evidência, resposta interna, token, PIN, cookie ou `Idempotency-Key`.
- Nenhum mock de sucesso foi adicionado ao bundle. As interceptações vivem exclusivamente em `tests/e2e/onboarding.spec.ts` e reproduzem as formas reais do contrato da Task 7.
- Não houve provider real, credencial real, push, deploy, seed de produção, bridge, PWA, KDS novo ou impressora real.

## QA visual e acessibilidade

Matriz em lote executada em desktop e mobile. O cenário final cobre seleção de `Aurora Lagoa`, atualização do contexto visível, 12/12, estados confirmados somente leitura, ativação e ausência de overflow. Axe executou WCAG 2 A/AA e 2.1 A/AA no estado pronto sem violações.

Artefatos temporários, fora do bundle e ignorados pelo Git:

- `test-results/onboarding-onboarding-vazi-76464-e-com-readiness-do-servidor-desktop/onboarding-ready-top.png`
- `test-results/onboarding-onboarding-vazi-76464-e-com-readiness-do-servidor-desktop/onboarding-ready-activation.png`
- `test-results/onboarding-onboarding-vazi-76464-e-com-readiness-do-servidor-mobile/onboarding-ready-top.png`
- `test-results/onboarding-onboarding-vazi-76464-e-com-readiness-do-servidor-mobile/onboarding-ready-activation.png`

## Impeccable

- Contexto executado uma vez antes da implementação e craft floor relido antes do trabalho visual.
- A revisão fresca encontrou continuidade de unidade, controles ainda ativos após confirmação, composição incorreta de cancelamento/timeout, retry interrompido, superfícies aninhadas e clipping desktop. Esses achados foram corrigidos e cobertos por gates.
- O revisor também pediu criação de estações/perfis KDS/impressão na Task 8; isso foi recusado porque o brief proíbe CRUD paralelo e identificadores fabricados e reserva KDS/impressão de produção para tarefas posteriores. O fluxo mantém os modos visíveis, tipados e bloqueados até evidência real.
- O detector foi executado exatamente uma vez no fim. Reportou 6 warnings de `side-tab` e 1 advisory de fundo em grade. Os 2 warnings introduzidos pelo onboarding foram removidos depois do gate, sem rerun. Os 4 `side-tab` e o fundo em grade restantes são CSS legado fora do fluxo e não foram reescritos em massa.
- O shell legado ainda contém pseudo-ícones Unicode fora do ícone novo do onboarding; a eliminação global pertence explicitamente à Task 11. O onboarding e sua entrada de navegação usam SVGs consistentes e não antecipam essa tarefa.

## Gates executados

- Ops unit/component: **12 arquivos, 47/47 testes**.
- Ops typecheck: **verde**.
- Ops build: **verde**, 33 módulos transformados.
- Playwright onboarding: **6/6**, desktop + mobile; inclui fluxo 0/12 → 12/12, troca de unidade, ativação única/idempotente, retry 503, reload/polling, RBAC, teclado, foco em 403, axe e overflow.
- Workspace typecheck: **12/12 tasks**.
- Workspace test: **12/12 tasks**; gates de baseline/supply chain também verdes. Integrações que exigem banco real permaneceram nos skips declarados sem env.
- Biome focado nos 11 arquivos TypeScript/TSX alterados e `biome check` nos três arquivos novos: **verde**.
- `git diff --check`: **verde**.
- `pnpm run lint` integral: vermelho somente pelo baseline CRLF/formatação preexistente em `packages/db`, `packages/domain` e `apps/site`; nenhum desses arquivos foi alterado ou reformatado.

## Fix round 1 â€” autorizaÃ§Ã£o, concorrÃªncia e contrato

O round de revisÃ£o corrigiu o achado crÃ­tico e os sete achados importantes sem reduzir requisitos nem antecipar Task 9+.

### RED adicional capturado

- PostgreSQL 17 reproduziu o acesso cruzado: um manager vinculado Ã  unidade B alcanÃ§ava o `GET` do onboarding pinado na unidade A e sÃ³ falhava depois ao tentar gravar audit sob RLS, em vez de receber 403 no boundary. O teste focal ficou verde apÃ³s a autorizaÃ§Ã£o unit-scoped sob o advisory lock.
- O novo teste OpenAPI falhou com `items: { type: object, additionalProperties: true }`, provando que checklist/evidence e provisioning ainda nÃ£o eram tipados. ApÃ³s fortalecer os DTOs e regenerar clientes, ficou 3/3.
- A primeira matriz Playwright ampliada ficou 12/20. As falhas revelaram uma atualizaÃ§Ã£o redundante apÃ³s trocar unidade e expectativas antigas de copy/labels; o fluxo eliminou o refresh do escopo antigo e a matriz final ficou 20/20.

### CorreÃ§Ãµes

- `GET`, `PATCH` e status de provisioning agora carregam o `onboarding_record` sob o lock da organizaÃ§Ã£o e revalidam, dentro da mesma transaÃ§Ã£o, binding global ou binding exatamente igual a `selectedUnitId`. Registro sem seleÃ§Ã£o exige binding global. Owner global, manager da unidade selecionada e manager global foram cobertos; manager de outra unidade recebe `ONBOARDING_UNIT_SCOPE_DENIED` antes de refresh, mutation ou leitura da saga.
- Audit events disparados por revalidaÃ§Ã£o/PATCH carregam a unidade pinada, preservando a polÃ­tica RLS do manager unit-scoped. O status de provisioning tambÃ©m passou a usar contexto tenant, advisory lock e a mesma revalidaÃ§Ã£o.
- Todo snapshot terminal recebido no `GET`/refresh remove a chave da tentativa (`completed`, `terminal_failed` ou `compensated`). O E2E faz reload real, repete exatamente a mesma chave depois de um 500 e prova limpeza no resultado e em novo reload terminal.
- Fetches de snapshot compÃµem `AbortController`, sequÃªncia monotÃ´nica, generation e identidade de escopo. Mutations e polling conferem organizaÃ§Ã£o/unidade/revisÃ£o/run antes de aplicar resposta. Troca de contexto aborta requests, zera snapshot, busy e polling; troca de revisÃ£o/run zera backoff/pausa. E2E determinÃ­stico cobre GET fora de ordem e polling abortado ao desmontar sem misturar runs.
- ConfirmaÃ§Ãµes de ativaÃ§Ã£o e waiver sÃ£o vinculadas a organizaÃ§Ã£o, unidade, revisÃ£o, plano, readiness, missing items e run; mudanÃ§a do motivo do waiver tambÃ©m desmarca a confirmaÃ§Ã£o. O E2E prova resets por readiness, revisÃ£o e motivo.
- Checklist items/evidence, selection, provisioning states/checkpoints/steps/statuses e datas agora sÃ£o schemas OpenAPI explÃ­citos. O cliente valida respostas com Zod em runtime e converte violaÃ§Ã£o de boundary em `INVALID_API_RESPONSE`, sem cast cego. TS e C# foram regenerados; warnings Kiota anteriores de datas nullable do onboarding foram eliminados.
- Em 401, a sessÃ£o local Ã© limpa sincronicamente; logout remoto Ã© best effort e nÃ£o bloqueia a tela. O unit test mantÃ©m o logout remoto pendente e verifica a limpeza imediata.
- A matriz E2E usa somente status documentados pelo OpenAPI: 400/401/403/404/409/429/500. Ela cobre componente/boundary real, PATCH 400, owner/manager/waiter, unidade A/B, same-key replay, reload, terminal cleanup, cancellation e races.
- `fieldErrors` e `formErrors` allowlisted sÃ£o limitados por quantidade/tamanho, propagados ao formulÃ¡rio e associados por `aria-invalid`/`aria-describedby`. O primeiro campo invÃ¡lido recebe foco; o PATCH 400 de escolha fiscal comprova mensagem, associaÃ§Ã£o e foco.

### Gates do fix round 1

- PostgreSQL 17: **21/21** integraÃ§Ãµes reais; inclui escopo A/B, manager matching/global, owner global sem seleÃ§Ã£o e regressÃµes completas da Task 7.
- PostgreSQL 16: **21/21** no mesmo conjunto. Containers descartÃ¡veis `giromesa-task8-fix-pg16` e `giromesa-task8-fix-pg17` foram verificados pelo nome/imagem e removidos ao fim.
- API completa sem env de integraÃ§Ã£o: **91 passed, 42 skipped declarados, 0 failures**; HTTP onboarding cobre GET/PATCH/status unit-scoped nos aliases `/api/v1` e `/v1`.
- Ops unit/component/runtime boundary: **13 arquivos, 49/49 testes**.
- Contracts: **8/8 testes**; OpenAPI onboarding: **3/3**.
- Playwright onboarding: **20/20**, desktop + mobile. A matriz inclui 10 cenÃ¡rios por viewport, axe WCAG, overflow, reload real, idempotÃªncia, confirmaÃ§Ãµes, erros, cancelamento e races.
- C# gerado: `dotnet build --no-restore` **verde, 0 warnings, 0 errors** (`net10.0`).
- Workspace typecheck: **12/12 tasks**. Workspace build: **8/8 tasks**.
- Workspace test: **12/12 tasks**; baseline/supply-chain permaneceram verdes. As integrações PostgreSQL declaradamente puladas nesse comando foram executadas separadamente em PG16 e PG17, como registrado acima.
- Biome focado: **14 arquivos sem diagnósticos**. `git diff --check`: **verde**.
- QA visual em lote: as quatro capturas desktop/mobile de topo/ativaÃ§Ã£o foram inspecionadas em resoluÃ§Ã£o original; hierarquia, wrapping, foco visual e ausÃªncia de overflow permaneceram corretos.
- O detector Impeccable nÃ£o foi executado novamente neste round: a Task 8 exigia uma Ãºnica execuÃ§Ã£o final, jÃ¡ registrada acima. As correÃ§Ãµes preservam esse gate sem fabricar uma segunda passagem.

## Fix round 2 — paths profundos, cancelamento e ordem total

O segundo round fecha os três achados importantes e o achado menor da nova revisão sem reduzir o contrato, repetir o detector Impeccable ou antecipar Task 9+.

### RED adicional capturado

- O pipe Zod retornava apenas `fieldErrors.items` para a escolha fiscal aninhada. O teste HTTP real capturou a perda de `items.fiscalChoice.evidence.choice` e mostrou que o E2E anterior não usava o body produzido pelo backend.
- Quando os headers 503 já tinham chegado e o abort ocorria durante `response.json()`, `safeJson` convertia `AbortError` em `ApiClientError`. O teste determinístico reproduziu a contaminação possível após a troca de run.
- A sequência por tipo de request permitia que um PATCH antigo respondesse depois de um GET novo e rebaixasse a revisão do snapshot. O E2E reproduziu a reversão de revisão e cobriu também o interleaving inverso.
- Os schemas OpenAPI marcavam campos sempre presentes e nullable como opcionais; `attempts` era `number` e o cliente C# gerava `double?`. Os testes de contrato falharam antes da correção.

### Correções

- `ZodPipe` agora deriva paths completos somente de `issue.path`, limita profundidade, comprimento, quantidade e mensagens, seleciona de forma determinística o ramo mais próximo de unions e nunca propaga valor, payload, mensagem arbitrária ou segredo do cliente. O boundary HTTP real e o E2E compartilham exatamente `items.fiscalChoice.evidence.choice`; o campo correto recebe mensagem, `aria-invalid`, `aria-describedby` e foco.
- `safeJson` relança `AbortError`. Polling só aceita sucesso ou erro se controller, signal, organização, unidade, generation, revisão, run e ordem ainda forem correntes; um body 503 atrasado é abortado ao trocar para o novo run e não cria alerta nem backoff residual.
- GET, PATCH, seleção, ativação e polling compartilham uma única ordem monotônica para qualquer resposta que possa afetar o snapshot. Request posterior invalida resposta anterior independentemente do tipo. Refresh permanece uma leitura segura durante provisioning ativo, enquanto mutations continuam bloqueadas.
- DTO, OpenAPI e runtime Zod agora concordam sobre campos nullable sempre presentes; `attempts` é `integer/int32` com mínimo zero. Clientes TypeScript e C# foram regenerados e o C# usa `int?`, não `double?`.

### Gates do fix round 2

- Zod/HTTP/OpenAPI focados: **7/7**; inclui path aninhado real, ausência do valor malicioso, requiredness e `attempts` inteiro.
- API completa sem env de integração: **92 passed, 42 skipped declarados, 0 failures**. Contracts: **8/8**.
- PostgreSQL 17 focal unit-scope: **1/1**. A autorização não foi alterada neste round; a matriz completa PG16+17 do round 1 permanece a regressão de referência. O container descartável `giromesa-task8-fix2-pg17` foi conferido e removido.
- Ops unit/component/runtime boundary: **13 arquivos, 50/50 testes**.
- Playwright onboarding: **24/24**, 12 cenários em desktop + mobile; inclui os dois interleavings GET/PATCH e abort durante streaming do body 503 com troca de revisão/run.
- Clientes: geração TypeScript e C# **verde**. `C:\Users\maxue\.dotnet\dotnet.exe build --no-restore`: **verde, 0 warnings, 0 errors** (`net10.0`).
- Workspace typecheck: **12/12 tasks**. Workspace test: **12/12 tasks**. Workspace build: **8/8 tasks**.
- Biome focado em **10 arquivos TypeScript/TSX: verde**. `git diff --check`: **verde**.
- O detector Impeccable não foi repetido, conforme o limite explícito. O OpenAPI foi gerado apenas com uma URL PostgreSQL local placeholder necessária ao bootstrap; não houve conexão com provider, credencial real, deploy ou push.

## Fix round 3 — discriminação, retomada e reconciliação

O terceiro round fecha os três achados importantes e o achado menor da nova revisão, mantendo o escopo da Task 8 e sem repetir o detector Impeccable.

### RED adicional capturado

- O desempate do `ZodPipe` ainda podia escolher um ramo incompatível da union: fiscal `verified` com `evidence: {}` apontava para `status`, e escolha inválida acompanhada de chave extra não chegava ao campo `evidence.choice`. O teste HTTP real reproduziu ambos os bodies antes da correção.
- Um refresh manual abortava o polling corrente; quando o refresh recebia 503 sem alterar as dependências React, nenhum novo timer era agendado. O E2E reproduziu a saga presa em `publishing`.
- Um 409 antigo de ativação ainda podia renderizar alerta depois de um refresh autoritativo `completed` ou atravessar a troca de unidade. Os testes determinísticos capturaram as duas reconciliações incorretas.
- `catalogVersion`, `revision`, `includedUnits`, contagens e preços em centavos ainda eram `number` sem formato OpenAPI completo, produzindo `double?` no cliente C# e aceitando overflow de int32 no boundary Zod.

### Correções

- Os cinco itens aplicáveis (`fiscalChoice`, `qr`, `production`, `training` e `rehearsal`) agora usam unions discriminadas por `status`, eliminando a ambiguidade sem ampliar os demais schemas. O boundary HTTP retorna paths completos derivados apenas de `issue.path`; `evidence: {}` e escolha inválida com chave extra associam mensagem, `aria-invalid`, `aria-describedby` e foco a `items.fiscalChoice.evidence.choice`, sem ecoar valores, payloads ou segredos.
- Refresh passa a devolver outcome aplicado/falho/ignorado. Uma falha corrente rearma o scheduler único somente se snapshot, organização, unidade, revisão e run continuarem elegíveis, incrementa o backoff limitado e preserva os guards de cancelamento. O E2E prova `publishing → refresh 503 → polling automático → completed`, sem tight loop ou timers duplicados.
- A recuperação da ativação carrega a mesma ordem monotônica, generation e identidade de escopo. Depois do `await`, o erro antigo só pode aparecer se o request ainda for corrente e o snapshot não tiver sido resolvido terminalmente; 409 anterior a `completed` e resposta após reseleção são descartados.
- Todos os inteiros do onboarding têm limites Zod e formato OpenAPI coerentes: versões, revisão, unidades, tentativas, membros observados e status usam `int32`; centavos usam `int64` limitado ao inteiro seguro. Os clientes TypeScript/C# foram regenerados e o C# usa `int?`/`long?`, sem `double?` nesses campos.

### Gates do fix round 3

- Contratos: **9/9**; inclui discriminação fiscal e limites de todos os inteiros onboarding.
- API completa sem env de integração: **92 passed, 42 skipped declarados, 0 failures**; o HTTP real valida os dois bodies fiscais e o OpenAPI gerado.
- Ops unit/component/runtime boundary: **13 arquivos, 50/50 testes**.
- Playwright onboarding: **30/30**, 15 cenários em desktop + mobile; inclui retomada após refresh 503, ausência de timer duplicado, reconciliação terminal e troca real de unidade durante recovery.
- PostgreSQL 17 focal unit-scope: **1/1**. A autorização não mudou neste round; as matrizes PG16+17 completas do round 1 permanecem a regressão de referência. O container descartável `giromesa-task8-fix3-pg17` foi conferido e removido.
- Clientes TypeScript e C#: regeneração **verde**. `C:\Users\maxue\.dotnet\dotnet.exe build --no-restore`: **verde, 0 warnings, 0 errors** (`net10.0`).
- Workspace typecheck: **12/12 tasks**. Workspace test: **12/12 tasks**. Workspace build: **8/8 tasks**.
- Biome focado em **8 arquivos TypeScript/TSX: verde**. `git diff --check`: **verde**.
- A matriz regenerou as quatro capturas desktop/mobile de topo/ativação sem mudança visual regressiva. O detector Impeccable não foi repetido, conforme o limite explícito. OpenAPI usou somente URL PostgreSQL local placeholder de bootstrap; não houve provider, credencial real, push ou deploy.

## Fix round 4 — falha terminal pública e retry transitório

O quarto round corrige os dois achados importantes sem alterar API, contratos, clientes gerados ou escopo posterior à Task 8.

### RED adicional capturado

- Um 409 com `provisioningRunId` seguido por snapshot `terminal_failed` ou `compensated` não deixava alerta algum: a reconciliação tratava qualquer estado terminal como sucesso e descartava a mensagem pública do backend.
- Uma falha permanente de refresh durante saga `publishing` podia incrementar `pollAttempt`; os casos 403/404 reproduziram um GET de provisioning posterior e substituíram o erro original. A matriz também fixa 400/401 como políticas não transitórias.

### Correções

- Reconciliação de ativação agora considera sucesso autoritativo somente `activatedAt` ou provisioning `completed`. `terminal_failed` e `compensated` reaplicam uma única vez o `code`/`message` público já normalizado pelo boundary, preservam foco no alerta e oferecem `Tentar novamente`; nenhum detalhe fora da allowlist é renderizado. O caso `completed` continua suprimindo o 409 obsoleto.
- Refresh e polling só incrementam backoff para `ApiClientError.retryable`, conforme a política central atual de 429/5xx e falhas de transporte. 400/401/403/404 nunca reagendam; o lock de 403 é refletido sincronicamente em ref, cancela o scheduler existente e impede retomada mesmo antes do próximo render.
- O E2E pausa o relógio antes do refresh permanente, aguarda a resposta e avança dez segundos: nenhuma chamada de status ocorre para 400/401/403/404. O cenário 503 permanece verde com exatamente uma retomada e sem timer duplicado.

### Gates do fix round 4

- Ops unit/component: **13 arquivos, 50/50 testes**.
- Playwright onboarding: **42/42**, 21 cenários em desktop + 21 em mobile; inclui falha terminal/compensada, foco/CTA, sucesso reconciliado, quatro erros permanentes com relógio avançado e retry 503.
- Workspace typecheck: **12/12 tasks**. Workspace test: **12/12 tasks**; API permaneceu **92 passed, 42 skips declarados, 0 failures**. Workspace build: **8/8 tasks**.
- Biome focado nos **2 arquivos TypeScript/TSX alterados: verde**. `git diff --check`: **verde**.
- A matriz regenerou as quatro capturas desktop/mobile de topo/ativação. O detector Impeccable não foi repetido; geração OpenAPI/C# permaneceu intocada. Não houve provider, credencial real, push, deploy ou Task 9+.

## Fix round 5 — identidade exata de saga e latch permanente

O breaker final corrige os dois achados importantes no cliente Ops, sem alterar backend, OpenAPI, contratos ou clientes gerados e sem ampliar o escopo da Task 8.

### RED adicional capturado

- Um 409 da ativação do run A era usado apenas como gatilho de refresh. Se outra sessão publicasse o run B antes do `GET`, o cliente podia reapresentar a mensagem pública de A sobre B em `terminal_failed` ou `compensated`; `completed` apenas ocultava o erro por coincidência da reconciliação de sucesso.
- O erro permanente de polling ficava somente no render corrente. Depois de 400/404, ciclos `hidden → visible` e `offline → online` recriavam o efeito e podiam consultar novamente o mesmo run, apesar de nenhuma recuperação autoritativa ter acontecido.

### Correções

- A recuperação do 409 agora exige simultaneamente request corrente, generation corrente, organização/escopo correntes, ordem monotônica corrente e igualdade exata entre `details.provisioningRunId` e `snapshot.provisioning.id`. Em mismatch A→B, nenhum erro de A é publicado ou usado para suprimir B; somente o snapshot autoritativo de B é renderizado em `terminal_failed`, `compensated` ou `completed`. Em igualdade de run, falha terminal continua expondo apenas code/message públicos e CTA seguro, enquanto sucesso autoritativo continua suprimindo o 409 antigo.
- O latch de polling é chaveado por organização/unidade, revisão e run. Ele é gravado antes do alerta para erros não retryable, participa do estado reativo para desmontar o timer/controller corrente e impede recriação por eventos de visibilidade ou rede. A ref espelhada preserva guards síncronos durante races.
- O latch só é liberado por refresh manual aplicado com sucesso, mudança real de scope/revisão/run ou nova ativação. O E2E prova uma única retomada no mesmo run após recovery 400, uma única retomada no run B após recovery 404, zero consulta extra do run A e nenhuma reativação por lifecycle. 401 continua encerrando a sessão e 403 continua respeitando lock.
- O polling também rejeita uma resposta cujo DTO `status.id` não corresponda exatamente ao run solicitado, antes de tocar no snapshot.

### Gates do fix round 5

- RED/GREEN focal: **12/12 desktop** para 400/401/403/404, lifecycle 400/404, retry 503, falhas terminais do mesmo run, sucesso reconciliado e mismatch A→B nos três estados.
- Ops unit/component/runtime boundary: **13 arquivos, 50/50 testes**.
- Playwright onboarding: **52/52**, 26 cenários em desktop + 26 em mobile. Os dez novos casos cross-viewport cobrem mismatch A→B (`terminal_failed`, `compensated`, `completed`) e latch/recovery 400/404.
- Workspace typecheck: **12/12 tasks**. Workspace test: **12/12 tasks**; API permaneceu **92 passed, 42 skips declarados, 0 failures** e os gates baseline/supply-chain ficaram verdes. Workspace build: **8/8 tasks**.
- Biome focado nos **2 arquivos TypeScript/TSX alterados: verde**. `git diff --check`: **verde**.
- A matriz desktop/mobile regenerou as quatro capturas de topo/ativação. O detector Impeccable não foi repetido, conforme o cap explícito; backend/API/generated permaneceram intocados. Não houve provider, credencial real, push, deploy ou Task 9+.

## Fechamento pós-breaker — mutation busy e mismatch de status

Este fechamento focado corrige somente os dois findings finais do reviewer, sem abrir nova rodada ampla nem alterar backend, contratos, OpenAPI ou clientes gerados.

### RED adicional capturado

- Com o run A em `publishing` e latch permanente ativo, `activate()` limpava a supressão antes do POST e o effect ignorava `busy`. Uma falha do POST reabria o polling; um POST atrasado permitia que o status GET incrementasse a ordem global e tornasse a resposta `completed` do POST obsoleta.
- Um `GET /provisioning/A` que retornava DTO válido, mas com `status.id = B`, caía no guard silencioso. O snapshot não era contaminado, porém o usuário não recebia erro e eventos de lifecycle podiam rearmar o mesmo request divergente.

### Correções

- Polling agora trata `busy` como hard stop reativo, além do abort síncrono já executado por PATCH, seleção e ativação. A ativação não limpa mais o latch antes do POST: falha preserva a supressão, nenhum timer disputa a ordem monotônica durante a mutation e um POST `completed` seguido pelo snapshot autoritativo é aplicado.
- Refresh automático/recovery não limpa o latch por padrão. A liberação exige refresh explícito do usuário, mudança real de scope/revisão/run ou snapshot de sucesso autoritativo. A resposta bem-sucedida da ativação solicita refresh com liberação explícita; erro do mesmo run não o faz.
- Depois de todos os guards de request corrente, `status.id !== expectedRunId` se torna `INVALID_API_RESPONSE` não retryable. A UI exibe somente a orientação genérica segura para 5xx, latcha exatamente scope/revisão/run esperado, não incorpora o DTO B e não cria novos timers por visibility/network. Refresh manual autoritativo libera uma única retomada.

### Gates do fechamento focado

- RED reproduzido nos dois cenários antes da correção.
- Playwright focal: **4/4**, os dois casos em desktop + mobile.
- Ops unit/component/runtime boundary: **13 arquivos, 50/50 testes**.
- Ops typecheck: **verde**.
- Biome focado nos **2 arquivos TypeScript/TSX alterados: verde**. `git diff --check`: **verde**.
- Conforme o protocolo otimizado, workspace global, PostgreSQL, C#, detector Impeccable e geração não foram repetidos. Não houve push, deploy, provider real, credencial real ou Task 9+.

## Limites conhecidos

- O E2E interceptado prova comportamento e renderização do cliente; a autorização e as regressões da Task 7 foram validadas separadamente em PostgreSQL 16 e 17 descartáveis. Nenhum provider externo, credencial real, deploy ou push foi usado.
- KDS/impressão/both não podem concluir enquanto a API não projetar estações, perfis e teste reais. O estado seguro é `in_progress`, com ação de recuperação, nunca sucesso local.
- A substituição global dos pseudo-ícones legados e os advisories de CSS detectados permanecem para a Task 11; nenhuma tarefa 9+ foi iniciada.
