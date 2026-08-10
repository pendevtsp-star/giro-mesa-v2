# GiroMesa V2

Plataforma brasileira de gestão de food service, reconstruída com núcleo operacional único, experiências por função e continuidade local por unidade.

## Workspaces

- `apps/site` — site comercial e aquisição.
- `apps/customer` — cardápio e pedidos públicos.
- `apps/ops` — interface operacional React.
- `apps/api` — API modular NestJS/Fastify.
- `apps/worker` — outbox e tarefas assíncronas.
- `apps/edge-hub` — serviço local Windows para operação offline e hardware.
- `apps/ops-shell` — aplicativo MAUI que hospeda a interface operacional.
- `packages/domain` — regras e máquinas de estado puras.
- `packages/contracts` — schemas e contratos compartilhados.
- `packages/db` — schema e migrations PostgreSQL.
- `packages/ui` — tokens e componentes reutilizáveis do produto interno.

## Desenvolvimento local

1. Copie `.env.example` para `.env` e substitua apenas os valores locais necessários.
2. Inicie o PostgreSQL com `docker compose up -d postgres`.
3. Instale dependências com `pnpm install`.
4. Gere/aplique migrations e execute o seed.
5. Use `pnpm dev` ou filtre o workspace desejado.

`MFA_ENCRYPTION_KEY` e `OUTBOX_ENCRYPTION_KEY` exigem chaves distintas de 32 bytes em Base64. Gere cada uma com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`; não reutilize `SESSION_SECRET`.

O e-mail usa a API HTTP do Resend no worker, com idempotência por evento. Configure `EMAIL_PROVIDER_ENABLED=true`, `EMAIL_PROVIDER_CREDENTIAL_REFERENCE=resend`, `RESEND_API_KEY`, `RESEND_FROM` e, opcionalmente, `RESEND_REPLY_TO`. O domínio do remetente precisa estar validado no Resend antes de enviar para destinatários reais.

Consulte [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) para o escopo aprovado.

## Estado do V2

- Autenticação por senha e Google OIDC com PKCE, MFA, sessões HttpOnly e recuperação de senha.
- POS de salão/balcão, comandas, KDS, cardápio QR e pedidos públicos de retirada/entrega.
- Estoque por fichas técnicas versionadas, compras, financeiro, caixa, pessoas, comissões e relatórios.
- Reservas, fila, fidelidade, cupons, campanhas, multiunidade, API pública e webhooks assinados.
- Edge Hub SQLCipher com fila idempotente, projeção local e reconciliação após reinício.
- OpenAPI com clientes TypeScript e C# gerados e validados no CI.

As integrações que exigem credenciais, hardware ou homologação estão listadas em [docs/external-dependencies.md](./docs/external-dependencies.md). Nenhuma delas é simulada como ativa.
