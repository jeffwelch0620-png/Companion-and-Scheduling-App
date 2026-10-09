-- Candidate only. Explicitly reviewed ordinary checkout; specialty release is excluded.
BEGIN;
ALTER TABLE candidate_operations.shift_references ADD COLUMN checkout_profile text NOT NULL DEFAULT 'unreviewed'
 CHECK(checkout_profile IN ('unreviewed','ordinary','dishwasher','overnight-manager'));
CREATE TABLE candidate_operations.shift_events(
 shift_id uuid NOT NULL,restaurant_id text NOT NULL,revision integer NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,note text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(shift_id,revision),
 FOREIGN KEY(shift_id,restaurant_id) REFERENCES candidate_operations.shift_references(id,restaurant_id),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.shift_notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid NOT NULL,restaurant_id text NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL,message text NOT NULL,
 UNIQUE(shift_id,revision,recipient_id),FOREIGN KEY(shift_id,revision) REFERENCES candidate_operations.shift_events(shift_id,revision),
 FOREIGN KEY(recipient_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON candidate_operations.shift_events,candidate_operations.shift_notification_outbox FROM PUBLIC;
CREATE FUNCTION candidate_operations.release_shift(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; shift candidate_operations.shift_references; receipt candidate_operations.command_receipts;
 input jsonb; note text; result jsonb; scope_revision integer;
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'shift.release' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR NOT input ? 'note' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note')
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_shift_release'; END IF;
 note:=btrim(input->>'note');
 IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND OR actor.id=shift.member_id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,shift.department,'close.confirm') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='release_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND capability='location.manage' AND active;
 IF NOT FOUND THEN
  PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=actor.id AND restaurant_id=p_restaurant AND department=shift.department AND active AND starts_at<=shift.ends_at AND ends_at>=shift.ends_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF shift.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF NOT shift.published OR shift.cancelled OR shift.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
 IF shift.checkout_profile<>'ordinary' OR shift.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checkout_profile_unsupported'; END IF;
 PERFORM 1 FROM candidate_identity.memberships WHERE id=shift.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' AND department=shift.department FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 -- Check actual authoritative candidate rows, never a browser summary/count.
 PERFORM 1 FROM candidate_operations.closes WHERE shift_id=shift.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=shift.id AND phase NOT IN ('closed','cancelled')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=shift.id AND phase='closed' AND attention IS NOT NULL AND attention->'acknowledgment'->>'by' IS DISTINCT FROM manager_id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attention_pending'; END IF;
 PERFORM 1 FROM candidate_operations.tasks WHERE shift_id=shift.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=shift.id AND phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
 UPDATE candidate_operations.shift_references SET released_at=clock_timestamp(),revision=revision+1 WHERE id=shift.id RETURNING * INTO shift;
 INSERT INTO candidate_operations.shift_events(shift_id,restaurant_id,revision,actor_id,action,note) VALUES(shift.id,p_restaurant,shift.revision,actor.id,'released',note);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',shift.id,'revision',shift.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',shift.released_at,'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.shift_notification_outbox(shift_id,restaurant_id,revision,recipient_id,message) VALUES(shift.id,p_restaurant,shift.revision,shift.member_id,note||' This does not change recorded work time.');
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.release_shift(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.release_shift(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
