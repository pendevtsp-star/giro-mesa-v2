# GiroMesa V2 — Plano executável

## Objetivo

Construir do zero uma plataforma brasileira de gestão de food service, com um núcleo único para salão e balcão, experiências por função, operação offline por unidade, teste assistido de 14 dias e evolução posterior para delivery, redes e integrações.

O V1 em `C:\Users\maxue\projetos_programação\giro_mesa` é somente referência funcional e não deve ser alterado nem copiado de forma automática.

## Arquitetura decidida

- Monorepo pnpm/Turborepo.
- `apps/site`: Next.js para marketing, planos, contato e solicitação de teste.
- `apps/customer`: Next.js para cardápio e pedidos públicos por QR.
- `apps/ops`: React/Vite para a experiência operacional.
- `apps/api`: NestJS/Fastify modular monolith com REST/OpenAPI e WebSocket.
- `apps/worker`: processamento de outbox e tarefas usando PostgreSQL.
- `apps/edge-hub`: .NET 10 Windows Service com SQLite criptografado, sincronização, impressão, PayGo e Focus.
- `apps/ops-shell`: .NET MAUI 10 HybridWebView carregando o bundle React.
- PostgreSQL/Drizzle, isolamento multi-tenant e auditoria append-only.
- AWS `sa-east-1` como destino de produção; ambiente local em Docker Compose.

## Modelo e contratos

- Identidade global separada de `Organization`, `Membership`, `Unit`, `LegalEntity` e `RoleBinding`.
- Dinheiro em centavos; datas em UTC; timezone configurado na unidade.
- Todo comando operacional usa identificador idempotente, organização, unidade, ator, dispositivo, versão e horário de ocorrência.
- Transições de estado, aprovações e permissões pertencem ao backend.
- Catálogo comercial versionado com planos Operação, Crescimento e Rede.
- Checkout, cliente do provedor, assinatura, cobrança e evento de pagamento são entidades distintas.

## Ondas

### Fundação

- Design system, identidade visual, CI, ambientes, observabilidade e documentação.
- Autenticação, MFA, organizações, unidades, convites, dispositivos e permissões.
- Catálogo comercial, onboarding, cobrança e backoffice da plataforma.
- OpenAPI e clientes gerados para TypeScript e C#.
- Hub local, pareamento, outbox e sincronização idempotente.

### Piloto

- Catálogo, adicionais, fichas técnicas, alergênicos, preços e disponibilidade.
- Salão, balcão, mesas, comandas, divisão, união, transferência, taxa de serviço e gorjetas.
- Garçom, caixa, KDS, impressão, senhas e aprovações por PIN.
- Estoque, perdas, inventários, fornecedores, compras e recebimentos.
- Contas a pagar/receber, fluxo, conciliação e relatórios.
- QR para cardápio, pedido, chamar garçom e pedir conta.
- PayGo, Focus NFC-e, escalas, ponto, comissões e assistente de ajuda.
- Operação offline por um turno de oito horas.

### Crescimento

- Delivery e retirada próprios, áreas, taxas, agenda, despacho e pagamento online.
- Reservas, fila, no-show, fidelidade, cupons, campanhas e WhatsApp oficial.
- Integrações homologadas, conciliação e rentabilidade por canal.

### Escala

- Multiunidade, catálogos e preços por unidade, transferências e consolidação.
- API pública, webhooks, autoatendimento e integrações com contabilidade/folha.
- DoseClub como adaptador isolado.

## Regras comerciais

- Teste assistido de 14 dias, sem cartão, iniciado somente após ativação operacional.
- Operação: R$149/mês, uma unidade e núcleo completo, com fiscal como adicional.
- Crescimento: R$299/mês, canais, automações e relacionamento avançado.
- Rede: R$499/mês, até três unidades, consolidação, API e SLA prioritário.
- Anual custa dez mensalidades; usuários e dispositivos são ilimitados por unidade.
- Catálogos têm estados `draft`, `published` e `discontinued`; contratos ativos ficam vinculados à versão adquirida.

## Gates de qualidade

- Testes unitários de domínio, integração com PostgreSQL real, contratos OpenAPI e E2E Playwright.
- Testes do hub, bridge nativa, sincronização, falhas, reinício e oito horas offline.
- Homologação real de PayGo, Focus, impressoras e pinpad antes de alegar prontidão.
- Zero perda/duplicidade de pedidos, pagamentos e documentos fiscais.
- Zero vazamento entre organizações, WCAG 2.2 AA e restauração de backup comprovada.
- Piloto aprovado após 14 turnos consecutivos sem Sev1 e conciliação integral.

## Dependências externas esperadas

- Contratos, credenciais e hardware PayGo.
- Credenciais Focus, certificado A1, CSC e dados fiscais da unidade piloto.
- Contas e credenciais Asaas, Google OAuth, AWS, e-mail, WhatsApp e OpenAI.
- Dados reais do estabelecimento piloto e revisão jurídica dos documentos LGPD.
