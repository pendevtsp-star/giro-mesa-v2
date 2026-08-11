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
- Política: cache limitado a assets estáticos, TTL de 7 dias, preservação apenas da versão atual e anterior e exclusão de autenticação, sessão e mutações.
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

## Correções da revisão cruzada

Uma revisão independente posterior encontrou três achados Important e três Minor. Todos foram corrigidos em quatro commits incrementais:

| Commit | Correção |
| --- | --- |
| `0c622ff` | Allowlist de cache por path e destination, `Cache-Control: public` explícito, fetch sem credenciais e TTL rígido de 7 dias sem stale-if-error |
| `a3b4b50` | Boundary HTTP compartilhado para mutações de Ops, Site e Customer, incluindo fetches antes diretos, sem dupla contagem |
| `e663298` | Marca Google SVG real, checks da família SVG, scanner regressivo, theme-color coerente e alvos PWA de 48 px |
| `726cb71` | Espera determinística por imagens decodificadas, fontes e layout estável antes dos screenshots |

### Evidência TDD da remediação

- Cache/TTL RED: path arbitrário era aceito, resposta sem política pública entrava no cache, o fetch preservava credenciais e um asset vencido podia voltar durante falha de rede. GREEN: 5/5 testes, com paridade da política nos três apps.
- Mutações RED: o subpath compartilhado e os boundaries dos apps ainda não existiam. GREEN: requests atrasadas de Ops, Site e Customer mantêm a ativação bloqueada até a resposta; nesting síncrono permanece em contagem 1.
- Craft RED: o scanner encontrou `G` textual, check Unicode, theme-color divergente e alvo de 44 px. GREEN: 3/3 checks de fonte após incluir também a estabilidade visual.
- Visual RED: a reprodução da revisão oscilava em tablet/mobile por imagens lazy e altura de layout. GREEN: duas execuções consecutivas aprovaram desktop, tablet e mobile sem atualizar snapshots.

### Gate consolidado após a remediação

- Testes: UI 5/5; Ops 65/65; Site 18/18 Node + 3/3 Vitest; Customer 13/13.
- TypeScript: UI, Ops, Site e Customer aprovados.
- Builds: Ops/Vite, Site/Next e Customer/Next aprovados.
- E2E focado: 13/13 para PWA nos três apps, conectividade, acessibilidade, teclado, reduced motion, canais reais, LCP e visual desktop/tablet/mobile.
- Regressão visual isolada: duas confirmações consecutivas de 3/3, sem atualização dos snapshots; imagens inspecionadas nos três breakpoints.
- Biome exato sobre os arquivos de remediação: sem erros; permanecem os mesmos 54 warnings preexistentes em `apps/ops/src/styles.css`.
- `git diff --check 11e9435..HEAD`: aprovado antes do commit deste relatório.
- O detector Impeccable não foi repetido, conforme a instrução explícita da revisão.

O cache runtime não usa `Set-Cookie` como fronteira de segurança, pois esse header não é legível de forma confiável no browser. A defesa agora combina allowlist de paths/destinations, ausência total de query, requests com `credentials: "omit"` e resposta com política `public` explícita. Assets expirados são removidos antes da tentativa de rede e nunca retornam como stale.

Durante o screenshot full-page, o percurso intencional pelas imagens abaixo da dobra ainda produz o aviso de LCP do Next. O gate isolado de LCP em viewport normal permanece verde; o aviso não representa o carregamento inicial do usuário.

## Correções da segunda revisão cruzada

Os dois achados Important e o achado Minor restantes foram fechados no commit `53ba0e5`:

- `withPwaMutation` passou a criar um token explícito por boundary assíncrona. Somente chamadas que propagam o mesmo token são suprimidas; mutações paralelas independentes continuam incrementando o contador.
- Site e Customer delegam a ativação ao helper compartilhado `requestPwaActivation`, que consulta o contador autoritativo imediatamente antes de enviar `SKIP_WAITING`. Assim, uma mutação iniciada depois do render ainda bloqueia o clique.
- As duas marcas `G` restantes foram substituídas pelo SVG `platform`; o scanner agora cobre o header do Site e o footer do Customer.

### Evidência TDD da segunda remediação

- RED de contexto: o nesting atrasado produzia a sequência `0, 1, 2, 1, 0`; os novos testes também exigiram que duas operações paralelas chegassem a 2. GREEN: a boundary atrasada com token produz `0, 1, 0`, enquanto operações independentes continuam em 2 até cada conclusão.
- RED de ativação: não havia helper autoritativo compartilhado para o clique de Site/Customer. GREEN: com mutação iniciada após o estado renderizado, o worker não recebe mensagem; encerrada a mutação, recebe uma única `SKIP_WAITING`.
- RED de iconografia: o scanner encontrou as duas marcas textuais. GREEN: o scanner ampliado confirma os dois componentes com `Icon name="platform"` e sem `G` textual.
- Refinamento RED do Ops: o gate detectou contagem 2 no `logout` atrasado enquanto o contexto ainda não atravessava a API. GREEN: o token explícito chega ao fetch interno e mantém a contagem em 1.

### Gate final da segunda remediação

- Testes: UI 7/7; Ops 68/68; Site 19/19 Node + 3/3 Vitest; Customer 13/13.
- TypeScript: UI, Ops, Site e Customer aprovados.
- E2E PWA focado: 5/5 para manifests/service workers, política no-store do Ops e conectividade dos três apps.
- Visual: desktop e tablet permaneceram idênticos; o novo SVG alterou em 1 px a altura mobile. O snapshot mobile foi regenerado, inspecionado e a confirmação limpa seguinte passou 3/3.
- `git diff --check`: aprovado antes dos commits de implementação e relatório.

O aviso do Next sobre LCP durante captura full-page permanece limitado ao percurso artificial por imagens abaixo da dobra; nenhum provider, push ou deploy foi executado.

## Fechamento

Os commits de produto e de remediação permanecem recuperáveis, e o commit final registra este relatório. A branch foi mantida no worktree isolado para integração pelo responsável da trilha.
