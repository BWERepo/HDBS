#!/usr/bin/env bash
# Diffs the secret NAMES (never values - wrangler can't read those back) set on the staging and
# production Workers. Run before a promotion to catch drift. Exits non-zero if the sets differ.
#
# Ported from BusinessWebExpress/scripts/check-secret-parity.sh. This matters more here than it
# does there: HDBS handles live payments, and the whole point of giving staging and production
# IDENTICAL secret names with different values (sandbox vs live) is that any name-level
# difference is then unambiguously a bug. The alternative - SQUARE_SANDBOX_* on staging and
# SQUARE_* on production, as the PHP secrets files did - makes this check meaningless and forces
# an `if ($__staging)` branch at every call site.
set -euo pipefail

STAGING_WORKER="hdbs-staging"
PROD_WORKER="hdbs"

# Every secret both Workers are expected to carry. Kept in sync with the Env interface in
# src/types.ts. Names only - never put a value in this file.
EXPECTED=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  ORDER_TOKEN_SECRET
  SMOKE_TOKEN
  SQUARE_TOKEN
  SQUARE_APP_ID
  SQUARE_LOCATION_ID
  SQUARE_WEBHOOK_SIG_KEY
  PAYPAL_CLIENT_ID
  PAYPAL_SECRET
  USPS_CONSUMER_KEY
  USPS_CONSUMER_SECRET
  BREVO_API_KEY
)

list_secrets() {
  npx wrangler secret list --name "$1" 2>/dev/null \
    | grep -o '"name": *"[^"]*"' | sed 's/"name": *"//; s/"$//' | sort
}

staging_secrets=$(list_secrets "$STAGING_WORKER")
prod_secrets=$(list_secrets "$PROD_WORKER")

only_staging=$(comm -23 <(echo "$staging_secrets") <(echo "$prod_secrets"))
only_prod=$(comm -13 <(echo "$staging_secrets") <(echo "$prod_secrets"))

status=0

if [ -n "$only_staging" ] || [ -n "$only_prod" ]; then
  echo "DRIFT DETECTED between $STAGING_WORKER and $PROD_WORKER:"
  if [ -n "$only_staging" ]; then
    echo "  Only on staging:"
    echo "$only_staging" | sed 's/^/    - /'
  fi
  if [ -n "$only_prod" ]; then
    echo "  Only on production:"
    echo "$only_prod" | sed 's/^/    - /'
  fi
  status=1
else
  echo "OK: staging and production have the same secret names."
fi

# Also check both against the expected set, so a secret missing from BOTH Workers - which the
# staging/prod diff alone would call "in sync" - still fails.
missing=""
for name in "${EXPECTED[@]}"; do
  echo "$prod_secrets" | grep -qx "$name" || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "MISSING from $PROD_WORKER (expected per src/types.ts):"
  for name in $missing; do echo "    - $name"; done
  status=1
fi

exit $status
