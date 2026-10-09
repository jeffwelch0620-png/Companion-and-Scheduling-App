-- Candidate: Dishwasher date and per-participant checkout gates. Overnight manager release stays excluded.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.release_shift(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
#variable_conflict use_variable
DECLARE actor candidate_identity.memberships; shift candidate_operations.shift_references; receipt candidate_operations.command_receipts;
 input jsonb; note text; result jsonb; scope_revision integer; cycle_id uuid; checkout candidate_operations.dish_participants; checkout_date date; restaurant_timezone text;
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
 IF shift.checkout_profile NOT IN ('ordinary','dishwasher') OR (shift.checkout_profile='ordinary' AND shift.position='Dishwasher') OR (shift.checkout_profile='dishwasher' AND shift.position<>'Dishwasher') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checkout_profile_unsupported'; END IF;
 PERFORM 1 FROM candidate_identity.memberships WHERE id=shift.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND (position<>'Dishwasher' OR shift.checkout_profile='dishwasher' AND position='Dishwasher') AND department=shift.department FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF shift.checkout_profile='dishwasher' THEN
  SELECT timezone INTO restaurant_timezone FROM candidate_identity.restaurants WHERE id=p_restaurant;
  checkout_date:=(shift.starts_at AT TIME ZONE restaurant_timezone)::date;
  SELECT id INTO cycle_id FROM candidate_operations.dish_cycles WHERE restaurant_id=p_restaurant AND business_date=checkout_date FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.dish_shape(cycle_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
  SELECT * INTO checkout FROM candidate_operations.dish_participants WHERE dish_participants.cycle_id=cycle_id AND member_id=shift.member_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
  PERFORM 1 FROM candidate_operations.tasks WHERE id=checkout.task_id AND phase='closed' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  IF checkout.slot=0 THEN
   IF EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND (h.accepted_by IS DISTINCT FROM t.assignee_id OR h.accepted_at IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND t.assignee_id=shift.member_id AND t.phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  END IF;
 END IF;
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

COMMIT;
