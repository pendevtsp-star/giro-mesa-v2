# Recuperação de desastre

Este runbook comprova somente o que foi ensaiado. Build verde, disponibilidade HTTP e a existência de um dump não promovem uma release.

## Objetivos e conteúdo

- RPO máximo: 5 min. O agendador externo executa o backup a cada cinco minutos ou menos e alerta por ausência do manifesto assinado.
- RTO máximo: 30 min. O ensaio termina apenas depois de validar hashes, restaurar, testar a conexão e registrar evidência.
- Banco: dump PostgreSQL custom, sem owner/ACL, vinculado ao artefato Git/digest e à migration.
- Objetos: ZIP do diretório de objetos, com hash SHA-256.
- Configuração criptografada: somente `.age`, `.gpg` ou `.enc`; `.env`, chaves e credenciais em claro são proibidos.
- Versão: SHA Git completo ou digest SHA-256. `latest`, branch e tag mutável não são aceitos.

O manifesto usa HMAC-SHA-256 com chave de ao menos 32 bytes fornecida exclusivamente por `GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64`. Ela deve vir do cofre, ter versão, rotação e cópia de recuperação separada; nunca é gravada no backup.

## Backup

1. Confirme um diretório dedicado fora do host primário.
2. Exporte a configuração já criptografada; nunca passe `.env` ao script.
3. Execute `scripts/backup-production.ps1` com container, banco, usuário, artefato e migration exatos.
4. Envie a pasta para armazenamento versionado com object-lock e replique em outra zona/conta.
5. Monitore idade do manifesto, duração, upload e espaço. Idade acima de cinco minutos viola o RPO.

## Ensaio de restauração

1. Crie banco/container descartável, isolado e diferente da origem.
2. Execute `scripts/restore-drill.ps1` com o artefato esperado.
3. O script valida HMAC, hashes e caminhos antes de tocar no destino; depois restaura e executa `SELECT 1` com `ON_ERROR_STOP`.
4. Valide migrations, RLS negativo, ledgers, leitura de objetos e configuração ainda criptografada.
5. Registre `restore-evidence.json`, duração, artefato, migration, data e aprovadores; destrua o ambiente descartável.

Falha de assinatura/hash, versão divergente, RTO acima de 30 minutos ou teste funcional incompleto invalida o ensaio. Não repare o backup durante uma restauração real; escolha uma geração íntegra anterior e registre a perda efetiva.

## Promoção e incidente

- `software-ready`: não afirma backup restaurável.
- `integration-ready`: valida scripts, mas não afirma RPO/RTO operacional.
- `pilot-approved`: exige migration aplicada e evidência imutável do gate `restore`.
- `production-approved`: também exige alta disponibilidade e reconciliação.

Durante incidente: congele mutações quando seguro, preserve evidências, declare o ponto de recuperação, restaure em infraestrutura limpa, valide segurança/isolamento e só então altere tráfego. DNS, object storage, secret manager, agenda, alertas e homologação na VPS são dependências externas até configuração real.
