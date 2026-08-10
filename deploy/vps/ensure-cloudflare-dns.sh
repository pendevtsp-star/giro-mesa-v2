#!/usr/bin/env bash
set -Eeuo pipefail

legacy_env=${1:-/srv/apps/giromesa/giro_mesa/.env}
origin_ip=${ORIGIN_IP:-187.127.37.208}

read_key() {
  local key=$1 line value
  line=$(grep -m1 -E "^${key}=" "$legacy_env" || true)
  value=${line#*=}
  value=${value//$'\r'/}
  if [[ ${#value} -ge 2 && ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
    value=${value:1:${#value}-2}
  fi
  printf '%s' "$value"
}

token=$(read_key CLOUDFLARE_API_TOKEN)
zone_id=$(read_key CLOUDFLARE_ZONE_ID)
if [[ -z "$token" || -z "$zone_id" ]]; then
  echo "Credenciais Cloudflare ausentes em $legacy_env" >&2
  exit 1
fi

api=https://api.cloudflare.com/client/v4
headers=(-H "Authorization: Bearer $token" -H "Content-Type: application/json")
hosts=(pilot.giromesa.com.br menu-pilot.giromesa.com.br app-pilot.giromesa.com.br api-pilot.giromesa.com.br)

zone_response=$(curl --silent --show-error "${headers[@]}" "$api/zones/$zone_id")
if [[ $(jq -r '.success // false' <<< "$zone_response") != true ]]; then
  zone_response=$(curl --silent --show-error "${headers[@]}" "$api/zones?name=giromesa.com.br&status=active")
  zone_id=$(jq -r '.result[0].id // empty' <<< "$zone_response")
  if [[ -z "$zone_id" ]]; then
    echo "O token Cloudflare não consegue localizar a zona ativa giromesa.com.br." >&2
    exit 1
  fi
  echo "Zone ID legado estava obsoleto; zona ativa localizada sem expor o identificador."
fi

for host in "${hosts[@]}"; do
  response=$(curl --fail --silent --show-error "${headers[@]}" "$api/zones/$zone_id/dns_records?type=A&name=$host")
  record_id=$(jq -r '.result[0].id // empty' <<< "$response")
  body=$(jq -nc --arg type A --arg name "$host" --arg content "$origin_ip" '{type:$type,name:$name,content:$content,ttl:1,proxied:true}')
  if [[ -n "$record_id" ]]; then
    result=$(curl --fail --silent --show-error -X PUT "${headers[@]}" --data "$body" "$api/zones/$zone_id/dns_records/$record_id")
  else
    result=$(curl --fail --silent --show-error -X POST "${headers[@]}" --data "$body" "$api/zones/$zone_id/dns_records")
  fi
  if [[ $(jq -r '.success' <<< "$result") != true ]]; then
    echo "Falha ao configurar DNS de $host" >&2
    exit 1
  fi
  echo "DNS pronto: $host"
done
