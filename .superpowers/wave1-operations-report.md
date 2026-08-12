# GiroMesa — Onda 1B: relatório de operações

Data: 2026-08-11  
Branch de revisão: `codex/giromesa-wave1-operations-review-fix`
Base da revisão: `9d9605a` (a implementação original partiu de `c899c48`)
Escopo executado: Tasks 13–21 e todos os bloqueadores da revisão final. Tasks 22+ não foram iniciadas.

## Resultado

A Onda 1B foi implementada de ponta a ponta: publicação imutável do cardápio com mídia recodificada, máquina de ocupação com CAS/epoch, APIs e canvas do salão, sessão QR vinculada à ocupação, chamados e parcial, ledger de dispatch por destino, KDS operacional e endurecimento do Edge Hub. As únicas migrações criadas foram `0017`, `0018` e `0019`.

Não houve push, deploy, uso de providers reais nem alteração de integrações externas.

## Commits recuperáveis

| Task | Commit | Entrega |
| --- | --- | --- |
| 13 | `ad83d02` | `feat(menu): publish immutable branded versions` |
| 14 | `1b21d20` | `feat(salon): formalize occupancy state machine` |
| 15 | `19e6538` | `feat(salon): expose versioned operational map APIs` |
| 16 | `4c40ca5` | `feat(ops): deliver structured salon map canvas` |
| 17 | `3226990` | `feat(qr): bind public sessions to occupancy epoch` |
| 18 | `419ae83` | `feat(service): route table calls and current partial` |
| 19 | `ff41315` | `feat(dispatch): persist destination delivery ledger` |
| 20 | `c5dc792` | `feat(kds): ship distance-first production board` |
| 21 | `2ff6bd1` | `feat(edge): harden identity and recovery` |
| Fechamento | `1a6ad6d` | `fix(contracts): regenerate operations clients` |
| Fechamento | `5b036fb` | `fix(menu): clear focused lint warnings` |
| Revisão | `ca4bace` | `fix(operations): execute dispatch effects through edge` |
| Revisão | `eba443a` | `fix(customer): require signed table capabilities` |
| Revisão | `c097c05` | `fix(security): harden edge tls media and grants` |
| Revisão final | `dbd96a3` | `fix(dispatch): recover uncertain cloud and edge delivery` |
| Revisão final | `1bcfc45` | `fix(kds): consume durable edge dispatch inbox` |
| Revisão final | `06c4998` | `fix(table-calls): close capability and epoch races` |
| Revisão final | `78ac1b9` | `fix(db): enforce operational state machines` |
| Revisão final | `1608ec3` | `fix(contracts): type operational authorization headers` |
| Revisão final | `0c72b48` | `test(db): verify operations upgrade on supported postgres` |
| Revisão final | `b1c03c5` | `test(customer): reject unsigned table actions` |

## Fechamento dos bloqueadores da revisão

- O worker da nuvem materializa cada attempt pendente como `dispatch.effect.execute`; o Edge só confirma o comando depois de persistir e processar o efeito. Outcomes retornam por endpoint autenticado e dirigem transições monotônicas, retry, ack e DLQ.
- Comando cloud expirado e não confirmado é recuperado de forma idempotente para DLQ mesmo sem Hub online. Claim Edge abandonado por crash é convertido em outcome `dlq`, sem replay ambíguo do side effect e sem deixar attempt em `executing`.
- O KDS visível no Ops combina snapshot operacional e inbox durável do Edge, associa cada efeito a um ticket local antes de renderizar e só então envia ACK. Falha/offline preserva o mesmo ACK em fila local para replay; payload sem ticket correspondente falha fechado. Impressão usa a fila RAW real do Windows e só responde `spooled` após `WritePrinter`.
- O endpoint inseguro `/public/v1/menus/:slug/commands` foi removido do controller, OpenAPI e clientes. Ações de mesa passam somente pela sessão QR assinada e por capabilities revalidadas.
- Chamados usam lock transacional por organização, unidade, occupancy, epoch e kind. Sessão, configuração de capabilities e occupancy são revalidadas sob row locks na mesma transação; nonce, rate limit, cooldown, chamada, eventos, outbox e receipt idempotente são gravados atomicamente. O fingerprint inclui `occupancyId`, epoch e kind.
- Owner/manager configuram `call_waiter`, `request_bill` e `view_partial` por unidade com CAS. Tokens novos recebem somente capabilities habilitadas, tokens existentes são revalidados contra a configuração atual e o Customer não renderiza ações ausentes.
- O Edge abre listener HTTPS com certificado de servidor próprio. Certificado cliente da nuvem e pins dos dispositivos são configurações separadas e não podem reutilizar thumbprint; configuração incompleta, endpoint cloud HTTP ou plataforma de impressão incompatível falham no startup/uso.
- Grants de `0018` e `0019` foram reduzidos por verbo e coluna. Occupancies, sessões públicas, chamados, efeitos e DLQ não têm `UPDATE` de tabela; somente colunas de transição têm grant. Cinco triggers impõem imutabilidade, CAS/version, epochs e estados monotônicos. Events, receipts, attempts, acknowledgements e outcomes permanecem append-only.
- Quota de mídia é calculada sob advisory lock na mesma transação do insert. Asset público exige slug ativo e referência na versão publicada. Preview deixou de aceitar token em query string e usa `x-preview-token`.

## TDD e gates focados

Cada task começou pelo teste focal em RED e foi levada a GREEN antes do commit:

- Task 13: publicação CAS/imutável, isolamento tenant, upload com recodificação e rejeição de MIME divergente.
- Task 14: transições exclusivas de ocupação, epoch obrigatório e CAS concorrente.
- Task 15: layout versionado e imutável, atribuições, leases/presença e exceções com escopo.
- Task 16: mapa com busca, estado redundante, navegação espacial, teclado e touch.
- Task 17: token assinado, nonce, expiração/revogação/rate limit e vínculo ao epoch atual.
- Task 18: roteamento primary/support/fallback, idempotência, estados do chamado e parcial somente da ocupação corrente.
- Task 19: efeito exatamente uma vez por destino, attempts/ack/reprint/cancel, contingência, DLQ e reconciliação.
- Task 20: prioridade/SLA redundantes, filtros de estação, undo curto, estados online/degradado/offline e legibilidade a distância.
- Task 21: mTLS com pin SHA-256, identidade monotônica, revogação, clone/rollback, disco/clock fail-closed, backup SQLCipher assinado e recuperação.

Gates finais executados:

- Domain: `35/35` testes, typecheck e build verdes.
- Database: `3` testes ativos verdes e `1` integração condicional ignorada sem `TENANT_ISOLATION_DATABASE_URL`; typecheck/build verdes.
- API: `148` testes, `99` ativos verdes e `49` integrações condicionais ignoradas no gate amplo sem seus bancos dedicados; build e typecheck verdes. Os checkpoints PostgreSQL dedicados executaram os focos de dispatch/table-call/RLS em PG16 e PG17.
- Integrações PostgreSQL da onda: `6/6` verdes, serializadas, cobrindo menu, ocupação, salão, QR, serviço e dispatch.
- Ops: `57/57` testes, typecheck e build verdes.
- Customer: `13/13` testes, typecheck e build verdes.
- Edge Hub: `79/79` testes verdes, sem ignorados. Ops Shell e cliente C# compilaram com zero warnings/erros.
- Playwright operacional: `6/6` verdes para sessão pública assinada, mapa desktop/tablet e KDS desktop/tablet/POS/wall. A trilha pública adicional passou `14/14` em desktop/mobile e confirma ausência de ações de mesa sem sessão assinada.
- OpenAPI e clientes: documento atual gerado; cliente TypeScript tipa todos os headers obrigatórios e o C# expõe value objects tipados para table-call, parcial e dispatch outcomes.
- Qualidade focada: Biome lint sem erros em API, Ops, Customer, Domain e DB; contrato gerado formatado; `git diff --check` verde.

## Banco, RLS e concorrência

- Instalação fresca `0000–0019`: verde em PostgreSQL 16 e 17.
- Upgrade de uma base `0017` para `0019`: verde em PostgreSQL 16 e 17; o teste recria a base isolada, aplica o baseline até `0017`, executa `0018`/`0019` e confirma RLS forçado, grants por coluna e cinco state machines.
- Migrações reservadas usadas: `0017_public_menu_branding.sql`, `0018_operational_map.sql` e `0019_dispatch_ledger.sql`.
- As `25/25` tabelas introduzidas têm `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
- Gate negativo: com role `giromesa_app` e IDs de tenant alheios, consultas às ocupações e efeitos de dispatch retornaram zero linhas enquanto havia dados na base.
- Os testes PostgreSQL focados exercitaram publicação e ocupação concorrentes, idempotência, epoch/CAS, capability TOCTOU, rate limit e exatamente-uma-vez do dispatch.
- O gate de grants confirmou por SQL que ledgers append-only não concedem `UPDATE`/`DELETE` e que as cinco tabelas mutáveis críticas não concedem `UPDATE` de tabela. Tentativas diretas como `giromesa_app` de alterar campos imutáveis falharam por permissão.
- Journal merge: os tags e timestamps reservados de `0017`, `0018` e `0019` foram preservados. Os fixes alteraram apenas o conteúdo ainda não entregue de `0018`/`0019`; nenhum `0020+` foi criado.

## UI e revisão Impeccable

O mapa e o KDS passaram pelo detector mecânico uma única vez e por uma rodada visual agrupada em desktop, tablet, POS e wall display. As abas laterais inicialmente sinalizadas pelo detector foram removidas; os estados permanecem redundantes por texto, ícone, cor e borda. Não foram adicionados gradientes.

## Observações e limites honestos

- A primeira geração OpenAPI revelou a injeção implícita do `TableSessionCodec`; ela foi tornada explícita e coberta novamente pelo teste PostgreSQL antes da regeneração final.
- Kiota concluiu com sucesso, mas mantém warnings do próprio gerador para formatos OpenAPI `email`/`uri` e para os tipos de erro `400/422` do endpoint de sync.
- O `biome check` amplo dos pacotes ainda acusa a formatação CRLF já presente em muitos arquivos não alterados; os gates semânticos focados (`biome lint`) não têm erros. O Ops mantém warnings de especificidade/`!important` no stylesheet compartilhado, sem erro de lint.
- A validação do Edge cobre software, KDS local durável, boundary HTTPS/mTLS, spooler RAW e recuperação automatizada. Certificados emitidos para o estabelecimento, confirmação de papel impresso, falha real de disco/relógio e ensaio de reinstalação permanecem validações de ambiente, não simuladas como concluídas.
- Nenhum provider real, impressora física, dispositivo POS real, push ou deploy foi usado neste escopo. O teste do printer comprova fail-closed fora do Windows e o teste do processor comprova exactly-once até a fronteira do adapter; não alega impressão física.
