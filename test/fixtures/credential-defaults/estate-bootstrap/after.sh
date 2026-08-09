# THE FIX, VERBATIM, from `deploy/scripts/estate-bootstrap.sh` at micro-deploy #13.
#
# THIS FIXTURE IS THE POINT OF THE WHOLE EXERCISE. It must pass, and passing is not easy, because
# it contains BOTH things that most naturally break a checker of this kind:
#
#   * the defective line itself, quoted inside the comment that explains why it is gone — so a
#     checker that reads raw text fails the commit that fixes the bug it checks for; and
#   * `PUBLISHED_DEFAULT='correct-horse-battery-staple-42'`, a credential-named-looking constant
#     bound to the exact published literal, which exists so the script can REFUSE that value.
#
# A check that is red on both of those is worse than no check at all: it would have had to be
# disabled to let the remediation land.
# ── THE OPERATOR, AND WHY THERE IS NO DEFAULT PASSWORD ANY MORE ──────────────
#
# This line used to read
#
#     ADMIN_PASSWORD=${ADMIN_PASSWORD:-correct-horse-battery-staple-42}
#
# described as "a throwaway operator for a throwaway environment". Mainnet was
# bootstrapped without setting the variable, so the estate's only administrator
# held that password — the literal string above, in this file, in a repository
# that is PUBLIC — while `https://api.cloudsforge.online/v1/auth/login` answers
# from the open internet. Measured 2026-08-09: that request returned 200 with an
# access token carrying `roles: ["player","admin"]`. Anyone who read this file
# was an estate administrator. It has been rotated and the new value lives in
# `compose/estate/tokens.env`, which is gitignored and never leaves the host.
#
# The word "throwaway" is what made it survive review: it describes the account's
# INTENT and says nothing about the environment it would actually be run in, and
# the same script bootstraps a laptop and mainnet. A default that is safe in one
# and catastrophic in the other is not a default, it is a trap with a comment on
# it.
#
# So there is no default. `ADMIN_PASSWORD` must be set, and it must not be the
# value that was published. The check refuses BOTH the old constant and a short
# password, and it refuses before `/auth/register` is called — a bootstrap that
# creates the account and then fails has left the weak credential behind, which
# is the failure mode this whole block exists to prevent.
#
# `ADMIN_EMAIL` and `ADMIN_HANDLE` keep their defaults. Neither is a secret, and
# a wrong guess at either is a visibly wrong account rather than a silent one.
ADMIN_EMAIL=${ADMIN_EMAIL:-estate-admin@example.test}
ADMIN_HANDLE=${ADMIN_HANDLE:-estateadmin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}

# The one value this script may never accept, quoted here so that a search for
# the published string finds the refusal rather than only the history.
PUBLISHED_DEFAULT='correct-horse-battery-staple-42'

if [ -z "$ADMIN_PASSWORD" ]; then
  printf '\033[31mrefusing to bootstrap: ADMIN_PASSWORD is not set.\033[0m\n' >&2
  printf 'Generate one and keep it — nothing else in the estate can recover it:\n\n' >&2
  printf "  ADMIN_PASSWORD=\$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40) \\\\\n" >&2
  printf '    %s\n\n' "$0" >&2
  printf 'Then record it in compose/estate/tokens.env as ESTATE_ADMIN_PASSWORD.\n' >&2
  exit 2
fi

if [ "$ADMIN_PASSWORD" = "$PUBLISHED_DEFAULT" ]; then
  printf '\033[31mrefusing to bootstrap: that password is published in this file.\033[0m\n' >&2
  printf 'It was this script default until 2026-08-09 and is in the public git history.\n' >&2
  exit 2
fi

# 16 is not a considered opinion about entropy; it is a floor below which a
# value is obviously a placeholder. Identity applies the real rules at register.
if [ "${#ADMIN_PASSWORD}" -lt 16 ]; then
  printf '\033[31mrefusing to bootstrap: ADMIN_PASSWORD is shorter than 16 characters.\033[0m\n' >&2
  exit 2
fi

