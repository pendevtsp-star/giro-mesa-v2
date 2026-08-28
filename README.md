# GiroMesa V2

[![CI](https://github.com/pendevtsp-star/giro-mesa-v2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/pendevtsp-star/giro-mesa-v2/actions/workflows/ci.yml)
[![Security](https://github.com/pendevtsp-star/giro-mesa-v2/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/pendevtsp-star/giro-mesa-v2/actions/workflows/security.yml)

Plataforma brasileira de gestão para food service. O GiroMesa mantém uma fonte operacional única para salão, balcão, produção, caixa, estoque e canais públicos. Autorização, transições de estado, cobrança e dados de cada organização são validados no backend.

> **Estado atual:** o núcleo operacional é destinado a um piloto controlado. Pagamentos, emissão fiscal, WhatsApp, SmartPOS, impressoras e outras integrações externas só devem ser liberados depois de credenciais, equipamento e homologação correspondentes. Consulte [as dependências externas e seus gates](./docs/external-dependencies.md) antes de prometer uma integração.

## Produto publicado

| Superfície | URL | Uso |
| --- | --- | --- |
| Landing e login | [giromesa.com.br](https://giromesa.com.br) · [/login](https://giromesa.com.br/login) | Site comercial, solicitação de teste e autenticação |
| Operação e back office | [app.giromesa.com.br](https://app.giromesa.com.br) | Salão, balcão, KDS, caixa, estoque, pessoas e administração |
| Cardápio e pedidos públicos | [menu.giromesa.com.br](https://menu.giromesa.com.br) | Acesso por QR/token de mesa |
| API | [api.giromesa.com.br/health](https://api.giromesa.com.br/health) | Saúde pública da API |

## Arquitetura

```text
Browser público ───────> site/customer ───────> API ───────> PostgreSQL
Operação web ──────────> Ops ──────────────────┘  │
Aplicativo nativo ─────> Ops Shell + Edge Hub ───┤
Worker ─────────────────> outbox e provedores ────┘
```

| Área | Responsabilidade |
| --- | --- |
| `apps/frontends/site` | Landing, catálogo comercial, login, cadastro e documentos legais |
| `apps/frontends/customer` | Cardápio e pedidos públicos por QR |
| `apps/frontends/ops` | Operação React/Vite e back office conforme as permissões da identidade |
| `apps/backends/api` | API NestJS/Fastify, autenticação, organizações, cobrança e integrações |
| `apps/backends/worker` | Outbox, notificações e tarefas assíncronas |
| `apps/backends/edge-hub` | Continuidade local, reconciliação e hardware |
| `apps/native/ops-shell` | Shell .NET MAUI que empacota o Ops |
| `packages/contracts` | Contratos HTTP e clientes gerados |
| `packages/db` | Schema e migrations PostgreSQL |
| `packages/domain` | Regras e máquinas de estado puras |
| `packages/ui` | Tokens, componentes e padrões visuais compartilhados |

Para localizar um fluxo sem abrir o monorepo inteiro, comece pelo [PROJECT_MAP.md](./PROJECT_MAP.md). O sistema visual está em [DESIGN.md](./DESIGN.md).

## Desenvolvimento local

### Requisitos

- Node.js 24 ou superior.
- pnpm 11.7.0 (a versão fica fixada no `package.json`).
- Docker Desktop/Engine com Docker Compose.
- .NET SDK 10 e workload MAUI apenas para o Edge Hub ou o shell nativo; veja o [README do Ops Shell](./apps/native/ops-shell/README.md).

### Primeira execução

Na raiz do repositório:

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

No PowerShell, o equivalente para copiar a configuração é:

```powershell
Copy-Item .env.example .env
```

O comando `pnpm dev` inicia os frontends, a API e o worker em paralelo. O Edge Hub e o aplicativo MAUI são opcionais e possuem build próprio. O banco local fica em `localhost:5440`; o volume do Compose é persistente.

### Acessos locais

| Serviço | Endereço |
| --- | --- |
| Site | `http://localhost:3100` |
| Customer | `http://localhost:3101` |
| Ops | `http://localhost:3102` |
| API | `http://localhost:3200` |
| PostgreSQL | `localhost:5440` |

Para parar apenas os serviços locais sem apagar dados, use `docker compose stop`. Não use `docker compose down -v` em um banco que precise ser preservado.

## Configuração e segredos

`.env.example` é a referência completa. Crie um `.env` local e nunca o versione; o `.gitignore` já o exclui. Em produção, injete os valores pelo cofre/arquivo protegido da VPS, não pelo GitHub.

Variáveis fundamentais:

| Variável | Regra |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL do ambiente |
| `APP_URL`, `CUSTOMER_APP_URL`, `OPS_APP_URL`, `API_URL` | Origens públicas de cada superfície |
| `CORS_ORIGINS` | Lista explícita das origens autorizadas |
| `SESSION_SECRET` | Segredo aleatório de pelo menos 32 bytes |
| `QR_TABLE_TOKEN_SECRET` | Segredo aleatório independente para tokens de mesa |
| `MFA_ENCRYPTION_KEY`, `OUTBOX_ENCRYPTION_KEY` | Chaves Base64 distintas, cada uma com 32 bytes |
| `PLATFORM_ADMIN_ROLES` | Somente o responsável de contingência, no formato `email=admin`; a equipe é convidada e revogada pelo backoffice |
| `PLATFORM_ADMIN_EMAILS` | Compatibilidade legada; mantenha vazio |

Google, Resend, Asaas, Focus NFe, Evolution/WhatsApp, DoseClub, Web Push, SmartPOS e OpenAI são opcionais no código, mas permanecem **fail-closed** quando não há credenciais ou homologação. Os requisitos de cada provedor estão em [docs/external-dependencies.md](./docs/external-dependencies.md).

## Comandos de qualidade

| Comando | Quando usar |
| --- | --- |
| `pnpm lint` | Formatação e regras estáticas de todos os workspaces |
| `pnpm typecheck` | Verificação TypeScript |
| `pnpm test` | Testes dos workspaces e gates de produção |
| `pnpm build` | Build de todos os pacotes e aplicações |
| `pnpm check` | Lint + tipos + testes + build; gate local completo |
| `pnpm test:e2e` | Jornada pública e acessibilidade com servidores de teste |
| `pnpm test:e2e:real-ui` | Jornadas operacionais da UI |
| `pnpm test:load:smoke` | Smoke do harness de carga em ambiente local descartável |
| `pnpm db:generate` | Gera migration após alteração do schema |
| `pnpm db:migrate` | Aplica migrations no banco configurado |
| `pnpm db:seed` | Popula dados de desenvolvimento; não execute em produção |
| `pnpm openapi:generate` | Regenera a especificação OpenAPI |
| `pnpm clients:generate:ts` / `pnpm clients:generate:csharp` | Regenera clientes a partir do OpenAPI |

Alterações em dinheiro, autorização, tenant, concorrência, schema ou contrato exigem o teste correspondente e a regeneração dos artefatos derivados. Para uma alteração localizada, rode primeiro o check do workspace afetado, por exemplo `pnpm --filter @giromesa/site lint`.

## CI e publicação de imagens

Cada pull request e cada push para `main` executam o workflow [CI](./.github/workflows/ci.yml), que instala com lockfile imutável, aplica migrations PostgreSQL, verifica supply chain, executa lint/tipos/testes/build, valida OpenAPI e clientes, roda E2E, testa o Edge Hub/.NET e valida Terraform.

Após um CI verde em `main`, o workflow [Publish pilot images](./.github/workflows/publish-images.yml) constrói as cinco imagens, publica-as no GHCR por digest e gera atestação assinada. A publicação de imagem não substitui a promoção na VPS.

## Deploy e rollback na VPS

O deploy produtivo usa releases imutáveis, backup completo, migrations, healthchecks e promoção atômica. Siga exclusivamente o [runbook de deploy da VPS](./deploy/vps/README.md) e os [níveis de release](./docs/runbooks/release-levels.md).

Regras essenciais:

- não execute `docker compose down -v` na VPS;
- não promova uma imagem apenas porque ela está saudável localmente;
- não altere o `.env` durante o backup pré-migration;
- mantenha manifesto, bundle Sigstore, checksum e release de recovery juntos;
- execute deploy e rollback somente pelo entrypoint confiável documentado no runbook.

Para incidentes, consulte [resposta a incidentes](./docs/runbooks/incident-response.md) e [recuperação de desastre](./docs/runbooks/disaster-recovery.md).

## Segurança e limites conhecidos

- Frontends não acessam o banco diretamente; organização e unidade são validadas pela API após validar membership.
- Sessões usam cookies HttpOnly e as operações sensíveis exigem MFA/permissões adequadas.
- Dados públicos de mesa usam token curto validado no backend; não coloque segredos em URLs, logs ou documentação.
- O site comercial só publica preço, oferta, prazo de teste e documentos quando o catálogo estiver publicado e validado; sem catálogo, ele falha de forma segura.
- Cookies não essenciais dependem de consentimento explícito, e os termos/privacidade publicados devem acompanhar a versão comercial vigente.
- O teste de carga deve ocorrer em staging descartável com recursos equivalentes. Não dispare uma carga de 200 mesas contra a VPS do piloto.
- Evidências versionadas de prontidão e suas limitações ficam em [docs/evidence](./docs/evidence). Elas não substituem homologação fiscal, de provedor ou de hardware.

## Contribuindo

1. Leia [PROJECT_MAP.md](./PROJECT_MAP.md) e [AGENTS.md](./AGENTS.md) antes de alterar uma fronteira do monorepo.
2. Reutilize contratos, permissões, escopo de tenant e componentes de `packages/ui`; não crie mocks para substituir a verdade do backend.
3. Faça a menor alteração segura, atualize migrations/clientes/documentação quando aplicável e execute o check proporcional.
4. Antes de abrir o pull request, rode pelo menos `pnpm lint`, `pnpm typecheck` e o teste/build do workspace afetado. Mudanças transversais devem passar por `pnpm check`.

Documentos operacionais importantes:

- [Integração DoseClub](./docs/runbooks/doseclub-reconciliation.md)
- [Back office da plataforma](./docs/runbooks/platform-backoffice.md)
- [Homologação do salão](./docs/runbooks/salon-production-homologation.md)
- [SmartPOS](./docs/runbooks/smartpos.md)
- [Resposta a vulnerabilidades](./docs/runbooks/vulnerability-response.md)
