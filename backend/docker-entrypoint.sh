#!/bin/sh
set -eu
# Existing provider clients consume *_FILE. Materialize runtime env secrets in
# container-local temporary files, never in image layers or persistent volumes.
umask 077
secret_dir=$(mktemp -d /tmp/shards-secrets.XXXXXX)
for secret_name in ARC_PAY_SECRET_KEY ARC_PAY_WEBHOOK_SIGNING_SECRET STEAM_WEB_API_KEY SIH_API_KEY SIH_STEAM_REFILL_API_KEY ADMIN_API_TOKEN PURELYMAIL_SMTP_PASSWORD SLACK_ORDERS_WEBHOOK_URL VV_ADMIN_WEBHOOK_SECRET VV_ADMIN_INTEGRATION_SECRET; do
  secret_value=$(printenv "$secret_name" || true)
  if [ -n "$secret_value" ]; then
    printf '%s' "$secret_value" > "$secret_dir/$secret_name"
    export "${secret_name}_FILE=$secret_dir/$secret_name"
    unset "$secret_name"
  fi
done
unset secret_value
exec "$@"
