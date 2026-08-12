# Deploy único do GiroMesa V2 na VPS

O V2 usa o projeto Compose `giromesa-v2-pilot`, portas locais `3110`, `3111`, `3112` e `3210`, banco próprio e o diretório `/srv/apps/giromesa-v2`. Durante o corte, o V1 permanece apenas como rollback imediato; depois do smoke público ele é aposentado.

## Princípios de corte

- Nunca executar `docker compose down -v`.
- Nunca reutilizar o volume PostgreSQL do V1 no V2.
- Manter o V1 ativo somente até o smoke interno e o corte HTTPS do V2 passarem.
- Gerar backup lógico do V2 antes de cada migração.
- Promover para os domínios definitivos somente depois dos fluxos de login, salão, balcão, QR, KDS, caixa e sincronização do Edge Hub passarem em ambiente real.

## Primeiro deploy

1. Publicar as imagens `pilot` pelo workflow `Publish pilot images`.
2. Criar uma release em `/srv/apps/giromesa-v2/releases/<sha>` e apontar o link `current` para ela.
3. Executar `bootstrap-env.sh` uma única vez com `PLATFORM_ADMIN_GRANTS_OVERRIDE` revisado. Ele reaproveita Google e Resend, cria segredos novos para o V2 e não imprime valores.
4. Executar `ensure-cloudflare-dns.sh`.
5. Executar `deploy-pilot.sh`.
6. Executar `provision-ingress.sh`.
7. Validar os quatro endpoints públicos e o callback Google exato.

Ambientes já existentes devem executar `ensure-runtime-env.sh` antes do deploy. O script preserva valores presentes, adiciona atomicamente apenas chaves ausentes e bloqueia `PLATFORM_ADMIN_GRANTS` ausente ou inválido em vez de inventar privilégios. Execute-o novamente para comprovar idempotência.

O deploy chama o backup Linux completo e assinado antes das migrations. Para incluir objetos ou configuração já criptografada, configure `GIROMESA_OBJECT_DIRECTORY` e `GIROMESA_ENCRYPTED_CONFIG_ARCHIVE`; nunca aponte o segundo para `.env`. O overlay `compose.observability.yaml` usa apenas saída debug sem retenção e não substitui um backend durável.

Rollback de aplicação usa `rollback-app.sh` com SHA completo e migrations atual/alvo explicitamente iguais. Ele não restaura banco. Se o schema divergir, pare e siga o runbook de recuperação de desastre.

## Domínios definitivos

- Landing/login: `https://giromesa.com.br`
- Operação: `https://app.giromesa.com.br`
- Cardápio/QR: `https://menu.giromesa.com.br`
- API: `https://api.giromesa.com.br`

O callback que deve existir no Google Cloud é `https://api.giromesa.com.br/api/v1/auth/google/callback`.

As credenciais Focus NFC-e pertencem ao Edge Hub instalado no estabelecimento. Elas não devem ser copiadas para os containers cloud do V2.
