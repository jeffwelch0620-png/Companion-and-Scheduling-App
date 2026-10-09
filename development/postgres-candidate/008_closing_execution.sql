-- Isolated candidate: ordinary closing execution. Attention/helper workflows remain excluded.
BEGIN;
ALTER TABLE candidate_operations.closes ADD COLUMN answers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(answers)='array');
ALTER TABLE candidate_operations.close_events ADD COLUMN answers jsonb;
CREATE FUNCTION candidate_operations.transition_close(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; assigned candidate_operations.closes; shift candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; input jsonb; step text; note text; next_phase text; result jsonb; scope_revision integer;
 is_manager boolean:=false; is_verifier boolean:=false; required_count integer;
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'close.transition' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note','answers'))
 OR jsonb_typeof(input->'step') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number'
 OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_transition'; END IF;
 step:=input->>'step';note:=btrim(input->>'note');
 IF step NOT IN ('ready','verify','confirm','fix') OR length(note) NOT BETWEEN 1 AND 8000
 OR step<>'ready' AND input ? 'answers' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_transition'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_denied'; END IF;
 -- Recheck actor authorization even when returning an already committed receipt.
 IF actor.id=assigned.manager_id AND candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'close.confirm') THEN
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND capability='location.manage' AND active;
  IF FOUND THEN is_manager:=true; ELSE
   PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=actor.id AND restaurant_id=p_restaurant AND department=assigned.department
    AND active AND starts_at<=assigned.due AND ends_at>=assigned.due FOR SHARE;
   is_manager:=FOUND;
  END IF;
 END IF;
 IF actor.id IS NOT DISTINCT FROM assigned.verifier_id THEN
  is_verifier:=candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'close.verify');
 END IF;
 IF step='ready' AND actor.id<>assigned.owner_id OR step='verify' AND NOT is_verifier
 OR step='confirm' AND NOT is_manager OR step='fix' AND NOT (is_verifier OR is_manager)
 OR step IN ('verify','confirm','fix') AND actor.id=assigned.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF assigned.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=assigned.shift_id AND restaurant_id=p_restaurant FOR SHARE;
 IF NOT FOUND OR NOT shift.published OR shift.cancelled OR shift.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 IF shift.revision<>assigned.shift_revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
 PERFORM 1 FROM candidate_operations.standard_references WHERE id=assigned.standard_id AND restaurant_id=p_restaurant AND status='approved' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='standard_denied'; END IF;
 IF step='ready' THEN
  IF assigned.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  required_count:=jsonb_array_length(assigned.standard_snapshot->'criteria');
  IF jsonb_typeof(input->'answers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='required_conditions_missing'; END IF;
  IF jsonb_array_length(input->'answers')<>required_count OR EXISTS(
   SELECT 1 FROM generate_series(0,required_count-1) n WHERE NOT (input->'answers' @> jsonb_build_array(n))
  ) OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'answers') a WHERE jsonb_typeof(a)<>'number' OR a::text !~ '^(0|[1-9][0-9]*)$')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='required_conditions_missing'; END IF;
  next_phase:=CASE WHEN assigned.verifier_id IS NULL THEN 'manager-confirmation' ELSE 'verification' END;
 ELSIF step='verify' THEN
  IF assigned.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='manager-confirmation';
 ELSIF step='confirm' THEN
  IF assigned.phase<>'manager-confirmation' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='closed';
 ELSE
  IF assigned.phase IN ('closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
 END IF;
 UPDATE candidate_operations.closes SET phase=next_phase,revision=revision+1,
  answers=CASE WHEN step='ready' THEN input->'answers' WHEN step='fix' THEN '[]'::jsonb ELSE answers END
 WHERE id=assigned.id RETURNING * INTO assigned;
 INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note,answers)
 VALUES(assigned.id,p_restaurant,assigned.revision,actor.id,step,note,CASE WHEN step='ready' THEN assigned.answers ELSE NULL END);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',assigned.id,'revision',assigned.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result)
 VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message)
 SELECT assigned.id,p_restaurant,assigned.revision,id,(assigned.standard_snapshot->>'title')||': '||next_phase
 FROM (SELECT DISTINCT unnest(CASE next_phase WHEN 'verification' THEN ARRAY[assigned.verifier_id]
  WHEN 'manager-confirmation' THEN ARRAY[assigned.manager_id] WHEN 'correction' THEN ARRAY[assigned.owner_id,assigned.manager_id] ELSE ARRAY[assigned.owner_id] END) id) targets WHERE id IS NOT NULL;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.transition_close(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.transition_close(text,uuid,text,uuid,jsonb) TO candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.read_close(p_subject text,p_member uuid,p_restaurant text,p_close uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; assigned candidate_operations.closes; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=p_close AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (actor.id=assigned.owner_id OR actor.id=assigned.manager_id OR actor.id IS NOT DISTINCT FROM assigned.verifier_id OR candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at)||CASE WHEN answers IS NOT NULL THEN jsonb_build_object('answers',answers) ELSE '{}'::jsonb END ORDER BY revision),'[]') INTO history FROM candidate_operations.close_events WHERE close_id=assigned.id;
 RETURN jsonb_build_object('id',assigned.id,'kind','close','locationId',assigned.restaurant_id,'area',assigned.department,'ownerId',assigned.owner_id,'revision',assigned.revision,
  'data',jsonb_build_object('shiftId',assigned.shift_id,'standardId',assigned.standard_id,'standardRevision',assigned.standard_revision,'standard',assigned.standard_snapshot,'managerId',assigned.manager_id,'due',assigned.due,'phase',assigned.phase,'answers',assigned.answers,'history',history)||CASE WHEN assigned.verifier_id IS NOT NULL THEN jsonb_build_object('verifierId',assigned.verifier_id) ELSE '{}'::jsonb END);
END;
$body$;

COMMIT;
