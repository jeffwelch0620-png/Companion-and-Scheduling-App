-- Explicit runtime grants previously supplied by local setup, now versioned.
-- Trusted backend still binds subject/session and rechecks current membership.
BEGIN;
GRANT EXECUTE ON FUNCTION candidate_operations.resolve_identity(text,uuid,text),
 candidate_operations.list_tasks(text,uuid,text,uuid,integer) TO candidate_runtime;
COMMIT;
