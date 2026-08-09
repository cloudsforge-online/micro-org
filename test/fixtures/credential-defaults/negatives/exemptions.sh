# EVERY LINE IN THIS FILE IS CORRECT CODE AND MUST PASS.
#
# This is the half of the check that decides whether it survives contact with the estate. A guard
# that is red on correct code does not get fixed, it gets bypassed — three of the guards in
# `secret-hygiene.yml` had exactly that shape and had never passed anywhere — and this one lands
# in every repository at once, so one bad exemption turns the whole estate red in a single push.
#
# Each case below is a real line from the estate, cited, not an invented one.

# ── the correct pattern, and what micro-deploy #13 replaced the defect with ────────────────────
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}

# ── a default that names ANOTHER VARIABLE moves the question rather than answering it with a
# ── literal. `deploy/scripts/estate-verify.sh`.
ADMIN_PASSWORD=${ADMIN_PASSWORD:-${ESTATE_ADMIN_PASSWORD:-}}
FALLBACK_SECRET=${A_SECRET:-$B_SECRET}

# ── the value the fix REFUSES. `deploy/scripts/estate-bootstrap.sh` names the published constant
# ── on purpose so the script can compare against it and exit 2.
PUBLISHED_DEFAULT='correct-horse-battery-staple-42'
REFUSED_PASSWORD='correct-horse-battery-staple-42'

# ── a TTL whose name happens to carry a credential word. `deploy/scripts/estate-verify.sh`.
cliff=${CF_VERIFY_TOKEN_CLIFF_SECONDS:-600}
skip=${CF_VERIFY_SKIP_TOKEN_CLIFF:-0}

# ── a bind-mount source. `deploy/compose/docker-compose.miners.yml`.
keys=${CF_MINER_KEYS:-/home/malf/dev/cloudsforge/miner-keys}

# ── a placeholder that says it is one, in the SAME vocabulary the `.env.example` step already
# ── uses. Every service refuses this value at boot. `deploy/compose/docker-compose.estate.yml`.
SETTLEMENT_SERVICE_TOKEN=${SETTLEMENT_SERVICE_TOKEN:-estate-placeholder-token-0000000000000000}
NEW_SECRET=${NEW_SECRET:-CHANGE_ME_TO_32_RANDOM_CHARACTERS}
OTHER_SECRET=${OTHER_SECRET:-REPLACE-with-openssl-rand-hex-24}

# ── `@generate`, the estate's sentinel asking service-ci.yml to mint a real value per run, so CI
# ── holds a secret rather than a string claiming to be one (micro-org #142). See any service's
# ── `ci.yml` smoke-env block.
OUTBOX_SIGNING_SECRET=${OUTBOX_SIGNING_SECRET:-@generate}

# ── an endpoint, not a credential
TOKEN_URL=${TOKEN_URL:-http://127.0.0.1:4100/v1/tokens}

# ── below identity's own minimum password length, so no service in the estate would accept it.
# ── `deploy/scripts/verify-chain-backing.sh`, against a throwaway container on its own port.
PG_PASS=test

# ── the NAME of a variable, not its value. `identity/src/env.ts` does this with a const.
LEGACY_KEY_SECRET=IDENTITY_KEY_SECRET

# ── an allow marker WITH a reason, which is the whole exemption mechanism. Forty characters is
# ── the floor, matching the scope-exemption file service-ci.yml reads.
# secret-hygiene: allow the operator plane is bound to 127.0.0.1 in every environment and this
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-local-dev-only}

# ── a heredoc body is DATA. `deploy/scripts/gateway-cert.sh` writes an openssl extension file.
cat > /tmp/ext <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EXT

# ── prose. A finding here would be the estate's most repeated defect: a guard firing on the
# ── comment that documents it. notify's catalogue and activity's classifier both do this.
MESSAGE=${MESSAGE:-your password was changed}
