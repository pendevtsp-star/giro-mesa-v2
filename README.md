# GiroMesa V2

Plataforma brasileira de gestão de food service com núcleo operacional único, experiências por função e continuidade local por unidade.

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

## Desenvolvimento local

1. Copie `.env.example` para `.env` e substitua somente valores locais.
2. Inicie PostgreSQL: `docker compose up -d postgres`.
3. Instale dependências: `pnpm install --frozen-lockfile`.
4. Aplique migrations e seed: `pnpm db:migrate && pnpm db:seed`.
5. Use `pnpm dev` ou `pnpm --filter @giromesa/<workspace> dev`.

Checks globais: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. Prefira checks estreitos durante implementação e o conjunto global em mudanças transversais/release.

`MFA_ENCRYPTION_KEY` e `OUTBOX_ENCRYPTION_KEY` exigem chaves Base64 distintas de 32 bytes. Não reutilize `SESSION_SECRET` e não registre segredos em documentação ou memória.

## Operação e integrações

- Autenticação com MFA e sessões HttpOnly.
- POS de salão/balcão, KDS, cardápio QR e pedidos públicos.
- Estoque, compras, financeiro, caixa, pessoas, reservas, CRM e multiunidade.
- Edge Hub com fila idempotente e reconciliação local.
- OpenAPI com clientes TypeScript e C# gerados e validados pelo CI.

Dependências que exigem credenciais, hardware ou homologação estão em [docs/external-dependencies.md](./docs/external-dependencies.md). Runbooks de deploy permanecem em `deploy/vps` e documentação de infraestrutura em `infra`.
