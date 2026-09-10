# Deploy único do GiroMesa V2 na VPS

O V2 usa o projeto Compose `giromesa-v2-pilot`, banco próprio e releases imutáveis em `/srv/apps/giromesa-v2/releases/<sha>`. O link `current` somente pode apontar para um diretório cujo nome seja o SHA completo do release.

## Regras de segurança

- Nunca executar `docker compose down -v` nem reutilizar o volume PostgreSQL do V1.
- Executar `ensure-runtime-env.sh` antes de vincular o release. Depois do vínculo, o `.env` não pode mudar até o backup pré-migração terminar.
- O deploy exige backup completo do banco, diretório de objetos e `.env` atual cifrado. Backup somente do banco é recusado.
- O backup é criado antes de `pull`, atualização do PostgreSQL ou migrations.
- Imagens de aplicação, PostgreSQL, Cosign, BuildKit, frontend Dockerfile e bases são fixadas por digest.
- Materialize o commit exato com `git -c tar.umask=0022 archive`; o release deve ser `root:root`, sem escrita para grupo/outros e com os hashes idênticos ao manifesto assinado antes de chamar o entrypoint.
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

`rollback-app.sh` não reverte banco e recusa execução direta. O único ponto de entrada é `/opt/giromesa/shared/trust/deploy-entrypoint.sh rollback`, com `GIROMESA_RELEASE_DIRECTORY` apontando para o release atual assinado e `GIROMESA_RECOVERY_RELEASE_DIRECTORY`/`ROLLBACK_RELEASE_SHA` apontando para o recovery assinado já pré-validado. No schema `0083_linked_service_accounts`, a matriz `rollback-compatibility.json` não autoriza rollback in-place: sem uma transição comprovada, siga obrigatoriamente o restore integral declarado na própria matriz. O drill deve validar banco, objetos e configuração cifrada, vincular os artefatos e migrations de origem/alvo e executar o smoke SQL antes da promoção. Só adicione uma transição após existir SHA imutável e evidência CI específica para aquele par de schema e release.

O recovery histórico `e520b3c07cf99ad8924436d1a7635719e1e221e3` foi validado para schema 82, conforme `docs/evidence/release-2026-09-09.md`. Essa aprovação não cobre schema 83: o código de recuperação precisa preservar as contas vinculadas e a liberação da mesa somente após a última conta. A matriz candidata permanece vazia até existir nova evidência.

## Preparar schema 83 em dois commits

O primeiro commit é candidato, não uma autorização de promoção: `package.json.productionBaseline` usa `level: candidate`, migration 83 pendente e referências nulas. O checker continua recusando esse estado. `recovery-compatibility.json` declara alvo 83 sem transições; `rollback-compatibility.json` exige schema 83 e restore completo. Não copie o SHA ou o resultado de schema 82 para esses campos.

O workflow `validate-recovery.yml` só executa na `main`. Ele obtém o validador do SHA da `main` que recebeu o dispatch e coloca o candidato em `candidate/`. O script `scripts/validate-recovery-candidate.sh` lê o alvo de `packages/db/drizzle/meta/_journal.json` no checkout principal; lê o schema de recuperação no mesmo arquivo do candidato. Portanto, publicar o candidato apenas numa branch enquanto a `main` ainda está no schema 82 não basta para validar schema 83.

Depois da revisão dos arquivos e dos checks locais, os comandos abaixo descrevem a publicação autorizada. Substitua os valores entre `<...>` por resultados reais; não os grave como evidência.

```powershell
rtk proxy git diff --cached --stat
rtk proxy git diff --cached --check
rtk proxy git commit -m "feat(ops): unify service accounts and bill printing"
rtk proxy git rev-parse HEAD
rtk proxy git push origin HEAD:main
rtk proxy gh workflow run validate-recovery.yml --ref main -f recovery_sha=<SHA_CANDIDATO_83>
rtk proxy gh run list --workflow validate-recovery.yml --limit 5 --json databaseId,headSha,status,conclusion,url
rtk proxy gh run view <RUN_RECOVERY> --json status,conclusion,jobs,url
rtk proxy gh run download <RUN_RECOVERY> --name giromesa-recovery-validation-<SHA_CANDIDATO_83> --dir scratch/recovery-0083
```

O CI do primeiro commit pode falhar nos gates que ainda fixam a evidência anterior: isso não autoriza ignorar outras falhas nem promover. O workflow de recuperação é independente desses gates de metadata. Confira sucesso do run, checksum do JSON e os vínculos: `recoveryArtifact=git:<SHA_CANDIDATO_83>`, `targetMigration=0083_linked_service_accounts`, `postgresMajors=[16,17]`, `schemaLevels=[83,83]`, upgrade legado, saúde da API, estabilidade do worker, outbox e verificações de segurança aprovados.

No segundo commit, após obter essas provas:

1. Copie o JSON real para `docs/evidence/recovery/<sha-curto>-validation-0083.json`; registre o SHA-256 e a URL do run sem alterar o conteúdo da evidência.
2. Vincule `productionBaseline.artifact`, `migration.evidence` e cada `gateResults.*.evidence` a `git:<SHA_CANDIDATO_83>`. Use `software-ready`, migration `verified` e gates `passed` somente com os checks correspondentes comprovados; documente separadamente qualquer gate de metadata que tenha bloqueado o CI candidato.
3. Autorize em `recovery-compatibility.json` o candidato real, migration/appliedAfter 83 e o novo JSON/hash/run. Preserve somente origens cobertas pelo validator e inclua o schema 82 de origem e o 83 já aplicado. Os valores `appliedBeforeWhen` devem vir do journal. Mantenha `rollback-compatibility.json.transitions=[]` enquanto não houver prova de rollback in-place.
4. Atualize os valores fixos de release nos testes `scripts/deploy-hardening.test.mjs` e `scripts/validate-recovery-workflow.test.mjs` para a evidência real; não remova verificações para fazer o candidato parecer aprovado.

```powershell
rtk proxy pnpm production:baseline
rtk proxy pnpm supply-chain:check
rtk proxy node --test scripts/check-production-baseline.test.mjs scripts/deploy-hardening.test.mjs scripts/validate-recovery-workflow.test.mjs
rtk proxy git diff --cached --check
rtk proxy git commit -m "chore(release): authorize verified schema 83 recovery"
rtk proxy git push origin HEAD:main
rtk proxy gh run list --branch main --limit 8 --json databaseId,name,headSha,status,conclusion,url
```

O segundo SHA precisa concluir CI, Security e todos os jobs de `Publish pilot images`, incluindo recovery/provenance. Gere OpenAPI, clientes TS/C#, builds e bundle nativo pelos scripts existentes antes do commit que os publica. A promoção usa exclusivamente o entrypoint confiável descrito acima, com backup pré-migração completo e verificação posterior de `current`, SHA, schema 83, digests, health, reinícios e endpoints públicos. Limpeza de disco continua sendo uma operação separada, limitada aos alvos descartáveis autorizados e inventariados.

## Domínios

- Landing/login: `https://giromesa.com.br`
- Operação: `https://app.giromesa.com.br`
- Cardápio/QR: `https://menu.giromesa.com.br`
- API: `https://api.giromesa.com.br`
- Callback Google: `https://api.giromesa.com.br/api/v1/auth/google/callback`

O token principal da conta integradora Focus pertence apenas ao backend cloud. Os tokens de cada emitente ficam cifrados no PostgreSQL e são usados pelo worker/API no escopo da organização, unidade e ambiente; não chegam ao navegador. Credenciais eventualmente entregues ao Edge são restritas à unidade e permanecem somente em memória.
