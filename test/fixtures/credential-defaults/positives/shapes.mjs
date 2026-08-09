// Every JS/TS shape the check must refuse. Each of these was a real line in the estate: the `||`
// and `??` fallbacks are `deploy/scripts/seed/lib.mjs` and `beacon/src/cli.ts`, the object
// property is `beacon/src/browser/journeys.ts`, and the four-line `??` chain is
// `ui/scripts/footer-audit.ts` — which is why a logical line has to be judged whole.
//
// This file deliberately does NOT import a test runner. A file that does is treated as test code,
// and the negative fixture beside it proves that.

// 1. `||` against process.env
const a = process.env.ADMIN_PASSWORD || 'correct-horse-battery-staple-42'

// 2. `??` against a bracket lookup
const b = process.env['SIGNING_SECRET'] ?? "a-literal-standing-in-for-a-secret"

// 3. a destructured `env` binding, which is how several services spell it
const c = env.SERVICE_TOKEN || 'a-literal-service-token-value'

// 4. a declaration bound to a literal
const password = 'a-literal-password-in-a-const'

// 5. a qualified key name in a declaration
export const API_KEY = 'cfk_live_aaaaaaaaaaaaaaaaaaaa'

// 6. an object property, the shape a credential is actually posted in
const body = {
  email: 'someone@example.test',
  password: 'correct-horse-battery-staple-42',
}

// 7. a chain spread over four lines, with the literal on the last one
const operator = {
  password:
    process.env['CF_FOOTER_PASSWORD'] ??
    process.env['BEACON_SMOKE_PASSWORD'] ??
    'correct-horse-battery-staple-42',
}

export { a, b, c, password, body, operator }
