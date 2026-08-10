#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:-/srv/apps/giromesa-v2/shared/legacy-provider-secrets.env}
sources=(/srv/apps/giromesa/giro_mesa/.env /srv/apps/giro_mesa/.env)
keys=(
  ASAAS_API_KEY ASAAS_ENV ASAAS_PRODUCTION_URL ASAAS_SANDBOX_URL ASAAS_WEBHOOK_SECRET
  CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID
  FISCAL_API_BASE_URL FISCAL_API_KEY FISCAL_CERTIFICATE_A1 FISCAL_CSC_TOKEN FISCAL_PROVIDER
  FOCUS_NFE_HOMOLOGATION_URL FOCUS_NFE_PRODUCTION_URL FOCUS_NFE_TOKEN
  NUVEM_FISCAL_AUTH_URL NUVEM_FISCAL_CLIENT_ID NUVEM_FISCAL_CLIENT_SECRET
  NUVEM_FISCAL_PRODUCTION_URL NUVEM_FISCAL_SANDBOX_URL NUVEM_FISCAL_SCOPE
  R2_ACCESS_KEY_ID R2_ACCOUNT_ID R2_BUCKET R2_SECRET_ACCESS_KEY
  SENTRY_DSN TURNSTILE_SECRET_KEY TURNSTILE_SITE_KEY
  META_ACCESS_TOKEN META_APP_SECRET META_PHONE_NUMBER_ID META_WABA_ID META_WEBHOOK_VERIFY_TOKEN
  GIROMESA_BRANCH_ID GIROMESA_CONNECTOR_TOKEN
  PLATFORM_PRIVACY_EMAIL PLATFORM_SUPPORT_EMAIL
)

read_key() {
  local key=$1 source_file line value
  for source_file in "${sources[@]}"; do
    [[ -f "$source_file" ]] || continue
    line=$(grep -m1 -E "^${key}=" "$source_file" || true)
    value=${line#*=}
    value=${value//$'\r'/}
    if [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
      value=${value:1:${#value}-2}
    fi
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  return 1
}

write_key() {
  local key=$1 value=$2
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s="%s"\n' "$key" "$value" >> "$temporary"
}

mkdir -p "$(dirname "$target")"
umask 077
temporary=$(mktemp "${target}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT
count=0
for key in "${keys[@]}"; do
  value=$(read_key "$key" || true)
  if [[ -n "$value" ]]; then
    write_key "$key" "$value"
    count=$((count + 1))
  fi
done

mv -f "$temporary" "$target"
chmod 600 "$target"
trap - EXIT
echo "$count credenciais de provedores foram preservadas fora dos containers cloud."
