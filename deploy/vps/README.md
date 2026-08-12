# Deploy único do GiroMesa V2 na VPS

O V2 usa o projeto Compose `giromesa-v2-pilot`, banco próprio e releases imutáveis em `/srv/apps/giromesa-v2/releases/<sha>`. O link `current` somente pode apontar para um diretório cujo nome seja o SHA completo do release.

## Regras de segurança

- Nunca executar `docker compose down -v` nem reutilizar o volume PostgreSQL do V1.
- Executar `ensure-runtime-env.sh` antes de vincular o release. Depois do vínculo, o `.env` não pode mudar até o backup pré-migração terminar.
- O deploy exige backup completo do banco, diretório de objetos e `.env` atual cifrado. Backup somente do banco é recusado.
- O backup é criado antes de `pull`, atualização do PostgreSQL ou migrations.
- Imagens de aplicação, PostgreSQL, Cosign, BuildKit, frontend Dockerfile e bases são fixadas por digest.
- O overlay `compose.observability.yaml` é debug-only e não substitui observabilidade durável.

## Primeiro deploy

1. Execute `bootstrap-env.sh` uma única vez com `PLATFORM_ADMIN_GRANTS_OVERRIDE` revisado. O script não sobrescreve um `.env` existente.
2. Configure `GIROMESA_OBJECT_DIRECTORY` com o armazenamento real de objetos e preserve-o fora do diretório do release.
3. Antes da primeira promoção, derive o recovery R2 na branch exata `release/rollback-0029`, contendo schema 0029 e este hardening. O CI completo dessa branch publica e assina as cinco imagens e o manifesto de recuperação. Configure `GIROMESA_RECOVERY_RELEASE_SHA` e os três arquivos `GIROMESA_RECOVERY_IMAGE_ATTESTATION_*`. Não há trust-on-first-use nem bypass para release antigo sem assinatura.
4. Publique as imagens alvo pelo workflow `Publish pilot images`. Ele só aceita CI de `push` da `main`, assina cada digest e gera `giromesa-image-attestation-<sha>`.
5. Baixe juntos o JSON, o bundle Sigstore e o checksum de ambos os releases. Configure `GIROMESA_IMAGE_ATTESTATION_FILE`; bundle e checksum são descobertos pelos sufixos `.bundle` e `.sha256`, ou definidos explicitamente.
6. Crie um Docker config dedicado somente à leitura do GHCR. Defina `GIROMESA_DOCKER_CONFIG_DIRECTORY`; o diretório deve ter modo `0700` e `config.json`, modo `0600`. Não reutilize credenciais administrativas.
7. Crie `/srv/apps/giromesa-v2/releases/<sha>`, valide que o checkout corresponde ao SHA e execute `deploy-pilot.sh`. O recovery é baixado e validado antes de parar mutadores; qualquer falha posterior promove o recovery R2.
8. Execute `ensure-cloudflare-dns.sh` e `provision-ingress.sh`, depois valide login, salão, balcão, QR, KDS, caixa e Edge Hub.

`ensure-runtime-env.sh` preserva valores existentes, adiciona atomicamente apenas segredos ausentes e rejeita chaves duplicadas. Sem grants explícitos, deriva apenas `platform.read` dos e-mails administrativos; não inventa permissão de mutação.

O backup requer `GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64` e `GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64`, ambas com 32 bytes em base64. A configuração cifrada é produzida diretamente do `.env` atual e seu HMAC é vinculado ao manifesto assinado. Arquivo cifrado pré-construído é recusado.

## Rollback

`rollback-app.sh` não reverte banco. A matriz `rollback-compatibility.json` está intencionalmente sem transições: o rollback de schema `0029` para release `0026` permanece bloqueado. Uma transição só pode ser adicionada após existir release de recuperação em schema `0029`, SHA/artifact imutável e evidência CI verificável. Se o schema divergir, siga o drill de recuperação de desastre.

## Domínios

- Landing/login: `https://giromesa.com.br`
- Operação: `https://app.giromesa.com.br`
- Cardápio/QR: `https://menu.giromesa.com.br`
- API: `https://api.giromesa.com.br`
- Callback Google: `https://api.giromesa.com.br/api/v1/auth/google/callback`

As credenciais Focus NFC-e pertencem ao Edge Hub no estabelecimento e não devem ser copiadas para containers cloud.
