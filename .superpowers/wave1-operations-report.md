# GiroMesa — Onda 1B: relatório de operações

Data: 2026-08-11  
Branch: `codex/giromesa-wave1-operations`  
Base: `c899c48`  
Escopo executado: Tasks 13–21, em ordem. Tasks 22+ não foram iniciadas.

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

## Fechamento dos bloqueadores da revisão

- O worker da nuvem materializa cada attempt pendente como `dispatch.effect.execute`; o Edge só confirma o comando depois de persistir e processar o efeito. Outcomes retornam por endpoint autenticado e dirigem transições monotônicas, retry, ack e DLQ.
- O KDS recebe uma inbox local durável e exige ack explícito. Impressão usa a fila RAW real do Windows e só responde `spooled` após `WritePrinter`; plataforma, fila ou escrita indisponível falham fechadas. O claim persistido anterior ao side effect impede reexecução automática após crash ambíguo.
- O endpoint inseguro `/public/v1/menus/:slug/commands` foi removido do controller, OpenAPI e clientes. Ações de mesa passam somente pela sessão QR assinada e por capabilities revalidadas.
- Chamados usam lock transacional por organização, unidade, occupancy, epoch e kind. Nonce, cooldown, chamada, eventos, outbox e receipt idempotente são gravados atomicamente; chamadas concorrentes convergem para um único chamado.
- Owner/manager configuram `call_waiter`, `request_bill` e `view_partial` por unidade com CAS. Tokens novos recebem somente capabilities habilitadas, tokens existentes são revalidados contra a configuração atual e o Customer não renderiza ações ausentes.
- O Edge abre listener HTTPS com certificado de servidor próprio. Certificado cliente da nuvem e pins dos dispositivos são configurações separadas e não podem reutilizar thumbprint; configuração incompleta, endpoint cloud HTTP ou plataforma de impressão incompatível falham no startup/uso.
- Grants de `0018` e `0019` foram reduzidos por verbo. Events, receipts, attempts, acknowledgements e outcomes permanecem `SELECT, INSERT`, sem `UPDATE`/`DELETE`, e as consultas quentes ganharam índices focados.
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
- API: `143` testes, `94` ativos verdes e `49` integrações condicionais ignoradas sem seus bancos dedicados; build verde. O checkpoint PostgreSQL adicional executou `6/6` testes focados da revisão.
- Integrações PostgreSQL da onda: `6/6` verdes, serializadas, cobrindo menu, ocupação, salão, QR, serviço e dispatch.
- Ops: `54/54` testes, typecheck e build verdes.
- Customer: `13/13` testes, typecheck e build verdes.
- Edge Hub: `78/78` testes verdes, sem ignorados.
- Playwright focado da revisão: `3/3` verdes para sessão pública e mapa desktop/tablet; os gates visuais anteriores de KDS não foram alterados.
- OpenAPI e clientes: documento atual gerado; clientes TypeScript e C# regenerados.
- Qualidade focada: Biome lint sem erros em API, Ops, Customer, Domain e DB; contrato gerado formatado; `git diff --check` verde.

## Banco, RLS e concorrência

- Instalação fresca `0000–0019`: verde em PostgreSQL 16 e 17, journal `19/19` em ambos.
- Upgrade de uma base no journal `17` para `0019`: verde em PostgreSQL 16 e 17, journal `19/19` e sentinel preservado em ambos.
- Migrações reservadas usadas: `0017_public_menu_branding.sql`, `0018_operational_map.sql` e `0019_dispatch_ledger.sql`.
- As `25/25` tabelas introduzidas têm `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
- Gate negativo: com role `giromesa_app` e IDs de tenant alheios, consultas às ocupações e efeitos de dispatch retornaram zero linhas enquanto havia dados na base.
- Os testes PostgreSQL focados exercitaram publicação e ocupação concorrentes, idempotência, epoch/CAS e exatamente-uma-vez do dispatch.
- O gate de grants confirmou por SQL que ledgers append-only não concedem `UPDATE`/`DELETE`; uma tentativa direta como `giromesa_app` falhou por permissão. Com dados existentes, contexto de outro tenant retornou `0|0` para chamados e efeitos.
- Journal merge: os tags e timestamps reservados de `0017`, `0018` e `0019` foram preservados. Os fixes alteraram apenas o conteúdo ainda não entregue de `0018`/`0019`; nenhum `0020+` foi criado.

## UI e revisão Impeccable

O mapa e o KDS passaram pelo detector mecânico uma única vez e por uma rodada visual agrupada em desktop, tablet, POS e wall display. As abas laterais inicialmente sinalizadas pelo detector foram removidas; os estados permanecem redundantes por texto, ícone, cor e borda. Não foram adicionados gradientes.

## Observações e limites honestos

- A primeira geração OpenAPI revelou a injeção implícita do `TableSessionCodec`; ela foi tornada explícita e coberta novamente pelo teste PostgreSQL antes da regeneração final.
- Kiota concluiu com sucesso, mas mantém warnings do próprio gerador para formatos OpenAPI `email`/`uri` e para os tipos de erro `400/422` do endpoint de sync.
- O `biome check` amplo dos pacotes ainda acusa a formatação CRLF já presente em muitos arquivos não alterados; os gates semânticos focados (`biome lint`) não têm erros. O Ops mantém warnings de especificidade/`!important` no stylesheet compartilhado, sem erro de lint.
- A validação do Edge cobre software, KDS local durável, boundary HTTPS/mTLS, spooler RAW e recuperação automatizada. Certificados emitidos para o estabelecimento, confirmação de papel impresso, falha real de disco/relógio e ensaio de reinstalação permanecem validações de ambiente, não simuladas como concluídas.
- Nenhum provider real, impressora física, dispositivo POS real, push ou deploy foi usado neste escopo. O teste do printer comprova fail-closed fora do Windows e o teste do processor comprova exactly-once até a fronteira do adapter; não alega impressão física.
