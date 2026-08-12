# Dependências externas e gates

O código deve continuar funcional em modo demonstrativo e falhar de forma segura quando estas dependências estiverem ausentes.

| Área | Necessário para homologação | Estado inicial |
|---|---|---|
| PayGo | contrato, adquirente, pinpad, credenciais e roteiro de homologação | adapter desabilitado |
| Focus NFe | conta, token por empresa, CNPJ, IE/UF, regime, CSC, certificado A1, série e cadastro fiscal dos itens (NCM/CFOP/tributação) | adapter NFC-e implementado e autorizado por papel no Edge Hub; mapeamento fiscal e homologação desabilitados sem dados reais |
| Asaas | conta sandbox/produção, chave e segredo de webhook | porta backend desabilitada |
| Google | client ID, secret e callbacks locais/produção | OIDC Authorization Code + PKCE implementado; falta carregar as credenciais no ambiente V2 |
| AWS | conta, role OIDC, domínio, certificado e parâmetros de ambiente | Terraform sem apply |
| E-mail | chave Resend, remetente e domínio autenticado | adapter Resend implementado com outbox, retries, idempotência e dead-letter auditável |
| WhatsApp | BSP oficial, templates aprovados e consentimentos | canal não publicável |
| OpenAI | chave, política de dados e base de ajuda aprovada | busca determinística |
| Contabilidade e folha | fornecedores escolhidos, contratos de API e mapeamento contábil | API pública/webhooks disponíveis; nenhum fornecedor presumido |
| Piloto | empresa, rede, impressoras, produtos, mesas, equipe e dados fiscais | tenant demonstrativo |
| Hub em produção | certificado TLS local, instalador, provisionamento e cofre de segredos | SQLCipher, replay e reconciliação validados localmente |
| Backup/DR | object storage versionado com object-lock, cofre para HMAC, agenda a cada 5 min, alertas e infraestrutura isolada de restore | scripts fail-closed e ensaio local; RPO/RTO reais ainda não homologados |
| LGPD — retenção em backup | base legal, prazo por categoria, ledger externo de tombstones e prova de reaplicação após restore | export local completo; correção/anonimização/exclusão bloqueiam atomicamente com `BACKUP_RETENTION_POLICY_UNAPPROVED` |
| Geocodificação | provedor e chave para converter endereço em coordenadas | endereço, região, taxa e pedido mínimo validados; ponto-no-polígono bloqueado |
| DoseClub remoto | credencial tenant-scoped, endpoint administrativo e contrato de aggregate/version, heartbeat e requeue auditado | reconciliação local detectiva disponível; cobertura remota sinalizada como parcial conforme o [runbook](runbooks/doseclub-reconciliation.md) |

Documentos jurídicos e procedimentos LGPD são modelos técnicos e exigem revisão profissional antes da publicação comercial.
O bloqueio de mutação LGPD não é ausência de processador: é um gate deliberado até que a política e o mecanismo externo de restore sejam aprovados e homologados. Nenhuma exclusão em provider, objeto externo ou backup é inferida a partir do sucesso local.
