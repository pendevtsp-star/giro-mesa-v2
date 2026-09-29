# GiroMesa: pré-checagem da release de 29/09/2026

Leitura somente da VPS `srv1788716` e do GitHub em 29/09/2026. Esta checagem não promoveu release, alterou serviços nem instalou agendadores.

## Estado encontrado

- `current` aponta para `b11f7b84b372ba059918c2b4f8f943a1b4468ef7`; `/health` confirma `status=ok`, banco `up`, schema 84 e o mesmo SHA. Site, Ops, cardápio e API pública responderam HTTP 200.
- Os dez containers do projeto `giromesa-v2-pilot` estão em execução. Nove estão saudáveis; o collector não tem healthcheck. Evolution Go registra um reinício histórico; os demais registram zero. Outros 37 containers do host estão em execução, sem estado não saudável observado.
- Disco `/`: 96 GB, 19 GB livres (82% usados); 10,8 milhões de inodes livres. Docker registra 63,25 GB de imagens e 35,53 GB como recuperáveis, mas esse número inclui imagens de rollback e de outros produtos. Não foi autorizada limpeza automática. O preflight de deploy calcula espaço para os digests novos de alvo e recuperação, desempacotamento e reserva mínima de 2 GiB antes do pull.
- O volume persistente de objetos é `/var/lib/docker/volumes/giromesa-v2-pilot_media_data/_data`, confirmado por `docker volume inspect`. O entrypoint confiável é `/opt/giromesa/shared/trust/deploy-entrypoint.sh`, root `0555`, SHA-256 `16da519c94cf17d1b1a3d428cb6cbb6b83ed7592451a2cfea9745c42f038da70`. Há evidência de alvo e recuperação da release ativa.
- Há três gerações locais completas de backup (17–18/09). HMAC e SHA-256 dos quatro arquivos de cada geração foram conferidos; incluem dump, papéis do banco, objetos e configuração cifrada. A mais recente é de 18/09 às 16:14 UTC. Não há timer GiroMesa, entrada pertinente no crontab de root ou unidade/cron local encontrada. Assim, o RPO de cinco minutos do [runbook de recuperação](disaster-recovery.md) não está comprovado. Não se encontrou prova de réplica externa ou ensaio recente de restauração.

O `.env` ativo é root `0600`, sem chaves duplicadas. Das 85 chaves emitidas pelo bootstrap, só `PLATFORM_ADMIN_GRANTS` está ausente; ela é opcional no script. Segredos de banco, sessão, QR, backup e cifra fiscal e todas as variáveis obrigatórias do Compose estão preenchidos. `PLATFORM_ADMIN_EMAILS` está vazio, mas `PLATFORM_ADMIN_ROLES` contém um administrador configurado; sem revelar o e-mail, o banco confirmou uma identidade humana ativa e verificada com MFA verificado para essa entrada. O guard atual aceita essa role configurada. Não há linhas ativas em `platform_staff_access` nem convites pendentes; o login efetivo não foi exercitado nesta auditoria. Google e Resend estão configurados; WhatsApp e Dose Club estão habilitados no ambiente, mas isso não comprova sessão de unidade ou envio real. Focus está em homologação com token integrador vazio; Asaas, OpenAI, `NEXT_PUBLIC_WHATSAPP_NUMBER` e URLs de lojas de pagamento estão vazios. A API informa `evolutionGo=configured_unit_status_required`, `edgeHubInstaller=configured_not_homologated` e `paygo=external_homologation_required`.

AWS CLI v2 e rclone estão instalados. O `.env` ativo não possui R2; `shared/legacy-provider-secrets.env` contém nomes de credenciais R2 preenchidos, mas `R2_ACCOUNT_ID` e `CLOUDFLARE_ACCOUNT_ID` coincidem e têm 23 caracteres, incompatíveis com o ID hexadecimal de 32 caracteres do endpoint R2 padrão. Não houve tentativa de escrita ou de `head-bucket` com esse endpoint inválido. Os remotes rclone existentes pertencem ao Lume, não ao GiroMesa.

## Dados antes das migrations 0085–0088

A migration 0085 cria índice único em `growth_customers(organization_id,idempotency_key)`: zero grupos e zero linhas duplicadas, zero chaves nulas no banco ativo. A 0086 retropreenche a taxa em comandas de delivery abertas: uma comanda aberta, uma entrega vinculada, uma taxa positiva, zero múltiplas entregas por comanda e zero taxas negativas. O total da comanda coincide com o subtotal da entrega, e não com o total que já inclui a taxa. Esses agregados são compatíveis com o retropreenchimento pretendido; eles não substituem o backup e o teste de migration no CI.

## Agendamento preparado, ainda não instalado

`deploy/vps/backup-to-r2.py` reutiliza `scripts/backup-production.sh` na release ativa. O serviço confere SHA/schema/volume, cria uma geração completa em `backups/scheduled`, valida o manifesto assinado, envia arquivos ao R2 e envia o manifesto por último. Cada objeto é conferido por tamanho e metadado SHA-256 via `head-object`. Somente após upload completo remove gerações **criadas por esse agendador**, marcadas como verificadas e com mais de 24 horas; não toca nos backups históricos nem em diretórios sem marcador. O timer roda a cada três minutos com limite de execução de 90 segundos. O teste local de retenção e a sintaxe Python passaram; a expressão do calendário foi validada por `systemd-analyze calendar` na VPS. Nenhum backup remoto foi executado porque falta uma configuração R2 válida.

Para ativar, provisionar fora do Git `/srv/apps/giromesa-v2/shared/backup-offsite.env`, root `0600`, com `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` corretos. Exigir uma geração completa da unidade, incluindo upload e `head-object` de todos os arquivos, antes de habilitar o timer. Configurar e verificar retenção externa de pelo menos 30 dias e alerta para manifesto remoto com idade superior a cinco minutos, falha do serviço e espaço em disco. Completar ensaio de restauração do banco, objetos e configuração cifrada; backup existente ou upload bem-sucedido isoladamente não provam RTO de 30 minutos.

Após a promoção da nova release e revisão dos arquivos, os comandos de instalação são:

```bash
install -m 0644 /srv/apps/giromesa-v2/current/deploy/vps/giromesa-backup-r2.service /etc/systemd/system/
install -m 0644 /srv/apps/giromesa-v2/current/deploy/vps/giromesa-backup-r2.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/giromesa-backup-r2.service /etc/systemd/system/giromesa-backup-r2.timer
systemctl daemon-reload
systemctl start giromesa-backup-r2.service
systemctl status giromesa-backup-r2.service --no-pager
systemctl enable --now giromesa-backup-r2.timer
systemctl list-timers giromesa-backup-r2.timer --all
```

O serviço usa o mesmo lock exclusivo da promoção. Em futuras releases, parar o timer e aguardar o serviço terminar antes de chamar o entrypoint confiável; reativar após a verificação da nova versão. O novo script executado como root deve integrar a lista de arquivos assinados dos manifestos de alvo/recuperação e o validador do entrypoint antes da instalação.

## Gates para a nova release

1. Publicar um commit candidato do schema 88 na `main`, ainda bloqueado para promoção; executar `validate-recovery.yml` em PostgreSQL 16/17 para esse SHA e conferir JSON/hash, upgrade legado, API, worker e outbox. Não reutilizar a prova do schema 84.
2. Publicar o commit de autorização com baseline `software-ready`, matriz de recuperação e testes vinculados à evidência real do candidato. Exigir CI, Security e todos os jobs de `Publish pilot images`, incluindo imagens, assinaturas e manifestos de alvo e recuperação.
3. Preparar o release exato em `releases/<SHA_AUTORIZADO>` com `git -c tar.umask=0022 archive`; baixar manifestos, bundles, checksums e JSON de validação do mesmo run. Conferir SHA e hashes assinados, permissões root e Docker config de leitura. Validar a rotação do entrypoint por canal independente se seu hash mudar.
4. Usar apenas `/opt/giromesa/shared/trust/deploy-entrypoint.sh deploy`, com `GIROMESA_RELEASE_DIRECTORY`, `GIROMESA_RECOVERY_RELEASE_DIRECTORY`, `GIROMESA_IMAGE_ATTESTATION_FILE`, `GIROMESA_RECOVERY_IMAGE_ATTESTATION_FILE`, `GIROMESA_DOCKER_CONFIG_DIRECTORY`, `GIROMESA_OBJECT_DIRECTORY` (mountpoint acima) e `GIROMESA_TRUSTED_ENTRYPOINT_SHA256` conferidos. O script exige backup completo antes de pull/migration e recusa espaço insuficiente. Não contornar gates; o rollback in-place continua sem transição autorizada e depende de restauração integral.
5. Após a promoção, confirmar `current`, SHA, schema 88, digests, saúde/reinícios, API/site/Ops/cardápio, backup pré-migration assinado e preservação dos outros containers. Homologações de provedor, hardware e operação autenticada continuam gates separados da saúde do release.
