#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:-/srv/apps/giromesa-v2/shared/.env}
legacy_primary=${2:-/srv/apps/giromesa/giro_mesa/.env}
legacy_runtime=${3:-/srv/apps/giro_mesa/.env}

for source_file in "$legacy_primary" "$legacy_runtime"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Arquivo de origem ausente: $source_file" >&2
    exit 1
  fi
done

read_key() {
  local key=$1
  shift
  local source_file line value
  for source_file in "$@"; do
    line=$(grep -m1 -E "^${key}=" "$source_file" || true)
    if [[ -n "$line" ]]; then
      value=${line#*=}
      if [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
        value=${value:1:${#value}-2}
      fi
      if [[ -n "$value" ]]; then
        printf '%s' "$value"
        return 0
      fi
    fi
  done
  return 1
}

require_key() {
  local key=$1 value
  shift
  value=$(read_key "$key" "$@" || true)
  if [[ -z "$value" ]]; then
    echo "Credencial obrigatória ausente: $key" >&2
    exit 1
  fi
  printf '%s' "$value"
}

write_key() {
  local key=$1 value=$2
  value=${value//$'\r'/}
  value=${value//$'\n'/}
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s="%s"\n' "$key" "$value" >> "$temporary"
}

google_client_id=$(require_key GOOGLE_OAUTH_CLIENT_ID "$legacy_runtime" "$legacy_primary")
google_client_secret=$(require_key GOOGLE_OAUTH_CLIENT_SECRET "$legacy_runtime" "$legacy_primary")
resend_api_key=$(require_key RESEND_API_KEY "$legacy_runtime" "$legacy_primary")
resend_from=$(read_key EMAIL_FROM "$legacy_runtime" "$legacy_primary" || true)
resend_from=${resend_from:-GiroMesa <contato@giromesa.com.br>}
resend_reply_to=$(read_key PLATFORM_SUPPORT_EMAIL "$legacy_primary" "$legacy_runtime" || true)
resend_reply_to=${resend_reply_to:-contato@giromesa.com.br}
admin_emails=${PLATFORM_ADMIN_EMAILS_OVERRIDE:-}
whatsapp_number=${WHATSAPP_NUMBER_OVERRIDE:-}

postgres_password=$(openssl rand -hex 24)
session_secret=$(openssl rand -hex 48)
qr_table_token_secret=$(openssl rand -hex 48)
mfa_key=$(openssl rand -base64 32)
outbox_key=$(openssl rand -base64 32)
internal_key=$(openssl rand -hex 32)
webhook_key=$(openssl rand -base64 32)

mkdir -p "$(dirname "$target")"
umask 077
temporary=$(mktemp "${target}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT

write_key NODE_ENV production
write_key POSTGRES_DB giromesa_v2
write_key POSTGRES_USER giromesa
write_key POSTGRES_PASSWORD "$postgres_password"
write_key DATABASE_URL "postgresql://giromesa:${postgres_password}@postgres:5432/giromesa_v2"
write_key APP_URL https://giromesa.com.br
write_key CUSTOMER_APP_URL https://menu.giromesa.com.br
write_key OPS_APP_URL https://app.giromesa.com.br
write_key API_URL https://api.giromesa.com.br
write_key NEXT_PUBLIC_API_URL https://api.giromesa.com.br
write_key NEXT_PUBLIC_OPS_URL https://app.giromesa.com.br
write_key NEXT_PUBLIC_GOOGLE_AUTH_ENABLED true
write_key NEXT_PUBLIC_WHATSAPP_NUMBER "$whatsapp_number"
write_key NEXT_PUBLIC_CUSTOMER_API_URL https://api.giromesa.com.br
write_key NEXT_PUBLIC_CUSTOMER_API_ENABLED true
write_key VITE_API_URL https://api.giromesa.com.br
write_key VITE_SITE_URL https://giromesa.com.br
write_key LOG_LEVEL info
write_key TRUST_PROXY 1
write_key CORS_ORIGINS https://giromesa.com.br,https://www.giromesa.com.br,https://menu.giromesa.com.br,https://app.giromesa.com.br
write_key SESSION_SECRET "$session_secret"
write_key QR_TABLE_TOKEN_SECRET "$qr_table_token_secret"
write_key MEDIA_ROOT /app/data/media
write_key MFA_ENCRYPTION_KEY "$mfa_key"
write_key OUTBOX_ENCRYPTION_KEY "$outbox_key"
write_key PLATFORM_ADMIN_EMAILS "$admin_emails"
write_key INTERNAL_API_KEY "$internal_key"
write_key COOKIE_DOMAIN .giromesa.com.br
write_key GOOGLE_OAUTH_CLIENT_ID "$google_client_id"
write_key GOOGLE_OAUTH_CLIENT_SECRET "$google_client_secret"
write_key GOOGLE_OAUTH_REDIRECT_URI https://api.giromesa.com.br/api/v1/auth/google/callback
write_key LEGAL_TERMS_VERSION 2026-08-09
write_key EMAIL_PROVIDER_ENABLED true
write_key EMAIL_PROVIDER_CREDENTIAL_REFERENCE resend
write_key RESEND_API_KEY "$resend_api_key"
write_key RESEND_FROM "$resend_from"
write_key RESEND_REPLY_TO "$resend_reply_to"
write_key PUBLIC_HUB_ACK_TIMEOUT_MS 5000
write_key WEBHOOK_SIGNING_MASTER_KEY "$webhook_key"
write_key DOSECLUB_PROVIDER_ENABLED false
write_key ASAAS_API_URL https://api-sandbox.asaas.com/v3
write_key ASAAS_API_KEY ""
write_key ASAAS_WEBHOOK_SECRET ""
write_key OPENAI_API_KEY ""

mv -f "$temporary" "$target"
chmod 600 "$target"
trap - EXIT
echo "Ambiente V2 criado com permissões 600; nenhum valor foi exibido."
