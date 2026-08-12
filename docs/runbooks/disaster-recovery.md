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
3. Na VPS Linux, execute `scripts/backup-production.sh` com container, banco, usuário, artefato e migration exatos. O `.env` nunca é copiado: a chave HMAC entra somente pelo processo e é removida ao sair. O PowerShell `scripts/backup-production.ps1` permanece equivalente para ensaios Windows.
4. Envie a pasta para armazenamento versionado com object-lock e replique em outra zona/conta.
5. Monitore idade do manifesto, duração, upload e espaço. Idade acima de cinco minutos viola o RPO.

## Ensaio de restauração

1. Crie banco/container descartável, isolado e diferente da origem.
2. Prepare diretórios de destino vazios para objetos e configuração e um arquivo SQL de smoke funcional, versionado junto da release.
3. Na VPS Linux, execute `scripts/restore-drill.sh` com o artefato esperado e `--smoke-sql-file`; o script registra o SHA-256 desse smoke na evidência. O PowerShell `scripts/restore-drill.ps1` permanece equivalente para ensaios Windows.
4. O script valida HMAC, hashes, caminhos e destinos vazios antes de tocar no banco; depois restaura banco, objetos e configuração criptografada.
5. O smoke funcional roda por último, com `ON_ERROR_STOP`; ele deve validar migrations, RLS negativo e invariantes de ledger aplicáveis à release.
6. Confirme a leitura dos objetos e que a configuração restaurada continua criptografada.
7. Registre `restore-evidence.json`, duração, artefato, migration, hashes e aprovadores; destrua o ambiente descartável.

Falha de assinatura/hash, versão divergente, RTO acima de 30 minutos ou teste funcional incompleto invalida o ensaio. Não repare o backup durante uma restauração real; escolha uma geração íntegra anterior e registre a perda efetiva.

O teste Docker Linux é opt-in para não iniciar containers por acidente: `DISASTER_RECOVERY_DOCKER_TEST=1 node --test scripts/backup-restore-linux.integration.test.mjs`. Ele deve passar na release antes da promoção. O fluxo usa outro container PostgreSQL e recusa restaurar sobre a origem.

## Pré-deploy e rollback da aplicação

`deploy/vps/deploy-pilot.sh` executa `ensure-runtime-env.sh`, valida ferramentas, deriva o SHA imutável, confere a migration alvo do journal e vincula o backup à migration que está realmente aplicada no banco de origem. Só depois conclui `backup-production.sh` e inicia migrations. Falta de chave HMAC, grants administrativos revisados, correspondência no journal ou manifesto aborta o deploy. Objetos e configuração já criptografada podem ser incluídos por `GIROMESA_OBJECT_DIRECTORY` e `GIROMESA_ENCRYPTED_CONFIG_ARCHIVE`; nenhum snapshot novo do `.env` em claro é permitido.

`deploy/vps/rollback-app.sh` troca somente a release da aplicação por SHA completo já instalado. Ele exige que operador declare migrations atual e alvo iguais, registra `rollback-app.json`, executa smoke e nunca chama restauração do banco. Schema divergente bloqueia esse rollback e exige plano de recuperação específico revisado.

## Promoção e incidente

- `software-ready`: não afirma backup restaurável.
- `integration-ready`: valida scripts, mas não afirma RPO/RTO operacional.
- `pilot-approved`: exige migration aplicada e evidência imutável do gate `restore`.
- `production-approved`: também exige alta disponibilidade e reconciliação.

Durante incidente: congele mutações quando seguro, preserve evidências, declare o ponto de recuperação, restaure em infraestrutura limpa, valide segurança/isolamento e só então altere tráfego. DNS, object storage, secret manager, agenda, alertas e homologação na VPS são dependências externas até configuração real.
