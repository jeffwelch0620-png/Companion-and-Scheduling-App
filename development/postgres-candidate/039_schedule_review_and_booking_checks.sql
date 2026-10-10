-- Corrective candidate migration. 038 is reserved by the dependent policy PR.
-- Preserve published migrations; use explicit definitions in the shared port.
BEGIN;

CREATE OR REPLACE FUNCTION candidate_operations.invalidate_schedule_inputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE scope_id text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='memberships' THEN
   IF ROW(OLD.restaurant_id,OLD.department,OLD.position,OLD.active,OLD.schedule_only,OLD.person_id)
    IS NOT DISTINCT FROM ROW(NEW.restaurant_id,NEW.department,NEW.position,NEW.active,NEW.schedule_only,NEW.person_id)
   THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME='schedule_eligibility' THEN
   IF ROW(OLD.member_id,OLD.job,OLD.source,OLD.active)
    IS NOT DISTINCT FROM ROW(NEW.member_id,NEW.job,NEW.source,NEW.active)
   THEN RETURN NULL; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='schedule_eligibility' THEN
  SELECT restaurant_id INTO scope_id FROM candidate_identity.memberships
   WHERE id=(CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'member_id' ELSE to_jsonb(NEW)->>'member_id' END)::uuid;
 ELSE scope_id:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'restaurant_id' ELSE to_jsonb(NEW)->>'restaurant_id' END; END IF;
 UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=scope_id;
 IF TG_TABLE_NAME='schedule_eligibility' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'member_id' IS DISTINCT FROM to_jsonb(NEW)->>'member_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL
   WHERE restaurant_id=(SELECT restaurant_id FROM candidate_identity.memberships WHERE id=(to_jsonb(OLD)->>'member_id')::uuid);
 END IF;
 IF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'restaurant_id' IS DISTINCT FROM to_jsonb(NEW)->>'restaurant_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=to_jsonb(OLD)->>'restaurant_id';
 END IF;
 RETURN NULL;
END;
$body$;

CREATE OR REPLACE FUNCTION candidate_operations.person_shift_conflict(p_member uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT EXISTS(
  SELECT 1 FROM candidate_identity.memberships target
  JOIN candidate_operations.person_shift_bookings booking ON booking.person_id=target.person_id
  WHERE target.id=p_member AND booking.shift_id IS DISTINCT FROM p_exclude
   AND booking.period && tstzrange(p_start,p_end,'[)')
 );
$body$;

DROP TRIGGER ab_check_person_shift ON candidate_operations.shift_references;
CREATE TRIGGER ab_check_person_shift BEFORE INSERT ON candidate_operations.shift_references
 FOR EACH ROW EXECUTE FUNCTION candidate_operations.check_person_shift();
CREATE TRIGGER ab_check_person_shift_update BEFORE UPDATE ON candidate_operations.shift_references
 FOR EACH ROW WHEN (ROW(OLD.member_id,OLD.starts_at,OLD.ends_at,OLD.cancelled)
  IS DISTINCT FROM ROW(NEW.member_id,NEW.starts_at,NEW.ends_at,NEW.cancelled))
 EXECUTE FUNCTION candidate_operations.check_person_shift();
-- The private projection and exclusion constraint remain atomic and authoritative.
COMMIT;
