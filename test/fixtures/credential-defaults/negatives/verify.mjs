// A FILE THAT IMPORTS A TEST RUNNER IS TEST CODE, whatever it is named and wherever it sits.
// `market/scripts/verify.ts` and `worlds/scripts/verify.ts` are harnesses living under
// `scripts/`; both pull `../src/testsupport.ts` and both hold a fixture secret. Exempting by
// directory alone would have failed both, and renaming them to satisfy a checker is the wrong
// direction of causation.
import { fakeLedger, migrateTestDb, openDb } from '../src/testsupport.ts'

const SECRET = 'a-real-looking-secret-of-sufficient-length'

export { fakeLedger, migrateTestDb, openDb, SECRET }
