# Task 37 — relatório de conclusão técnica

Data: 2026-08-12  
Base: `4d408037c3fbcb67e2ad57f8ad47b6300a10ec77`  
Escopo: ciclo LGPD local; sem provider, push ou deploy.

## Resultado

- O registry agora possui processadores explícitos para os oito domínios obrigatórios: identidade, vínculo organizacional, operação, gestão/financeiro, crescimento/CRM, objetos/mídia, offline/edge e backups.
- `access_export` termina somente após todos os oito steps confirmarem processamento. O pacote é criptografado, expira em 15 minutos e continua com download único e step-up MFA.
- Operação e gestão exportam um inventário mínimo das referências pessoais, sem expor fatos financeiros ou dados de outros clientes. CRM exporta o cadastro vinculado por e-mail dentro do tenant, consentimentos, fidelidade e jornadas associadas, removendo hashes e chaves de idempotência.
- Objetos exportam apenas metadados de conteúdo criado pelo titular; bytes não são duplicados e nenhuma exclusão externa é alegada. Offline exporta metadados de comandos do ator sem payload/result de negócio.
- Correção, anonimização e exclusão executam preflight em todos os adapters, mas não aplicam mutação parcial. Até a política de retenção/restore ser aprovada, todos os steps ficam `blocked` e backup registra `BACKUP_RETENTION_POLICY_UNAPPROVED`.
- A função de domínio é `SECURITY DEFINER`, fixa `search_path`, valida organização/protocolo/tentativa em estado `processing` e só pode ser executada por `giromesa_worker`; a função auxiliar não é executável diretamente pelo worker.
- O envelope do outbox e o worker agora usam a mesma identidade durável `${requestId}:${attempt}`, eliminando a divergência preexistente e preservando retries idempotentes.

## Evidências executadas

| Gate | Resultado |
| --- | --- |
| TDD registry/política/tentativa | 3/3 passaram |
| Worker unitário | 28 passaram, 4 skips condicionais sem URLs de banco |
| Migração 0028 em PostgreSQL 17 descartável | passou; privilégios mínimos e contexto fail-closed confirmados |
| Lifecycle worker em PostgreSQL 17 com todas as migrations | passou; RLS, export completo, criptografia, download único, replay e bloqueio de mutação confirmados |
| Serviço API de privacidade em PostgreSQL 17 | passou; MFA, tenant, idempotência e outbox confirmados |
| Suite API | 157 passaram, 66 skips condicionais sem URLs dedicadas de banco, 0 falhas |
| Contrato OpenAPI | passou; os seis domínios adicionais aparecem no export e os clientes foram regenerados |
| Cliente C# .NET 10 | build Release, 0 erros e 0 avisos |
| Build monorepo | 9/9 tarefas passaram |
| Biome focado e `git diff --check` | passaram após formatação focada |

O teste histórico `0009 tenant RLS upgrade` apresentou `tuple concurrently updated` quando foi executado em paralelo com outro teste que cria/remove roles globais no mesmo cluster. O teste de privacidade foi repetido serialmente em banco descartável e passou; a falha não foi atribuída à Task 37.

## Dependências externas preservadas

- revisão jurídica de bases legais, prazos, exceções e hard delete por categoria;
- aprovação da política de backup/WAL/objetos e do ledger de tombstones reaplicado após restore;
- homologação de convergência em dispositivos Edge físicos e de qualquer storage/provider futuro;
- gestão e rotação da chave `PRIVACY_EXPORT_ENCRYPTION_KEY` em secret manager.

Essas dependências bloqueiam mutações destrutivas e o nível `production-approved`, mas não o export local completo. Nenhum sucesso de provider externo foi simulado.
