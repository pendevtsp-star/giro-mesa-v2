# Deploy do piloto na VPS

O V2 roda lado a lado com o V1. Ele usa o projeto Compose `giromesa-v2-pilot`, portas locais `3110`, `3111`, `3112` e `3210`, banco próprio e o diretório `/srv/apps/giromesa-v2`.

## Princípios de corte

- Nunca executar `docker compose down -v`.
- Nunca reutilizar o volume PostgreSQL do V1 no V2.
- Manter o V1 ativo até o aceite funcional e operacional do piloto.
- Gerar backup lógico do V2 antes de cada migração.
- Promover para os domínios definitivos somente depois dos fluxos de login, salão, balcão, QR, KDS, caixa e sincronização do Edge Hub passarem em ambiente real.

## Primeiro deploy

1. Publicar as imagens `pilot` pelo workflow `Publish pilot images`.
2. Criar uma release em `/srv/apps/giromesa-v2/releases/<sha>` e apontar o link `current` para ela.
3. Executar `bootstrap-env.sh` uma única vez. Ele reaproveita Google e Resend, cria segredos novos para o V2 e não imprime valores.
4. Executar `ensure-cloudflare-dns.sh`.
5. Executar `deploy-pilot.sh`.
6. Executar `provision-ingress.sh`.
7. Validar os quatro endpoints públicos e o callback Google exato.

## Domínios do piloto

- Landing/login: `https://pilot.giromesa.com.br`
- Operação: `https://app-pilot.giromesa.com.br`
- Cardápio/QR: `https://menu-pilot.giromesa.com.br`
- API: `https://api-pilot.giromesa.com.br`

O callback que deve existir no Google Cloud é `https://api-pilot.giromesa.com.br/api/v1/auth/google/callback`.

As credenciais Focus NFC-e pertencem ao Edge Hub instalado no estabelecimento. Elas não devem ser copiadas para os containers cloud do V2.
