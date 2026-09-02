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
2. Configure `GIROMESA_OBJECT_DIRECTORY` com o `Mountpoint` exato do volume persistente `giromesa-v2-pilot_media_data`, obtido por `docker volume inspect giromesa-v2-pilot_media_data --format '{{.Mountpoint}}'`. O caminho deve permanecer fora do diretório do release. O deploy recusa backup de outro diretório e, depois da troca, comprova escrita pela API e leitura pelo worker no mesmo volume.
3. Antes da primeira promoção, derive o recovery R2 contendo schema 0029 e este hardening. Autorize seu SHA e evidência na matriz versionada da `main`. A branch de recovery não recebe permissão de pacote ou OIDC: o workflow privilegiado da `main` refaz os testes PG16/17 e runtime, constrói e assina as imagens recovery. Configure `GIROMESA_RECOVERY_RELEASE_SHA` e os arquivos `GIROMESA_RECOVERY_IMAGE_ATTESTATION_*`.
4. Publique target e recovery pelo workflow `Publish pilot images`. Ele só aceita CI de `push` da `main`, assina cada digest com role/source/authorization e gera manifestos separados. Com a matriz recovery vazia, a promoção permanece bloqueada por desenho.
5. Baixe juntos o JSON, o bundle Sigstore e o checksum de ambos os releases, além de `giromesa-recovery-validation-<sha>.json` no mesmo diretório do manifesto recovery. Configure `GIROMESA_IMAGE_ATTESTATION_FILE`; bundle e checksum são descobertos pelos sufixos `.bundle` e `.sha256`, ou definidos explicitamente.
6. Crie um Docker config dedicado somente à leitura do GHCR. Defina `GIROMESA_DOCKER_CONFIG_DIRECTORY`; o diretório deve ter modo `0700` e `config.json`, modo `0600`. Não reutilize credenciais administrativas.
7. Instale o bootstrap por uma cadeia independente, nunca pelo hash informado pelo próprio checkout. O runbook/configuration management deve provisionar por canal independente o Cosign `ghcr.io/sigstore/cosign/cosign@sha256:b29487e48205d875c324c79583e2806d9d269c0fa299e0861bbec023d8430c8b`; não confie inicialmente no `image-lock.json` ainda não verificado. Com esse pin, valide o bundle do manifesto contra a identidade exata `publish-images.yml@refs/heads/main`, issuer `token.actions.githubusercontent.com` e o SHA da `main` aprovado pelo operador. Extraia então `releaseFiles["deploy/vps/deploy-entrypoint.sh"]` do JSON assinado, compare o arquivo byte a byte com esse SHA-256 e só depois copie atomicamente para `/opt/giromesa/shared/trust/deploy-entrypoint.sh`, proprietário root e modo `0555`. Forneça esse hash em `GIROMESA_TRUSTED_ENTRYPOINT_SHA256`. Rotações repetem a validação pelo bootstrap antigo antes da troca; automação de configuração pode provisionar o mesmo hash por canal independente.
8. Execute `ensure-cloudflare-dns.sh` e `provision-ingress.sh`, depois valide login, salão, balcão, QR, KDS, caixa e Edge Hub.

Defina `GIROMESA_RELEASE_DIRECTORY=/srv/apps/giromesa-v2/releases/<target-sha>` e `GIROMESA_RECOVERY_RELEASE_DIRECTORY=/srv/apps/giromesa-v2/releases/<recovery-sha>`, juntamente com os dois pares manifesto/bundle, e inicie somente por `/opt/giromesa/shared/trust/deploy-entrypoint.sh deploy`. O script interno recusa execução direta.

`ensure-runtime-env.sh` preserva valores existentes, adiciona atomicamente apenas segredos ausentes e rejeita chaves duplicadas. Sem grants explícitos, deriva apenas `platform.read` dos e-mails administrativos; não inventa permissão de mutação.

O bootstrap cria `FISCAL_CREDENTIALS_ENCRYPTION_KEY` com 32 bytes aleatórios, mantém `FOCUS_NFE_PRIMARY_TOKEN` vazio, define `FISCAL_RELEASE_ENV=homologation`, configura o ClamAV interno e fixa a retenção mínima dos anexos fiscais em 1.827 dias. O token integrador deve ser preenchido pelo cofre somente na homologação real. Não rotacione a chave de criptografia depois de cadastrar emitentes sem antes recriptografar todas as credenciais por unidade e testar a recuperação. Para promover `FISCAL_RELEASE_ENV=production`, `config/fiscal-release.json` deve estar assinado no manifesto da release com status `homologated`, escopo aprovado e evidência imutável da jornada fiscal completa; caso contrário o deploy encerra antes de qualquer mutação.

O backup requer `GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64` e `GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64`, ambas com 32 bytes em base64. A configuração cifrada é produzida diretamente do `.env` atual e seu HMAC é vinculado ao manifesto assinado. Arquivo cifrado pré-construído é recusado.

## Rollback

`rollback-app.sh` não reverte banco e recusa execução direta. O único ponto de entrada é `/opt/giromesa/shared/trust/deploy-entrypoint.sh rollback`, com `GIROMESA_RELEASE_DIRECTORY` apontando para o release atual assinado e `GIROMESA_RECOVERY_RELEASE_DIRECTORY`/`ROLLBACK_RELEASE_SHA` apontando para o recovery assinado já pré-validado. No schema `0077_people_multi_role_access`, a matriz `rollback-compatibility.json` não autoriza rollback in-place: sem uma transição comprovada, siga obrigatoriamente o restore integral declarado na própria matriz. O drill deve validar banco, objetos e configuração cifrada, vincular os artefatos e migrations de origem/alvo e executar o smoke SQL antes da promoção. Só adicione uma transição após existir SHA imutável e evidência CI específica para aquele par de schema e release.

## Domínios

- Landing/login: `https://giromesa.com.br`
- Operação: `https://app.giromesa.com.br`
- Cardápio/QR: `https://menu.giromesa.com.br`
- API: `https://api.giromesa.com.br`
- Callback Google: `https://api.giromesa.com.br/api/v1/auth/google/callback`

O token principal da conta integradora Focus pertence apenas ao backend cloud. Os tokens de cada emitente ficam cifrados no PostgreSQL e são usados pelo worker/API no escopo da organização, unidade e ambiente; não chegam ao navegador. Credenciais eventualmente entregues ao Edge são restritas à unidade e permanecem somente em memória.
