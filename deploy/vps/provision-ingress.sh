#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/apps/giromesa-v2
source_config=$root/current/deploy/vps/nginx-pilot.conf
available=/etc/nginx/sites-available/giromesa-v2-pilot
enabled=/etc/nginx/sites-enabled/giromesa-v2-pilot
legacy_enabled=/etc/nginx/sites-enabled/giromesa-ip
legacy_target=""

for endpoint in \
  http://127.0.0.1:3110/ \
  http://127.0.0.1:3111/ \
  http://127.0.0.1:3112/health \
  http://127.0.0.1:3210/health; do
  curl --fail --silent --show-error "$endpoint" >/dev/null
done

for hostname in giromesa.com.br app.giromesa.com.br menu.giromesa.com.br api.giromesa.com.br; do
  if ! getent ahostsv4 "$hostname" >/dev/null; then
    echo "DNS ainda ausente: $hostname" >&2
    exit 1
  fi
done

if [[ ! -f "$source_config" ]]; then
  echo "Configuração Nginx do V2 não encontrada." >&2
  exit 1
fi

rollback() {
  unlink "$enabled" 2>/dev/null || true
  if [[ -n "$legacy_target" ]]; then
    ln -sfn "$legacy_target" "$legacy_enabled"
  fi
  nginx -t
  systemctl reload nginx
}

trap rollback ERR
if [[ -e "$legacy_enabled" || -L "$legacy_enabled" ]]; then
  legacy_target=$(readlink -f "$legacy_enabled")
  unlink "$legacy_enabled"
fi

install -m 0644 "$source_config" "$available"
ln -sfn "$available" "$enabled"
nginx -t
systemctl reload nginx

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --expand \
  --cert-name giromesa.com.br \
  -d giromesa.com.br \
  -d www.giromesa.com.br \
  -d menu.giromesa.com.br \
  -d app.giromesa.com.br \
  -d api.giromesa.com.br

nginx -t
systemctl reload nginx
trap - ERR
echo "Ingress HTTPS definitivo do V2 configurado."
