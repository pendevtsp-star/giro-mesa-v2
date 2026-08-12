# Reconciliação local DoseClub

## Objetivo

O GiroMesa verifica diariamente a consistência dos vínculos entre produtos, itens de estoque em mililitros e o estado DoseClub persistido na unidade. A rotina é deliberadamente detectiva: ela nunca altera saldo, clube, dose ou operação de estoque.

O retorno remoto é classificado como `partial` enquanto não houver um canal administrativo autenticado do DoseClub que confirme o processamento ponta a ponta. A interface não apresenta esse estado como sucesso remoto.

## Persistência e isolamento

- `doseclub_reconciliation_runs` registra solicitações manuais/agendadas, lease do worker, resultado e versão CAS.
- `doseclub_reconciliation_findings` registra divergências determinísticas, histórico de detecção e resolução.
- Ambas as tabelas usam RLS forçada por organização e unidade.
- A aplicação pode solicitar e consultar execuções, mas não pode fabricar ou resolver divergências.
- Somente o papel de banco do worker pode manter findings e concluir execuções.

## Execução

O loop do worker tenta agendar uma execução por unidade ativa e dia. A restrição parcial de unicidade impede duplicidade, mesmo com múltiplas instâncias. O claim usa `FOR UPDATE SKIP LOCKED`, lease e CAS; uma execução abandonada pode ser retomada depois da expiração do lease.

São verificadas:

- ausência ou inatividade de mapeamento;
- item não volumétrico ou unidade diferente de `ml`;
- lacunas entre versão do estado e última operação recebida;
- ausência do heartbeat local de reconciliação v2.

Findings que deixam de ser observados são resolvidos pelo worker no mesmo ciclo. Falhas persistem apenas códigos sanitizados (`SCAN_FAILED` ou `LEASE_LOST`), sem mensagem de provider.

## Operação administrativa

As rotas estão disponíveis nos aliases `/api/v1` e `/v1`, sob:

`/organizations/:organizationId/growth/integrations/doseclub`

- `GET /overview?unitId=...`
- `POST /mappings`
- `PATCH /mappings/:mappingId`
- `POST /runs`
- `POST /runs/:runId/retry`
- `POST /findings/:findingId/recheck`

As mutações exigem sessão, papel `owner` ou `manager`, acesso à unidade, UUIDs válidos, corpo estrito e controle de concorrência. Solicitação e rechecagem exigem `Idempotency-Key`; reutilizar a chave com conteúdo diferente retorna conflito.

Na interface, “Reexecutar verificação” e “Verificar novamente” apenas solicitam uma leitura local. O feedback positivo só aparece depois de resposta `202` e de um novo `GET` confirmar a execução persistida.

## O que não fazer

- Não usar essa rotina para corrigir estoque automaticamente.
- Não redefinir `outbox_events` do GiroMesa como DLQ do DoseClub.
- Não expor credenciais administrativas do DoseClub ao Ops.
- Não declarar reconciliação remota completa enquanto o contrato externo não confirmar aggregate/version e o requeue auditado.

O requeue externo continua sob autoridade do DoseClub. Quando o contrato administrativo entre os sistemas for homologado, ele deve ser adicionado como fluxo separado, autenticado por credencial tenant-scoped e com auditoria própria.

## Gates de homologação

Antes de publicar uma mudança nesta rotina, executar:

1. migration fresh/upgrade, RLS, grants e concorrência em PostgreSQL 16 e 17;
2. detector unitário e worker com claim concorrente/lease expirado;
3. contratos HTTP dos dois aliases e geração OpenAPI/TypeScript/C#;
4. teste Ops, typecheck, build e Playwright desktop/mobile com Axe;
5. teste conjunto com DoseClub quando existir credencial e ambiente externo homologado.
