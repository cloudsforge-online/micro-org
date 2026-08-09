# THE DEFECT, VERBATIM. Lifted from `deploy/scripts/estate-bootstrap.sh` as it stood at the commit
# before `fix(security): delete the published estate administrator password` (micro-deploy #13),
# comment and all. This is not a paraphrase and must never become one: the whole claim of the
# check that reads it is that it would have caught THIS, and a fixture somebody tidied proves
# nothing about the text that was really committed.
#
# It is `sh` rather than `.sh.txt` because the checker decides what to read by extension, so a
# fixture with a safe extension would test a code path CI never takes.
# A throwaway operator for a throwaway environment. Overridable so a developer
# can bootstrap an account they will actually sign in as.
ADMIN_EMAIL=${ADMIN_EMAIL:-estate-admin@example.test}
ADMIN_HANDLE=${ADMIN_HANDLE:-estateadmin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-correct-horse-battery-staple-42}
