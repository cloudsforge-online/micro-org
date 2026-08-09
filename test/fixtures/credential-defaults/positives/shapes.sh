# Every SHELL shape the check must refuse, one per line, so a regression names the shape it broke.
# `test/secret-hygiene.test.ts` asserts on the line number of each, which is why nothing is
# reordered here casually.

# 1. the shape from micro-org #276
ADMIN_PASSWORD=${ADMIN_PASSWORD:-correct-horse-battery-staple-42}

# 2. the same expansion used inline rather than assigned
curl -d "{\"password\":\"${ESTATE_SECRET:-a-literal-standing-in-for-a-secret}\"}" http://x/y

# 3. the other four credential words
FOO=${SOME_SECRET:-a-literal-secret-value-here}
BAR=${SOME_TOKEN:-a-literal-token-value-here}
BAZ=${SOME_KEY:-a-literal-key-value-here}
QUX=${SOME_CREDENTIAL:-a-literal-credential-value}
QUUX=${SOME_PASS:-a-literal-pass-value-here}

# 4. a plain assignment to a literal, which is what `erasure-drill.sh` and `estate-verify.sh` had
PASS="correct-horse-battery-staple-42"
export SERVICE_TOKEN=a-bare-unquoted-token-literal

# 5. camelCase in a shell variable is still a credential name
adminPassword='another-literal-password-value'
