-- Fictional local review evidence; no runtime ingestion privilege.
BEGIN;
CREATE TABLE candidate_operations.schedule_reconciliation_receipts(
 batch_id uuid PRIMARY KEY,restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),source_snapshot jsonb NOT NULL,
 target_time_off jsonb NOT NULL,review_note text NOT NULL CHECK(length(btrim(review_note)) BETWEEN 1 AND 2000),
 expected_scope_revision integer NOT NULL CHECK(expected_scope_revision>=0),result jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(batch_id,restaurant_id)
);
ALTER TABLE candidate_operations.schedule_input_reviews ADD COLUMN evidence_batch_id uuid,
 ADD FOREIGN KEY(evidence_batch_id,restaurant_id) REFERENCES candidate_operations.schedule_reconciliation_receipts(batch_id,restaurant_id);
REVOKE ALL ON candidate_operations.schedule_reconciliation_receipts FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.invalidate_schedule_inputs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE scope_id text;
BEGIN
 IF TG_TABLE_NAME='schedule_eligibility' THEN
  SELECT restaurant_id INTO scope_id FROM candidate_identity.memberships WHERE id=(CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'member_id' ELSE to_jsonb(NEW)->>'member_id' END)::uuid;
 ELSE scope_id:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'restaurant_id' ELSE to_jsonb(NEW)->>'restaurant_id' END; END IF;
 UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=scope_id;
 IF TG_TABLE_NAME='schedule_eligibility' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'member_id'<>to_jsonb(NEW)->>'member_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=(SELECT restaurant_id FROM candidate_identity.memberships WHERE id=(to_jsonb(OLD)->>'member_id')::uuid);
 END IF;
 IF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'restaurant_id'<>to_jsonb(NEW)->>'restaurant_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=to_jsonb(OLD)->>'restaurant_id';
 END IF;
 RETURN NULL;
END;
$body$;
CREATE TRIGGER invalidate_roster_review AFTER INSERT OR UPDATE OR DELETE ON candidate_identity.memberships FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_schedule_inputs();
CREATE TRIGGER invalidate_job_review AFTER INSERT OR UPDATE OR DELETE ON candidate_identity.schedule_eligibility FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_schedule_inputs();
CREATE FUNCTION candidate_operations.check_time_off_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 IF TG_OP='UPDATE' AND OLD.restaurant_id<>NEW.restaurant_id THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=OLD.restaurant_id;
 END IF;
 IF TG_OP<>'DELETE' THEN
  -- Managed commands write exact audit snapshots in this transaction.
  IF EXISTS(SELECT 1 FROM candidate_operations.time_off_events WHERE request_id=NEW.id AND revision=NEW.revision AND data=to_jsonb(NEW)) THEN RETURN NULL; END IF;
  -- Reconciliation archives the final target representation before commit.
  IF EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews g JOIN candidate_operations.schedule_reconciliation_receipts r ON r.batch_id=g.evidence_batch_id AND r.restaurant_id=g.restaurant_id
   WHERE g.restaurant_id=NEW.restaurant_id AND g.time_off_complete AND r.target_time_off @> jsonb_build_array(to_jsonb(NEW))) THEN RETURN NULL; END IF;
 END IF;
 UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=CASE WHEN TG_OP='DELETE' THEN OLD.restaurant_id ELSE NEW.restaurant_id END;
 IF TG_OP='UPDATE' AND OLD.restaurant_id<>NEW.restaurant_id THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=OLD.restaurant_id;
 END IF;
 RETURN NULL;
END;
$body$;
CREATE CONSTRAINT TRIGGER check_time_off_review AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.time_off_references DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION candidate_operations.check_time_off_evidence();
REVOKE ALL ON FUNCTION candidate_operations.invalidate_schedule_inputs(),candidate_operations.check_time_off_evidence() FROM PUBLIC,candidate_runtime;
COMMIT;
