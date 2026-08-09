// EVERY LINE IN THIS FILE IS CORRECT CODE AND MUST PASS. All of them are real estate lines.
//
// The JS half is where the false-positive risk actually lives: a first cut of this check found
// 102 credential-named literals across the estate and 101 of them were correct code. What is
// exempted below is what took that to zero, and each exemption answers a measured line.

// ── the correct pattern, from `beacon/src/browser/smoke.ts` after its fix
const good = process.env['BEACON_SMOKE_PASSWORD'] ?? ''

// ── a fallback to another variable rather than to a literal
const chained = process.env.CF_TOKEN ?? process.env.ESTATE_TOKEN

// ── a value computed rather than written. `beacon/src/calls.ts`.
const generated = { password: `Bx-${crypto.randomUUID().slice(0, 20)}` }

// ── BROWSER STORAGE KEYS, the single largest source of noise: seventeen frontends spell these
// ── two lines identically in `src/lib/api.ts`, and not one of them is a credential. This is why
// ── a bare KEY counts only in environment-variable vocabulary and must be QUALIFIED in code.
const ACCESS_KEY = 'cf.accessToken'
const REFRESH_KEY = 'cf.refreshToken'
const CONSENT_STORAGE_KEY = 'cf.consent.analytics'
const CHAIN_KEY = 'ember:testnet'

// ── the same argument for PASS. `conformance/src/bodyscan.ts` — which pass of the analyser
// ── produced the record, not a password.
const record = { severity: 'material', pass: 'provenance' }

// ── a name whose last word says the value is an identifier. `custody/src/signing.ts` holds a
// ── public Solana program address; `devplatform/src/webhooks.ts` holds a format prefix.
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SECRET_PREFIX = 'whsec_'
const KEY_SECRET_PREFIX = 'IDENTITY_KEY_SECRET_V'

// ── a quoted key carrying a dot is an event topic, and topics are public by construction — they
// ── are declared in the contracts package. `identity/src/outbox.ts`.
const SECRET_PAYLOAD_KEYS = {
  'identity.password.reset_requested': 'resetUrl',
  'identity.email.verification_requested': 'verifyUrl',
}

// ── prose. `notify/src/catalogue.ts`.
const copy = { password_changed: 'your password was changed' }

// ── a value that asserts it will be REFUSED, which is why it exists: `worlds/src/conformance.ts`
// ── posts it to prove a forged credential gets a 401. Note that `fake-`, `dummy-` and
// ── `throwaway-` are NOT exempt — those claim the value is unimportant, which is the exact
// ── reasoning that published an administrator's password.
const forged = { token: 'not-this-platforms-token' }

// ── a fetch option
const init = { credentials: 'omit' }

// ── an allow marker with a reason on the same line
const legacy = process.env.LEGACY_SERVICE_TOKEN || 'a-literal-token' // secret-hygiene: allow this endpoint is a fixture server that only ever runs on loopback in CI

// ── a comment quoting the defect it documents. `beacon/src/browser/fixtures.ts` and
// ── `analytics/src/env.ts` both do this, and a checker that read raw text would delete the
// ── estate's documentation of its own incidents.
//   ADMIN_PASSWORD=${ADMIN_PASSWORD:-correct-horse-battery-staple-42}
//   const a = process.env.ADMIN_PASSWORD || 'correct-horse-battery-staple-42'

/**
 * The same thing in a block comment, which is how every `env.ts` in the estate documents its
 * compose default: `${ANALYTICS_TOKEN:-estate-placeholder-token-0000000000000000}` and
 * `process.env.SOMETHING_SECRET || 'a-literal-that-is-only-being-described'`.
 */

export { good, chained, generated, record, SECRET_PAYLOAD_KEYS, copy, forged, init, legacy }
