#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/apps/giromesa-v2
source_config=$root/current/deploy/vps/nginx-pilot.conf
available=/etc/nginx/sites-available/giromesa-v2-pilot
enabled=/etc/nginx/sites-enabled/giromesa-v2-pilot

if [[ ! -f "$source_config" ]]; then
  echo "Configuração Nginx do V2 não encontrada." >&2
  exit 1
fi

install -m 0644 "$source_config" "$available"
ln -sfn "$available" "$enabled"
nginx -t
systemctl reload nginx

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --keep-until-expiring \
  --cert-name giromesa-v2-pilot \
  -d pilot.giromesa.com.br \
  -d menu-pilot.giromesa.com.br \
  -d app-pilot.giromesa.com.br \
  -d api-pilot.giromesa.com.br

nginx -t
systemctl reload nginx
echo "Ingress HTTPS do piloto configurado."
