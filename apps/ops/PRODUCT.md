# GiroMesa Ops

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Proprietarios e gerentes de estabelecimentos de food service, experientes ou iniciantes, usam o Ops durante a configuracao e a operacao real da unidade. Outros perfis operacionais acessam apenas as areas autorizadas para seu trabalho.

## Product Purpose

O GiroMesa conecta configuracao, salao, balcao, catalogo, equipe, producao, caixa e gestao em uma unica verdade operacional. No onboarding, sucesso significa chegar a uma unidade verificavel, concluir os 12 requisitos confirmados pelo servidor e so entao iniciar o trial de 14 dias.

## Positioning

Uma plataforma cloud-first que mantem PostgreSQL como autoridade final e usa configuracao versionada, capability flags e adapters estaveis para acomodar operacoes distintas sem criar excecoes por cliente. Efeitos de negocio sao idempotentes e auditaveis; estados locais nunca substituem confirmacao do servidor.

## Operating Context

- Uso em restaurantes, bares e operacoes de food service, em desktop, tablet e celular, inclusive durante turnos com conectividade degradada.
- O onboarding cobre negocio, unidade, plano, escolha fiscal, catalogo, mesas, equipe, QR, rota de producao, caixa, treinamento e ensaio operacional.
- Recursos configurados em outras areas devem ser criados nessas areas e revalidados ao retornar ao onboarding.
- O usuario pode sair, explorar o restante do sistema quando autorizado e continuar depois sem perder o estado persistido.

## Capabilities and Constraints

- O servidor e a fonte unica para readiness, selecao, bloqueios, evidencias, ativacao e acompanhamento da saga.
- Onboarding e mutacoes sao restritos a owner e manager; dispensa e reselecao seguem autorizacao e auditoria do backend.
- Fiscal admite `disabled`, `focus` ou `external`; QR pode exigir dispensa auditavel; producao admite `off`, `kds`, `print` ou `both` sem fabricar estacoes, perfis ou testes.
- O trial comeca somente depois de `ready=true` e `missingItems=[]`, no commit final idempotente da saga.
- O produto nao armazena no onboarding cookie, token de sessao, PIN, credencial fiscal, segredo ou payload arbitrario de evidencia.
- O GiroMesa e cloud-first. Edge Hub e opcional e necessario para continuidade multi-terminal offline, impressao automatica e integracoes locais.
- SmartPOS, PayGo, fiscal, KDS, impressao, notificacoes e DoseClub dependem de adapters e niveis explicitos de prontidao. Build verde ou HTTP 200 nao significa homologacao.

## Brand Commitments

- Nome GiroMesa e linguagem operacional direta em PT-BR.
- Interface propria sem emojis; icones pertencem a uma unica familia visual e nunca substituem rotulos acessiveis.
- Operacao prioriza estabilidade, velocidade, clareza de estado e recuperacao. Movimento premium pertence ao contexto comercial, nao ao fluxo operacional.

## Evidence on Hand

- Design de producao aprovado em `../../docs/plans/2026-08-10-giromesa-production-design.md`.
- Plano de implementacao aprovado em `../../docs/plans/2026-08-10-giromesa-production-implementation.md`.
- Contrato OpenAPI gerado em `../../packages/contracts/src/generated-api.ts`.
- Saga de provisionamento, checklist persistido, RLS, auditoria e idempotencia da Task 7 estao implementados no backend.
- Nao ha evidencia neste repositorio de clientes, metricas comerciais, hardware homologado ou provedores reais configurados; esses fatos nao devem ser inventados.

## Product Principles

1. O servidor confirma; a interface explica e orienta.
2. Uma acao primaria por contexto, com impacto e recuperacao visiveis.
3. Sem sucesso aparente antes da evidencia operacional real.
4. Autorizacao, tenant e unidade permanecem explicitos em toda mutacao.
5. A configuracao pode ser retomada sem duplicar efeitos ou perder auditoria.

## Accessibility & Inclusion

WCAG 2.2 AA, navegacao completa por teclado, foco visivel, alvos de toque de pelo menos 44 px, estados que nao dependem apenas de cor, suporte a 360 px e respeito a `prefers-reduced-motion`.

## Open Decisions

- Provedores, SDKs, equipamentos, rede e roteiro de homologacao reais para SmartPOS, PayGo, Focus, impressoras, KDS e Edge Hub.
- Ambiente e chaves reais para integracao conjunta com DoseClub.
- Infraestrutura de alta disponibilidade e evidencias externas necessarias para os niveis `pilot-approved` e `production-approved`.
