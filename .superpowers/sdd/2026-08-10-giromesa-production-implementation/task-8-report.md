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

## Limites conhecidos

- O E2E interceptado prova comportamento e renderização do cliente, não substitui integração autenticada com PostgreSQL. A Task 7 registra os gates reais PG16/PG17; nesta task nenhum banco/provider foi iniciado.
- KDS/impressão/both não podem concluir enquanto a API não projetar estações, perfis e teste reais. O estado seguro é `in_progress`, com ação de recuperação, nunca sucesso local.
- A substituição global dos pseudo-ícones legados e os advisories de CSS detectados permanecem para a Task 11; nenhuma tarefa 9+ foi iniciada.
