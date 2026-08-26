# Evidência de prontidão do piloto — 2026-08-26

## Parecer executivo

**Decisão técnica:** **GO controlado para o piloto do núcleo operacional** na release `cbf66cd4a8553d8a732157fbf5e4575cb2ea4ce7`. É **NO-GO para liberar todas as integrações e alegar capacidade de 200 mesas/20 garçons** enquanto os bloqueios deste documento permanecerem.

O núcleo operacional foi validado localmente, em CI, com PostgreSQL real e no runtime público da VPS. Isso não equivale a homologar provedores, terminal físico, emissão fiscal em produção ou capacidade de carga na VPS do piloto.

## Escopo auditado e alterado

- Landing, consentimento de cookies, termos e privacidade passaram a consumir o catálogo comercial publicado. A página não inventa prazo de teste nem preço quando o catálogo está indisponível.
- O identificador de visitante só é criado apó consentimento e é removido quando a decisão é rejeitada ou redefinida.
- O botão `Entrar` e os CTAs de teste levam aos fluxos reais de login e solicitação; planos mantêm a atribuição comercial.
- A API não publica OpenAPI em `NODE_ENV=production`; o ingress bloqueia os webhooks internos do Evolution Go e adiciona cabeçalhos de segurança.
- O backoffice ganhou concessão auditada e idempotente de seis meses gratuitos por organização. Somente administrador com `billing:write` e MFA pode executar a operação.
- A concessão trava o tenant e a assinatura em transação, usa advisory lock, estende a partir do fim de um trial ainda ativo e nunca reduz uma vigência existente.
- OpenAPI e clientes TypeScript/C# foram regenerados com o novo contrato.
- O bootstrap/runtime da VPS passou a validar roles, segredo QR, diretório de mídia, tolerância SmartPOS, URLs de lojas e homologação de e-mail de relatórios; chaves obsoletas são removidas atomicamente.
- README e runbook de administrador foram alinhados à arquitetura, ao deploy e ao processo real de criação da conta administrativa.

## Refatoração e higiene

Foram aplicadas apenas correções de causa raiz em pontos compartilhados. Não foram divididos, antes do piloto, os grandes fluxos operacionais `CatalogExperience`, `SalonPage`, `CounterWorkspace`, `PeoplePage` e `KdsPage`: a mudança seria ampla, sem ganho funcional imediato e com risco de regressão maior que o benefício.

As varreduras não encontraram segredos versionados. Artefatos de build/teste continuam ignorados pelo Git e foram removidos do checkout ao final. Migrations, clientes gerados, evidências de recovery, runbooks e wiki arquitetural foram preservados por serem parte do build ou da operação segura.

## Evidências executadas

| Camada | Resultado |
| --- | --- |
| Check global (`pnpm check`) | aprovado nos 9 workspaces; lint, tipos, testes e builds |
| API | 248 testes aprovados; 29 testes condicionais ignorados nessa execução |
| Integração PostgreSQL dirigida | 10/10 arquivos aprovados, incluindo piloto, DoseClub, caixa, estoque/NF-e, pessoas, KDS, SmartPOS, POS e QR |
| Backoffice | 264/264 testes e build aprovados |
| Site | 20/20 testes, tipos, lint e build aprovados |
| Jornada pública E2E corrigida | 10/10 em desktop e mobile |
| Salão com API e PostgreSQL reais | 1/1: organização, unidade, trial, espaços, mesas, praça, turno, cardápio, pedidos, união, divisão, conta e impressão |
| Caixa com API e PostgreSQL reais | 1/1 aprovado |
| Cliente C# gerado | build com zero erro e zero aviso |
| Deploy hardening | 27/27 |
| Baseline de produção | 17/17 |
| Supply chain | 14/14 |
| Modelo do harness de carga | 15/15 |
| Dependências de produção | nenhuma vulnerabilidade conhecida de severidade alta/crítica |
| Varredura de segredos no GitHub | checkout e histórico completos aprovados; o recurso nativo `secret scanning` do repositório está desabilitado |
| CI final | aprovado: 25 E2E aprovados, 11 condicionais ignorados; demais jobs verdes |
| Runtime pós-promoção | release ativa, migração `0074`, aplicação saudável e smoke público aprovado |

Os avisos remanescentes do CI são de depreciação do runtime Node 20 de actions e quatro sugestões `xUnit2031` em testes existentes; não representam falha funcional desta release, mas devem entrar na manutenção do pipeline.

## Conta administrativa root

O e-mail `pendevtsp@gmail.com` está mapeado para a role de plataforma `admin` na configuração da VPS. Não foi criada uma senha compartilhada ou gravada no `.env`, pois isso introduziria credencial permanente e retiraria o aceite pessoal dos termos.

Procedimento correto:

1. Cadastrar ou recuperar a conta `pendevtsp@gmail.com` pelo fluxo público normal.
2. Verificar o e-mail e aceitar pessoalmente os termos vigentes.
3. Ativar TOTP/MFA.
4. Entrar novamente; a API resolve a role `admin` pelo e-mail normalizado.
5. Usar o backoffice para selecionar a organização piloto e conceder seis meses. Repetições com a mesma chave de idempotência não duplicam a operação.

## Estado do `.env` da VPS

O arquivo `/srv/apps/giromesa-v2/shared/.env` permanece `0600`, `root:root`. O hardening preservou valores existentes, adicionou defaults seguros e removeu `COOKIE_DOMAIN`, `CUSTOMER_QA_DEMO_SLUG`, `NEXT_PUBLIC_DEMO_HUB_ACK` e `VITE_DEMO_MODE`. Nenhum valor secreto foi copiado para esta evidência.

Valores ainda ausentes/vazios:

- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_SECRET`: cobrança real Asaas.
- `OPENAI_API_KEY`: recursos de IA.
- `FOCUS_NFE_PRIMARY_TOKEN`: integração Focus em homologação; produção exige evidência fiscal adicional.
- `DOSECLUB_PROVISIONING_KEY`: deve ser o mesmo segredo aleatório, com no mínimo 32 caracteres, no GiroMesa e no DoseClub.
- `NEXT_PUBLIC_WHATSAPP_NUMBER`: CTA comercial direto para WhatsApp.
- `EVOLUTION_OPERATOR_EMAIL`: identidade operacional da integração Evolution.

Adicionar esses valores habilita configuração, mas **não substitui homologação** de webhook, provedor, hardware ou ambiente fiscal.

## DoseClub

O serviço DoseClub respondeu `200` em `/v1/health`. Os testes conjuntos de provisionamento, reserva, consumo, commit e compensação foram aprovados localmente com PostgreSQL.

A integração de produção **não está operacional**. O endpoint M2M esperado, `/v1/integrations/giromesa/health`, responde `404` diretamente no container e pelo domínio público; sem credenciais, o contrato implantado correto deveria existir e responder `401`. O código local do DoseClub contém essa implementação, mas está em alterações não versionadas e não faz parte da imagem atualmente implantada (`pilot-3a952fe95ddf254405f92f2cee9bea0e68a2b1c8`). Antes de liberar, é necessário versionar e publicar a implementação no repositório proprietário do DoseClub, executar suas migrations, configurar a chave compartilhada, cadastrar tenant/unidade/produto/ml e realizar homologação conjunta.

## Carga e confiabilidade

Não foi disparada carga sintética destrutiva de 200 mesas e 20 garçons contra a mesma VPS do piloto. O runbook proíbe target/spike/soak nesse host para evitar degradar o ambiente que o cliente usará. O harness e seu modelo passaram em 15/15, e a fixture oficial suporta 500 mesas, 50 terminais e 2.000 sessões QR, mas isso **não é evidência de latência ou capacidade real**.

Antes de assumir capacidade, execute o perfil solicitado em staging descartável, com a mesma composição e recursos da VPS, medindo p95/p99, erros, locks, CPU, memória, conexões PostgreSQL e recuperação. Até isso ocorrer, a capacidade de 200 mesas/20 garçons permanece **não homologada**.

## Critério de liberação

- **Piloto do núcleo operacional:** GO controlado, com acompanhamento e backup/recovery disponíveis.
- **Cobrança real, IA, fiscal, WhatsApp/Evolution e DoseClub:** não liberar enquanto as credenciais e homologações correspondentes estiverem ausentes.
- **SmartPOS/TEF, impressora 58/80 mm e NF-e em produção:** exigem prova em equipamento/provedor e, no caso fiscal, homologação Focus/SEFAZ.
- **Capacidade 200 mesas/20 garçons:** não homologada sem ensaio em staging.

Adicionar os segredos listados ao `.env` é necessário, mas **não deixa sozinho o sistema integralmente pronto**: ainda faltam ativação e teste de webhooks/provedores, publicação do contrato M2M do DoseClub, ensaio de carga em staging e homologações física e fiscal. Se o piloto usar apenas o núcleo operacional já validado, a liberação pode prosseguir de forma controlada.

## Evidência do runtime e da promoção

- Release ativa: `/srv/apps/giromesa-v2/releases/cbf66cd4a8553d8a732157fbf5e4575cb2ea4ce7`.
- As cinco imagens GiroMesa foram verificadas por digest e assinatura antes da promoção.
- A tabela de migrations possui como último `created_at` `1787709600000`, correspondente à migration `0074_crm_operational_inbox`; o deploy também confirmou readiness fiscal e de storage.
- Backup completo criado em `/srv/apps/giromesa-v2/backups/20260826T195542Z-8f0f938498033807a5c3328a62ecdfcd`.
- API, worker, site, customer, Ops, PostgreSQL, Evolution Go, banco Evolution e ClamAV estão saudáveis; o coletor OpenTelemetry está em execução sem healthcheck próprio. Os cinco containers da release têm `RestartCount=0`.
- O Evolution Go mantém `RestartCount=1`, decorrente da restauração manual após o incidente de disco, e permaneceu saudável com probes `200` contínuos durante a observação final.
- Landing, `/login`, `/teste-gratis`, `/privacidade`, `/termos`, API health e Ops responderam `200`. A rota administrativa sem sessão respondeu `401`.
- `/openapi.json`, `/api/v1/openapi.json` e as duas variantes públicas do webhook Evolution responderam `404`.
- HSTS, `nosniff`, `SAMEORIGIN`, política de referrer e Permissions Policy foram confirmados publicamente.
- O `.env` permaneceu `0600`, proprietário `root:root`.

## Incidentes e riscos residuais da VPS

A primeira promoção falhou durante a extração de imagem por falta de espaço. A release anterior continuou apontada, mas alguns containers haviam parado; eles foram restaurados e voltaram saudáveis antes de qualquer nova tentativa. Foram excluídas somente referências de imagens históricas do GiroMesa que não eram usadas por containers nem pelas releases atual, alvo e de recuperação. Volumes, imagens de outros sistemas e dados não foram removidos. A segunda promoção foi concluída, e o disco terminou com 35 GiB livres, 64% de uso.

O `nginx -t` passou e o certificado foi reaplicado. A configuração global da VPS ainda emite avisos preexistentes de nomes duplicados de `useorien.com.br` e opções TLS repetidas em outros sites; eles não impediram o ingresso GiroMesa nem seus testes, mas merecem manutenção separada para evitar ambiguidade futura nos demais produtos hospedados.
