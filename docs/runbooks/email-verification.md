# Verificação de e-mail

## Invariantes

- Cadastro local não cria sessão. A sessão HttpOnly nasce somente depois do consumo válido do link.
- O banco armazena apenas SHA-256 do token. O valor opaco existe temporariamente no outbox dentro de envelope AES-256-GCM, com AAD `email-verification:<identityId>:<eventId>`.
- Um reenvio revoga tokens ativos anteriores. Cadastro, consumo, reenvio e reset são serializados pelo mesmo advisory lock de e-mail normalizado e, quando a identidade já existe, pelo lock de confiança da identidade.
- As respostas de reenvio não confirmam se a conta existe. Os limites persistentes também cobrem endereços inexistentes: 1/minuto, 5/hora e 10/24 horas.
- Google somente é aceito após `email_verified=true` no ID token e não recebe verificação redundante.

## Ordem global de locks de autenticação

Toda mutação de credencial, verificação, MFA, desafio, reset ou sessão segue a mesma ordem: lock externo de subject/e-mail quando necessário; advisory transaction lock `auth-trust:identity:<identityId>`; revalidação da identidade; e somente então linhas de credencial, token, fator, desafio, sessão, outbox e auditoria. Um fluxo que já adquiriu o lock da identidade nunca tenta adquirir depois um lock externo.

A recuperação de cadastro pendente por Google executa verificação, remoção de senha, revogação de tokens, remoção de MFA não confiável, consumo de desafios, sweep de sessões e criação da sessão Google em uma única transação. Identidades que já verificaram o e-mail preservam senha e MFA. Login local e confirmação de MFA revalidam credencial e estado da identidade depois do lock, impedindo que uma leitura anterior autorize sessão após uma recuperação concorrente.

## Configuração

O API exige `EMAIL_PROVIDER_ENABLED=true` e `OUTBOX_ENCRYPTION_KEY` válido para cadastrar uma conta local. O worker exige a configuração Resend já documentada (`EMAIL_PROVIDER_CREDENTIAL_REFERENCE=resend`, `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL` e `API_URL`). Ausência de configuração falha fechada, sem criar identidade parcial.

## Operação e incidente

O tópico é `auth.email_verification_requested`; a chave idempotente no Resend é `email-verification/<eventId>`. Erros permanentes vão para o estado de dead letter do outbox sem registrar token, envelope ou corpo do provedor. Para revogar uma campanha comprometida, marque `revoked_at` em todos os tokens ativos da identidade e rotacione `OUTBOX_ENCRYPTION_KEY` conforme o runbook de segredos; sessões existentes devem ser revogadas separadamente.

Nunca copie token, envelope criptografado ou chave para logs, tickets ou auditoria. Para diagnóstico, use somente `eventId`, `identityId`, timestamps, contadores e código estável de erro.
