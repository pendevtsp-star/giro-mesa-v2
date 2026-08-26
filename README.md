# GiroMesa V2

Plataforma brasileira de gestão para food service. O GiroMesa mantém uma fonte operacional única para salão, balcão, produção, caixa, estoque e canais públicos; permissões, transições de estado e dados de cada organização são validados no backend.

## Estrutura

```text
apps/
  frontends/
    site/        # aquisição e site comercial
    customer/    # cardápio e pedidos públicos
    ops/         # operação React/Vite
  backends/
    api/         # API NestJS/Fastify
    worker/      # outbox e tarefas assíncronas
    edge-hub/    # continuidade local e hardware
    edge-hub.tests/
  native/
    ops-shell/   # aplicativo MAUI que empacota o Ops
packages/
  contracts/     # contratos e cliente TypeScript gerado
  db/            # schema e migrations PostgreSQL
  domain/        # regras e máquinas de estado puras
  ui/            # tokens, componentes e padrões visuais
```

Consulte [PROJECT_MAP.md](./PROJECT_MAP.md) para entrypoints e rotas de leitura, [DESIGN.md](./DESIGN.md) para o sistema visual, [MEMORY.md](./MEMORY.md) para decisões estáveis e [AGENTS.md](./AGENTS.md) para o fluxo de agentes.

## Pré-requisitos

- Node.js 24 ou superior e pnpm 11.
- Docker e Docker Compose para PostgreSQL local.
- .NET SDK e workload MAUI somente para compilar o Edge Hub e o shell nativo.

## Desenvolvimento local

1. Copie `.env.example` para `.env` e preencha apenas valores locais. Nunca versione o arquivo.
2. Inicie PostgreSQL: `docker compose up -d postgres`.
3. Instale dependências: `pnpm install --frozen-lockfile`.
4. Aplique migrations e seed: `pnpm db:migrate && pnpm db:seed`.
5. Use `pnpm dev` ou `pnpm --filter @giromesa/<workspace> dev`.

Checks globais: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. Para uma alteração localizada, use primeiro o check do workspace afetado, por exemplo `pnpm --filter @giromesa/site test`.

`MFA_ENCRYPTION_KEY` e `OUTBOX_ENCRYPTION_KEY` exigem chaves Base64 distintas de 32 bytes. Não reutilize `SESSION_SECRET` e não registre segredos em documentação ou memória.

## Aplicações e acesso

- `@giromesa/site` (`3100`): site comercial, captação de teste assistido, documentos publicados e autenticação.
- `@giromesa/customer`: cardápio e pedidos públicos por QR, com token de mesa validado no backend.
- `@giromesa/ops` (`3102`): operação e back office conforme a permissão da identidade.
- `@giromesa/api` (`3200`): API NestJS/Fastify, autenticação, organizações, cobrança e integrações.
- `@giromesa/worker`: processamento assíncrono da outbox.

O site comercial não exibe preços, ofertas ou termos sem um catálogo comercial publicado e validado. Planos, testes e seus prazos são configurados e aprovados no back office; o site apenas encaminha a solicitação e nunca confirma uma contratação por conta própria.

## Operação, deploy e limites

- Autenticação com MFA e sessões HttpOnly.
- POS de salão/balcão, KDS, cardápio QR e pedidos públicos.
- Estoque, compras, financeiro, caixa, pessoas, reservas, CRM e multiunidade.
- Edge Hub com fila idempotente e reconciliação local.
- OpenAPI com clientes TypeScript e C# gerados e validados pelo CI.

O deploy produtivo é manual e controlado pelos runbooks em `deploy/vps`: backup, migration, validação de saúde e promoção atômica. Não promova uma imagem somente por estar saudável localmente.

Integrações de pagamento, fiscal, mensageria, impressoras, SmartPOS, continuidade offline e terceiros permanecem condicionadas a credenciais, dispositivo e homologação específica. Veja [docs/external-dependencies.md](./docs/external-dependencies.md) e os runbooks antes de tratá-las como prontas.

## Segurança e documentação

- Sessões usam cookies HttpOnly; MFA está disponível para acesso sensível.
- O site só cria o identificador comercial opcional após consentimento explícito; a escolha pode ser recusada sem impedir contato, cadastro ou uso das páginas públicas.
- Termos de Uso e Política de Privacidade são publicados pelo catálogo comercial. A página de privacidade inclui a seção de cookies e a versão vigente.
- `MFA_ENCRYPTION_KEY` e `OUTBOX_ENCRYPTION_KEY` devem ser chaves Base64 distintas de 32 bytes. Não reutilize `SESSION_SECRET` e não registre segredos em documentação, código ou memória.

Consulte [PROJECT_MAP.md](./PROJECT_MAP.md) para caminhos de implementação e [AGENTS.md](./AGENTS.md) para as regras de contribuição.
