// A TEST FILE IS EXEMPT BY PATH, and it has to be: the estate puts throwaway credentials in
// fixtures on purpose and there are about a hundred of them —
// `const SECRET = 'K2sN4vQ8xR1wB6tY9zL3mF7hC5jD0pA4'` appears in nine services' suites, and
// `contracts/packages/auth/src/index.test.ts` needs a real-looking password to test the rules
// that reject bad ones. Requiring an inline marker on every one of those lines would make the
// marker a reflex, and a reflex marker exempts the next real defect too.
//
// `service-ci.yml`'s rule 1 already draws the line in the same place.
import { test } from 'node:test'

const SECRET = 'K2sN4vQ8xR1wB6tY9zL3mF7hC5jD0pA4'
const password = 'correct-horse-battery-staple-42'

test('a fixture credential is not a finding', () => {
  void SECRET
  void password
})
