# Onda 1A — web, PWA e identidade visual (Tasks 9–12)

Base: `c899c4805f999eda18b22cbb8f7d8ebe30603333`.

## Escopo

Implementar integralmente Tasks 9, 10, 11 e 12 do plano, em commits separados e recuperáveis:

1. Bridge MAUI apenas quando o host nativo existir; navegador puro não requisita bridge ausente.
2. PWA/update coordenado para Ops, Customer e Site: manifests, SW por camada, versionamento de cache, migração/TTL/limpeza, offline/update UI segura.
3. Favicon/icons consistentes nos três apps e remoção de emojis/pseudo-ícones do produto, sem alterar conteúdo livre do cliente.
4. Landing premium: remover os dois eyebrows, carrossel nítido com controles/pausa/teclado/reduced-motion, WhatsApp + e-mail, LCP budget e imagens reais existentes.

Use os caminhos reais `tests/e2e/*.spec.ts`, não o caminho antigo `e2e/`.

## Impeccable e verdade

- Leia e siga Impeccable; modo Operate para Ops/PWA e Persuade para landing.
- Preserve PRODUCT.md e a identidade aprovada. Sem inventar clientes, métricas, screenshots ou claims.
- Sem emojis/glyphs Unicode como ícones; uma família SVG real e acessível.
- Uma rodada QA desktop+mobile/tablet e uma confirmação, detector apenas uma vez no fechamento da trilha.

## Segurança

- SW nunca cacheia sessão, dados autenticados sensíveis, responses de mutação ou páginas privadas sem política explícita.
- Update não pode interromper comando em voo; activation coordenada e rollback/fallback.
- CSP/base URLs/bridge não podem abrir origem arbitrária.

## Processo otimizado

- TDD e gate focado por task; não rode full monorepo após microfix.
- Commit por Task 9/10/11/12.
- No fim da trilha: testes/build dos três apps, Playwright/Axe focado, Lighthouse/LCP proporcional, Biome/diff-check.
- Relatório em `.superpowers/wave1-web-report.md`.
- Sem push/deploy/provider real e sem tocar Task 13+.
