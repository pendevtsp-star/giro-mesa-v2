# Task 38 — refinamento visual por papéis e perfis

## Entrega

- Base: `main` em `9f70fcc`.
- Branch isolada: `codex/giromesa-task38-role-refinement`.
- Escopo: dashboard operacional de owner, manager, cashier e waiter; fluxo de produção/KDS; componentes visuais compartilhados usados por essas superfícies.
- Nenhuma rota, permissão, endpoint, provider ou fonte de dados foi substituída. A apresentação deriva do `Profile` e de suas permissões existentes; sessões reais continuam usando os loaders autenticados e a demonstração continua restrita ao modo já existente.

## Alterações

- Política de apresentação por perfil com quatro densidades operacionais: supervisão, serviço, transação e produção.
- Faixa contextual acessível com papel, responsabilidade existente e atalho permitido pelo RBAC.
- Prioridades do dashboard calculadas a partir de mesas/tickets disponíveis e das permissões do perfil. O badge deixou de afirmar três pendências fixas; perfis sem exceção acessível recebem apenas o atalho do próprio fluxo.
- Meta de vendas demonstrativa limitada a owner/manager, evitando ruído para waiter, cashier e kitchen.
- Navegação, alertas, ajuda, fechamentos, estados vazios e ações migrados de glifos Unicode/textuais para um conjunto SVG próprio e consistente.
- Touch targets operacionais de 48 px, contraste AA corrigido, comportamento responsivo em desktop/tablet/POS/mobile e animações reduzidas sob `prefers-reduced-motion`.
- KDS ganha largura operacional e densidade específica sem alterar transições ou dados.
- Captura visual estabilizada por `document.fonts.ready`, imagens concluídas e dois frames de layout; nenhum `sleep` foi usado.

## TDD

RED inicial:

- `role-presentation.test.ts`: módulo de política ausente.
- `ui-icon.test.tsx`: sistema SVG ausente.
- `visual-integrity.test.ts`: pseudo-ícones ainda presentes nos módulos operacionais.

GREEN final:

- App Ops: 14 arquivos de teste, 45 testes aprovados.
- A política confirma que os atalhos principais dos cinco perfis estão dentro das permissões existentes.
- O scanner de integridade cobre App, ErrorBoundary, growth, management, operations e platform.

## Impeccable

O contexto da skill e o detector foram executados uma única vez cada. A passagem única do detector encontrou quatro bordas laterais decorativas e um campo pontilhado preexistentes em `apps/ops/src/styles.css`. Todos foram removidos ou convertidos em bordas de estado discretas/superfície simples. O detector não foi repetido, conforme a instrução once-only.

## Gates

- `pnpm --filter @giromesa/ops test`: 45/45.
- `turbo run typecheck --filter=@giromesa/ops...`: 4/4 tasks.
- `turbo run build --filter=@giromesa/ops...`: 2/2 tasks; Vite production build aprovado.
- `playwright test tests/e2e/visual-roles.spec.ts --project=desktop`: 5/5 com Axe WCAG AA.
  - Owner desktop: 1440 × 1000.
  - Manager tablet/touch: 1024 × 1366.
  - Cashier POS/touch: 1280 × 800.
  - Waiter mobile/touch: 412 × 915.
  - Kitchen/KDS touch: 1440 × 900.
- `playwright test tests/e2e/public-and-operations.spec.ts tests/e2e/accessibility.spec.ts`: 20/20 em desktop e mobile.
- Biome nos 15 arquivos alterados: aprovado.
- `git diff --check`: aprovado.

## QA visual

As cinco capturas geradas por Playwright foram inspecionadas manualmente. Hierarquia, densidade, navegação recolhida, ausência de overflow horizontal, contraste, touch targets, legibilidade do POS e leitura em colunas do KDS foram aprovados. As capturas ficam sob `test-results/visual-roles-*` e são reproduzíveis pelo spec versionado, sem adicionar binários ao Git.

## Limites e concerns

- Site e Customer não foram alterados: não contêm dashboards por papel e uma mudança neles ampliaria o escopo sem benefício para a Task 38.
- Os valores demonstrativos continuam sendo os fixtures já existentes; nenhum indicador novo foi inventado.
- Sem push, deploy, provider real ou alteração da trilha mergeprep.
