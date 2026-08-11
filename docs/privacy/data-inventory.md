# Inventário técnico de dados pessoais e ciclo LGPD

Status: inventário técnico inicial da Task 37. Este documento não é parecer jurídico, não determina sozinho base legal ou prazo regulatório e precisa de validação do encarregado/assessoria antes de uso como política definitiva.

## Princípios operacionais

- O titular autenticado solicita acesso/exportação, correção, anonimização ou exclusão dentro de uma organização da qual é membro ativo.
- Verificação do titular, aprovação, execução e download exigem estados persistidos; ações sensíveis exigem MFA recente (janela técnica de 10 minutos).
- `completed` só é permitido quando todos os domínios obrigatórios confirmarem processamento. Adaptador ausente ou obrigação não resolvida produz `partial`/`blocked`.
- Correção não reescreve eventos, auditoria, ledger financeiro/fidelidade, documento fiscal ou histórico operacional. Ajustes nesses registros exigem evento de retificação/tombstone referenciado.
- Anonimização preserva chaves técnicas e integridade referencial. Exclusão física só pode ocorrer quando a política aprovada declarar que não existe obrigação de retenção.
- Exports ficam criptografados no PostgreSQL por no máximo 15 minutos e só podem ser baixados uma vez pelo próprio titular com step-up recente. Não existe integração com storage, e-mail ou provider externo nesta entrega.
- Auditoria registra protocolo, estado, domínio, tentativa e código de bloqueio; payload, e-mail, nome, segredo MFA e conteúdo exportado são proibidos nos metadados.

## Inventário por domínio

| Domínio | Exemplos de dados/tabelas | Finalidade técnica observada | Tratamento no ciclo | Retenção/limite técnico atual | Cobertura Task 37 |
| --- | --- | --- | --- | --- | --- |
| Identidade e autenticação | `identities`, credenciais, OAuth, sessões, MFA, recuperação/verificação de e-mail | autenticar pessoas, proteger conta e manter sessão | exporta apenas perfil e datas públicas da conta; segredos, hashes e tokens nunca entram no export; correção limitada a perfil exige propagação completa | tokens possuem expiração própria; prazo definitivo de conta/credenciais depende de política aprovada | processador local para export; mutações bloqueadas enquanto houver dependências ausentes |
| Vínculo organizacional e autorização | `memberships`, `role_bindings`, convites, unidades, devices | conceder acesso e escopo por tenant/unidade | exporta vínculo, estado, papel e unidade; remoção deve preservar auditoria de autorização | a definir com segurança e obrigações trabalhistas/contratuais | processador local para export; mutações bloqueadas enquanto houver dependências ausentes |
| Organização, onboarding e cobrança | organização, entidade legal, onboarding, trial, assinatura, cobrança | contratar e configurar o serviço | dados do estabelecimento não são automaticamente dados do titular; referências de ator exigem retificação, nunca reescrita cega | fiscal/contratual a validar juridicamente | sem processador nesta base da trilha; bloqueado quando aplicável |
| Operação salão/POS/KDS | comandas, pedidos, itens, aprovações, eventos e idempotência | executar e auditar atendimento | referências ao ator/cliente exigem export e pseudonimização coordenada; fatos operacionais imutáveis não são apagados em cascata | retenção operacional/fiscal a definir | `operations`: schema conhecido, adapter ainda ausente e bloqueado |
| Gestão e financeiro | caixa, contas, pagamentos, reconciliação, estoque, compras, pessoas e ponto | controle financeiro, estoque e equipe | valores, lançamentos e conciliações permanecem imutáveis; correção usa lançamento/retificação; dados de pessoa precisam adapter específico | obrigações contábeis, fiscais e trabalhistas a validar | `management_finance`: schema conhecido, adapter ainda ausente e bloqueado |
| Crescimento/CRM | clientes, consentimentos, opt-out, fidelidade, campanhas, reservas, espera e delivery | relacionamento, consentimento e atendimento ao cliente | consentimento mantém histórico; ledger de fidelidade é compensado, não reescrito; cadastro pode ser tombstonado com adapter | consentimento e marketing dependem de política aprovada | `growth_crm`: schema conhecido, adapter ainda ausente e bloqueado |
| Objetos e mídia | imagens, anexos, comprovantes, QR/export objects | conteúdo binário fora do banco relacional | localizar, exportar, revogar links e excluir/tombstonar no storage | TTL e lifecycle do storage ainda não existem | `objects_media`: obrigatório e `PROCESSOR_ABSENT` |
| Offline/edge | cache local, filas, snapshots, comandos em trânsito | operação resiliente e sincronização | propagar tombstone/correção e confirmar convergência de cada edge; fila atrasada não pode ressuscitar dado | TTL e confirmação de convergência ainda não existem | `offline_edge`: obrigatório e `PROCESSOR_ABSENT` |
| Backups e réplicas | backups de banco/objetos, WAL, réplicas | recuperação de desastre | registrar exceção temporal e impedir restauração silenciosa de dado já tratado; expurgo segue política de backup | política e janela de backup ainda não aprovadas | `backups`: obrigatório e `PROCESSOR_ABSENT` |
| DoseClub/terceiros | integração futura | finalidade depende de contrato futuro | nenhuma propagação é simulada; só entra no registry após contrato e adapter reais | não definido | fora do escopo e sem integração nesta entrega |

## Estados e evidências

1. `verification_pending`: protocolo criado de forma idempotente; nenhuma execução.
2. `approval_pending`: titular confirmou MFA recente; aguarda aprovação de owner.
3. `processing`: outbox persistente contém uma tentativa única e o worker pode processar/repetir com segurança.
4. `partial`: ao menos um domínio obrigatório está `blocked`; o protocolo e códigos de bloqueio ficam visíveis e retentáveis.
5. `failed`: falha de processamento confirmada; retry exige owner e novo step-up.
6. `completed`: todos os steps obrigatórios estão `completed`; não é alcançável com adapter ausente.
7. `rejected`: decisão persistida; o motivo textual não é copiado para auditoria.

Para exportação, identidade e vínculo organizacional podem produzir um pacote parcial criptografado que inclui `blockedDomains`. Para correção, anonimização e exclusão, o preflight bloqueia toda mutação enquanto objetos/mídia, edge offline ou backups não confirmarem cobertura. Isso evita uma exclusão parcialmente aplicada e irreversível.

## Lacunas que exigem decisão externa

- bases legais, prazos de retenção e exceções por categoria/país/contrato;
- processo humano de aprovação, SLA, identidade do encarregado e canal de recurso;
- adapters reais para objetos/mídia, dispositivos offline, backups e cada produto integrado;
- política de hard delete versus pseudonimização por categoria;
- gestão/rotação da chave `PRIVACY_EXPORT_ENCRYPTION_KEY` em secret manager;
- modelo de entrega externa do export. A Task 37 oferece apenas download autenticado e único, sem e-mail/storage/provider.
