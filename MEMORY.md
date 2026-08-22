# GiroMesa V2 — memória do projeto

Este arquivo registra fatos estáveis e decisões úteis para novas tarefas. Não armazene senhas, tokens, dados pessoais ou estado temporário de processos.

## Preferências do produto

- Trabalhar somente na versão real/distribuível; o produto não mantém modo demonstrativo.
- O Cardápio operacional define a linguagem visual do sistema.
- Interface desejada: compacta, previsível, responsiva e orientada à próxima ação.
- Funcionalidade visual pode anteceder integração, mas deve ser identificada como local/não persistida.
- Atendimento é o coração da operação e mudanças nele exigem cuidado extra com fluxo, latência e continuidade offline.
- O usuário valoriza execução completa: alteração, checks proporcionais, build/pacote e versão local correta rodando.

## Estrutura canônica

- `apps/frontends/site`: site comercial Next.js (`@giromesa/site`).
- `apps/frontends/customer`: cardápio/pedidos públicos Next.js (`@giromesa/customer`).
- `apps/frontends/ops`: aplicação operacional React/Vite (`@giromesa/ops`).
- `apps/backends/api`: API NestJS/Fastify (`@giromesa/api`).
- `apps/backends/worker`: outbox e tarefas assíncronas (`@giromesa/worker`).
- `apps/backends/edge-hub`: continuidade local/hardware .NET.
- `apps/backends/edge-hub.tests`: testes do Edge Hub.
- `apps/native/ops-shell`: shell MAUI com bundle do Ops.
- `packages/ui`: design system; `packages/contracts`: contratos; `packages/domain`: regras puras; `packages/db`: schema/migrations.

## Decisões arquiteturais

- Package names permanecem estáveis mesmo quando pastas mudam; scripts devem preferir `pnpm --filter @giromesa/*` a paths físicos.
- Tenant scope é validado no backend; IDs vindos do cliente não são confiáveis por si só.
- Valores monetários trafegam em centavos inteiros.
- Mutações recuperáveis/repetíveis usam idempotência e audit/outbox na mesma transação quando aplicável.
- O frontend não deve manter como confirmado um valor rejeitado pelo backend.
- Bundles gerados do Ops Shell são necessários ao pacote nativo; demais `dist/.next/.turbo/test-results/bin/obj` são regeneráveis.
- SmartPOS usa PWA para atendimento e APK homologado para pagamento. O navegador nunca aprova; dispositivos usam pareamento P-256, requests assinados/antirreplay e matriz exata com kill switch. A bridge recebe somente IDs e fica fail-closed sem resolvedor, certificação e adaptador confiáveis.
- Homologação de terminal é configuração interna, fora do perfil alterável pelo tenant. Cada resultado exige dispositivo pareado, idempotência, auditoria e outbox; integração externa só fica pronta com hardware e evidência real.

## Estado do Cardápio

- A experiência do Cardápio usa apenas escopo e integrações reais.
- Os controles avançados usam API real: aggregate de produto, delivery/custo/estoque diário, branding, promoções, reordenação, reajuste em lote, CSV, BCG, publicação, QR e mídia.
- Criações e operações repetíveis exigem idempotência; alterações agregadas, auditoria e outbox devem permanecer na mesma transação.
- O menu público valida token HMAC da mesa, remove o token da URL e aplica preço por canal, promoção e reserva de estoque diário atomicamente.
- Limite conhecido: `autoDeductStock` controla o limite diário do catálogo, mas não baixa estoque físico sem vínculo produto→item/local; BCG usa custo atual, não CMV histórico.
- Estilos reutilizáveis do Cardápio foram extraídos para `packages/ui/src/patterns.css`.

## Verificação proporcional

- Mudança isolada: formatter/lint e typecheck do workspace.
- UI operacional: teste estreito + viewport 375 px; E2E real quando mexer em fluxo crítico.
- API/domínio financeiro: unitário + integração relevante, idempotência e concorrência quando aplicável.
- Estrutura/release: `pnpm install --frozen-lockfile`, checks dos workspaces, build, paths Docker/CI e sincronização do Ops Shell.
- .NET depende do SDK/workload instalado; nunca declare validado se o ambiente não o possui.

## Ferramentas e contexto

- Consulte `PROJECT_MAP.md` e `.code-review-graph/wiki/index.md` antes de varrer o repositório.
- Use `code-review-graph` com contexto mínimo para impacto/fluxos; regenere após mudanças estruturais.
- Use subagentes com diretórios não sobrepostos; o principal integra e valida.
- Preserve worktrees com branches não integrados; não trate cópias registradas como cache.

## Manutenção desta memória

- Registre apenas decisões duráveis, entrypoints e preferências que economizem análise futura.
- Atualize quando paths, contratos ou limites de produto mudarem.
- Remova informação obsoleta no mesmo trabalho que introduzir a nova verdade.
