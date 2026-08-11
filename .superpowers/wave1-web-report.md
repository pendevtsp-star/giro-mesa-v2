# Relatório de entrega — Onda 1A Web

Data: 2026-08-11

Base: `c899c48`

Branch: `codex/giromesa-wave1-web`
Escopo: Tasks 9–12 do plano de produção do GiroMesa.

## Resultado

A Onda 1A foi implementada em quatro commits recuperáveis, um por task. O trabalho ficou restrito a Ops, PWA, família de ícones e landing Site; Task 13+, providers reais, push e deploy não foram executados.

| Task | Commit | Entrega |
| --- | --- | --- |
| 9 | `0f51b93` | Bridge MAUI carregada apenas no host nativo, por caminho relativo |
| 10 | `8a67fcb` | PWA offline coordenada e atualização segura nos três apps |
| 11 | `91d9c1f` | Família SVG de ícones compartilhada e semântica acessível |
| 12 | `b3dee75` | Carousel acessível, canais de contato verdadeiros e QA visual |

## Evidência TDD por task

### Task 9 — integração MAUI

- RED: 3 testes falharam pela ausência das funções de detecção e carregamento do bridge.
- GREEN: 3/3 testes focados e 53/53 testes Ops passaram; typecheck e Biome focado passaram.
- Segurança: o script `_framework/hybridwebview.js` não é solicitado no navegador comum e só é carregado quando o transporte nativo está presente.

### Task 10 — PWA e atualização segura

- RED: 6 falhas por módulos ainda ausentes; o primeiro E2E também demonstrou que `no-store` global era uma política incorreta.
- GREEN: Ops 59/59, Site 14/14 e Customer 11/11; typecheck dos três apps; E2E PWA 5/5; Biome e `diff --check` focados.
- Política: cache limitado a assets estáticos, TTL de 7 dias, preservação apenas da versão atual e anterior e exclusão de autenticação, sessão, mutações, `Set-Cookie`, `private` e `no-store`.
- Atualização: não recarrega durante mutação em voo; permite ação manual segura; migração/limpeza de IndexedDB e limpeza no logout foram cobertas.

### Task 11 — iconografia

- RED: 2 falhas nos exports do pacote UI e 1 falha no Customer por mistura de iconografia.
- GREEN: UI 3/3, Ops 59/59, Customer 12/12 e Site 14/14; typecheck nos quatro pacotes; Biome e `diff --check` focados.
- Resultado: ícones SVG controlados pelo produto, com `aria-hidden` nos decorativos e nome acessível quando o ícone comunica uma ação.

### Task 12 — landing e carousel

- RED: componente inexistente e transformação TSX ainda não configurada no Vitest do Site.
- GREEN: Site 14 testes Node + 3 Vitest; E2E desktop/mobile para Axe, movimento reduzido, teclado, canais de contato, preload e LCP.
- Carousel: quatro imagens existentes, autoplay de 7 s, pause/play, anterior/próximo, setas de teclado nos controles e autoplay desativado sob `prefers-reduced-motion`, preservando navegação manual.
- Contato: WhatsApp preservado; e-mail só usa `mailto:` quando `NEXT_PUBLIC_CONTACT_EMAIL` é válido, com fallback honesto para `/contato`.
- Copy: removidas apenas as duas eyebrows previstas no hero e na seção de produto.

## Gate consolidado da trilha

- Testes + typecheck:
  - Ops: 59/59 + TypeScript.
  - Customer: 12/12 + TypeScript.
  - Site: 14/14 Node + 3/3 Vitest + TypeScript.
  - UI: 3/3 + TypeScript.
- Builds:
  - Ops/Vite aprovado (`467,58 kB`, gzip `133,09 kB` no chunk principal).
  - Customer/Next aprovado, com todas as rotas geradas.
  - Site/Next aprovado, com todas as rotas geradas.
- E2E funcional, desktop e mobile: 18 passed; 2 checks de LCP deliberadamente ignorados sob execução paralela para evitar contenção artificial.
- LCP isolado com `--workers=1`, desktop e mobile: 2 passed, ambos abaixo de 2,5 s no ambiente local.
- Regressão visual: 3/3 screenshots aprovados e depois confirmados sem atualização dos snapshots.
- Biome exato sobre os 54 arquivos alterados: exit 0. Permanecem 54 warnings preexistentes em `apps/ops/src/styles.css`, sem erro novo.
- `git diff --check c899c48..HEAD`: aprovado ao fechamento.

O check de LCP é um gate local proporcional, não substitui Lighthouse/telemetria na infraestrutura de produção.

## QA visual

Breakpoints revisados: desktop `1440×1000`, tablet `820×1180` e mobile `390×844`. Foram verificados hero, carousel, controles, cards, precificação, FAQ, CTAs e rodapé, sem sobreposição ou corte visível.

- `tests/e2e/landing-visual.spec.ts-snapshots/landing-desktop-desktop-win32.png`
- `tests/e2e/landing-visual.spec.ts-snapshots/landing-tablet-desktop-win32.png`
- `tests/e2e/landing-visual.spec.ts-snapshots/landing-mobile-desktop-win32.png`

Durante screenshot `fullPage`, o Next alertou que imagens abaixo da dobra podiam aparecer como LCP porque o navegador passou a enxergá-las no viewport expandido. Isso não ocorreu no gate isolado de carregamento inicial, em viewport normal.

## Impeccable

O detector foi executado uma única vez, conforme o brief. Ele retornou 9 warnings e 1 advisory: tabs laterais/uso de Inter em Site e Customer, tabs laterais e um background de grid em Ops. A comparação direta contra `c899c48` confirmou que todos esses padrões já existiam na base; não houve finding novo introduzido pela Onda 1A.

## Limites e concerns

- Não houve execução em hardware/host MAUI real nem sessão autenticada real; a detecção nativa foi validada por contrato, documentação e testes automatizados.
- Service workers foram exercitados localmente; não houve rollout de produção.
- O canal de e-mail real depende de `NEXT_PUBLIC_CONTACT_EMAIL`; o WhatsApp real depende de `NEXT_PUBLIC_WHATSAPP_NUMBER`. Sem configuração válida, a UI aponta para `/contato` e não inventa endereço.
- Permanecem warnings de estilo preexistentes no CSS de Ops e no detector Impeccable, registrados acima.
- Não houve provider real, push, deploy, alteração de Task 13+ nem declaração de aprovação de produção.

## Fechamento

Os quatro commits de produto estão separados por task. O commit final registra este relatório, o brief da trilha e normaliza os EOF de seis SVGs apontados pelo `diff --check`. A branch foi mantida no worktree isolado para integração pelo responsável da trilha.
