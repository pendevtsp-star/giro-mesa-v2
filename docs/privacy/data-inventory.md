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
| Operação salão/POS/KDS | comandas, pedidos, itens, aprovações, eventos e idempotência | executar e auditar atendimento | referências ao ator são inventariadas por tabela e papel; fatos operacionais imutáveis permanecem ligados apenas ao UUID pseudonimizável | retenção operacional/fiscal a definir | `operations`: processador local de export e preflight; nenhuma reescrita cega de fatos |
| Gestão e financeiro | caixa, contas, pagamentos, reconciliação, estoque, compras, pessoas e ponto | controle financeiro, estoque e equipe | referências pessoais são exportadas como inventário mínimo; valores, lançamentos e conciliações permanecem imutáveis | obrigações contábeis, fiscais e trabalhistas a validar | `management_finance`: processador local de export e preflight |
| Crescimento/CRM | clientes, consentimentos, opt-out, fidelidade, campanhas, reservas, espera e delivery | relacionamento, consentimento e atendimento ao cliente | export inclui perfil, consentimentos, fidelidade, reservas, espera e delivery vinculados; hashes de token e idempotência são excluídos | consentimento e marketing dependem de política aprovada | `growth_crm`: processador local de export e preflight |
| Mensagens e mídia WhatsApp | conversa, telefone, texto, recibos, responsável, SLA e anexos privados sob `MEDIA_ROOT` | atendimento e comunicação consentida pela Evolution Go | metadados são tenant/unit scoped; binários usam chave escopada e assinatura allowlisted; segredos e tokens não entram no banco | prazo de retenção e expurgo ainda exigem política aprovada; sem hard delete automático nesta entrega | persistência e acesso autenticado implementados; ciclo LGPD do binário deve entrar no processador antes da produção |
| Objetos e mídia | imagens de logo, capa e produto em `public_menu_media_assets` | conteúdo binário do tenant armazenado no PostgreSQL | exporta metadados, hash e localizador dos objetos criados pelo titular; não classifica conteúdo comercial do tenant como propriedade pessoal nem afirma exclusão externa | bytes permanecem no banco conforme lifecycle do cardápio | `objects_media`: processador local; `externalDeletionClaimed=false` |
| Anexos contábeis | arquivos anexados a solicitações entre estabelecimento e contador | comprovar e responder pendências contábeis | valida tipo e tamanho, verifica malware antes de persistir, aplica retenção configurada e permite bloqueio legal auditado apenas à administração da plataforma | mínimo de 1.827 dias; processo administrativo ou judicial suspende o expurgo por `legal hold` | expurgo diário pelo worker; tombstone e auditoria permanecem sem expor o objeto ao tenant |
| Offline/edge | comandos recebidos, payload/result, filas e presença | operação resiliente e sincronização | exporta comandos locais emitidos pelo titular e inventaria referências de presença; mutação continua sujeita à convergência comprovada | TTL e confirmação de convergência física ainda dependem do Edge real | `offline_edge`: processador local de export e preflight; homologação física continua externa |
| Backups e réplicas | backups de banco/objetos, WAL, réplicas | recuperação de desastre | o export declara a fronteira de retenção sem duplicar dados; mutações são bloqueadas até política aprovada e proteção contra restauração regressiva | política e janela de backup ainda não aprovadas | `backups`: processador local presente; mutações retornam `BACKUP_RETENTION_POLICY_UNAPPROVED` |
| DoseClub/terceiros | integração futura | finalidade depende de contrato futuro | nenhuma propagação é simulada; só entra no registry após contrato e adapter reais | não definido | fora do escopo e sem integração nesta entrega |

## Estados e evidências

1. `verification_pending`: protocolo criado de forma idempotente; nenhuma execução.
2. `approval_pending`: titular confirmou MFA recente; aguarda aprovação de owner.
3. `processing`: outbox persistente contém uma tentativa única e o worker pode processar/repetir com segurança.
4. `partial`: ao menos um domínio obrigatório está `blocked`; o protocolo e códigos de bloqueio ficam visíveis e retentáveis.
5. `failed`: falha de processamento confirmada; retry exige owner e novo step-up.
6. `completed`: todos os steps obrigatórios estão `completed`; não é alcançável com adapter ausente.
7. `rejected`: decisão persistida; o motivo textual não é copiado para auditoria.

Para exportação, todos os oito domínios locais produzem um pacote completo criptografado; os processadores de domínio rodam com função `SECURITY DEFINER` de superfície mínima, executável somente pelo papel do worker e vinculada ao tenant, protocolo e tentativa persistidos. Para correção, anonimização e exclusão, todos os adaptadores executam preflight, mas a mutação inteira permanece bloqueada enquanto a política de backup/restore não estiver aprovada. Isso evita uma alteração parcialmente aplicada e uma restauração futura que ressuscite dados antigos.

## Lacunas que exigem decisão externa

- bases legais, prazos de retenção e exceções por categoria/país/contrato;
- processo humano de aprovação, SLA, identidade do encarregado e canal de recurso;
- homologação de objetos/providers externos que venham a ser adicionados, convergência em dispositivos Edge físicos e política de backup/restore;
- política de hard delete versus pseudonimização por categoria;
- gestão/rotação da chave `PRIVACY_EXPORT_ENCRYPTION_KEY` em secret manager;
- modelo de entrega externa do export. A Task 37 oferece apenas download autenticado e único, sem e-mail/storage/provider.
