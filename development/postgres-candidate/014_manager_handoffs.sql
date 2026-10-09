BEGIN;
ALTER TABLE candidate_operations.tasks ADD COLUMN outgoing_id uuid,ADD COLUMN closing_handoff jsonb,
 ADD FOREIGN KEY(outgoing_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 ADD CHECK((outgoing_id IS NULL)=(closing_handoff IS NULL));
DO $constraints$ DECLARE item record; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='candidate_operations.tasks'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%shift_id IS NULL%kind%handoff%' LOOP
  EXECUTE format('ALTER TABLE candidate_operations.tasks DROP CONSTRAINT %I',item.conname);
 END LOOP;
END; $constraints$;
ALTER TABLE candidate_operations.tasks DROP CONSTRAINT tasks_check1,
 ADD CHECK(incoming_id IS NULL OR incoming_id<>assignee_id OR shift_id IS NOT NULL AND outgoing_id IS NOT NULL AND closing_handoff IS NOT NULL AND incoming_id=assignee_id);
CREATE FUNCTION candidate_operations.manager_handoff_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; target candidate_identity.memberships; incoming candidate_identity.memberships;
 task candidate_operations.tasks; shift candidate_operations.shift_references; receipt candidate_operations.command_receipts;
 input jsonb; action text; step text; note text; next_phase text; scope_revision integer; result jsonb; previous_owner uuid; targets uuid[];
BEGIN
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';step:=input->>'step';
 IF action IS NULL OR action NOT IN ('task.create','task.transition') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','recordId','expectedRevision','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT(task.assignee_id=actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR task.outgoing_id IS NOT DISTINCT FROM actor.id OR candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF action='task.create' OR step IN ('verify','fix') THEN
   IF NOT candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
  ELSIF step IN ('accept','dispute') THEN
   IF actor.id IS DISTINCT FROM task.incoming_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  ELSIF step='ready' THEN
   IF actor.id<>task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF action='task.create' THEN
  IF input->>'kind' IS DISTINCT FROM 'handoff' OR NOT input ?& ARRAY['title','detail','kind','ownerId','incomingId','shiftId','due']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','incomingId','shiftId','due'))
  OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') OR p_payload ? 'recordId' OR p_payload ? 'expectedRevision'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
  SELECT * INTO target FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,target.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR incoming.id=target.id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,incoming.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant AND member_id=target.id AND department=target.department AND published AND NOT cancelled AND released_at IS NULL AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR (input->>'due')::timestamptz NOT BETWEEN shift.starts_at AND shift.ends_at THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR length(btrim(input->>'detail')) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_text'; END IF;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind,incoming_id,shift_id,shift_revision)
  VALUES(p_restaurant,target.id,target.department,btrim(input->>'title'),btrim(input->>'detail'),(input->>'due')::timestamptz,'open',1,'handoff',incoming.id,shift.id,shift.revision) RETURNING * INTO task;
  note:=task.detail;step:='assigned';targets:=ARRAY[target.id];
 ELSE
  IF NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) OR step IS NULL OR step NOT IN ('ready','verify','fix','accept','dispute')
  OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
  note:=btrim(input->>'note');IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant AND kind='handoff' AND shift_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF step='ready' AND actor.id<>task.assignee_id OR step IN ('accept','dispute') AND actor.id IS DISTINCT FROM task.incoming_id OR step IN ('verify','fix') AND (actor.id=task.assignee_id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=task.shift_id AND restaurant_id=p_restaurant AND member_id=coalesce(task.outgoing_id,task.assignee_id) AND published AND NOT cancelled AND released_at IS NULL FOR SHARE;
  IF NOT FOUND OR shift.revision<>task.shift_revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
  IF step='ready' THEN
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='verification';
  ELSIF step='verify' THEN
   IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:=CASE WHEN task.outgoing_id IS NULL THEN 'acceptance' ELSE 'closed' END;
  ELSIF step='fix' THEN
   IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
  ELSE
   IF task.phase<>'acceptance' OR task.outgoing_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF step='dispute' THEN next_phase:='correction';ELSE previous_owner:=task.assignee_id;next_phase:='open';END IF;
  END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1,outgoing_id=coalesce(outgoing_id,previous_owner),
   assignee_id=CASE WHEN previous_owner IS NOT NULL THEN actor.id ELSE assignee_id END,
   closing_handoff=CASE WHEN previous_owner IS NOT NULL THEN jsonb_build_object('outgoingId',previous_owner,'acceptedBy',actor.id,'acceptedAt',clock_timestamp()) ELSE closing_handoff END WHERE id=task.id RETURNING * INTO task;
  targets:=ARRAY[task.assignee_id,previous_owner];
  IF task.phase='verification' OR previous_owner IS NOT NULL THEN
   SELECT targets||coalesce(array_agg(id),'{}') INTO targets FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND candidate_operations.closing_manager(id,p_restaurant,task.department,'tasks.manage') AND id<>task.assignee_id;
  END IF;
  IF task.phase='acceptance' THEN targets:=ARRAY[task.incoming_id]; END IF;
 END IF;
 INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,previous_assignee_id,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,step,note,task.phase,previous_owner,task.assignee_id);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',task.id,'revision',task.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) SELECT p_restaurant,id,task.id,task.revision,task.title||': '||task.phase FROM (SELECT DISTINCT unnest(targets) id) recipients WHERE id IS NOT NULL;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.manager_handoff_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION candidate_operations.command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 IF p_payload->>'action'='task.create' AND p_payload->'input'->>'kind'='handoff' AND p_payload->'input' ? 'shiftId'
 OR p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND kind='handoff' AND shift_id IS NOT NULL) THEN
  RETURN candidate_operations.manager_handoff_command(p_subject,p_member,p_restaurant,p_request,p_payload);
 END IF;
 IF p_payload ? 'recordId' AND (EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE task_id=(p_payload->>'recordId')::uuid) OR EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs WHERE task_id=(p_payload->>'recordId')::uuid)) THEN
  RETURN candidate_operations.dish_command(p_subject,p_member,p_restaurant,p_request,p_payload);
 END IF;
 IF p_payload->>'action'='task.dish-pass' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_task_required'; END IF;
 RETURN candidate_operations.command_before_dish(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$body$;

CREATE OR REPLACE FUNCTION candidate_operations.read_task(p_subject text,p_member uuid,p_restaurant text,p_task uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; task candidate_operations.tasks; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO task FROM candidate_operations.tasks WHERE id=p_task AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (task.assignee_id=actor.id OR task.outgoing_id IS NOT DISTINCT FROM actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR (candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,
  'at',recorded_at,'revision',revision,'previousOwnerId',previous_assignee_id,'ownerId',assignee_id) ORDER BY revision),'[]'::jsonb) INTO history
 FROM candidate_operations.task_events WHERE task_id=task.id;
 RETURN jsonb_build_object('id',task.id,'locationId',task.restaurant_id,'ownerId',task.assignee_id,
  'area',task.department,'kind','task','revision',task.revision,'data',jsonb_build_object(
   'title',task.title,'detail',task.detail,'kind',task.kind,'phase',task.phase,'due',task.due,'history',history) || CASE WHEN task.incoming_id IS NOT NULL THEN jsonb_build_object('incomingId',task.incoming_id) ELSE '{}'::jsonb END || CASE WHEN task.shift_id IS NOT NULL THEN jsonb_build_object('shiftId',task.shift_id,'shiftRevision',task.shift_revision)||CASE WHEN task.closing_handoff IS NOT NULL THEN jsonb_build_object('closingHandoff',task.closing_handoff) ELSE '{}'::jsonb END ELSE '{}'::jsonb END);
END;
$body$;

CREATE OR REPLACE FUNCTION candidate_operations.list_tasks(
 p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size';
 END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT id FROM candidate_operations.tasks WHERE restaurant_id=p_restaurant
   AND (assignee_id=actor.id OR outgoing_id IS NOT DISTINCT FROM actor.id OR incoming_id IS NOT DISTINCT FROM actor.id OR (candidate_operations.task_reviewer(actor.id,p_restaurant,department,shift_id)))
   AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(candidate_operations.read_task(p_subject,p_member,p_restaurant,id)
  ORDER BY ordinal),'[]'::jsonb) INTO items
 FROM unnest(selected) WITH ORDINALITY AS entry(id,ordinal) WHERE ordinal<=p_limit;
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
END;
$body$;


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
 IF shift.checkout_profile NOT IN ('ordinary','dishwasher','overnight-manager') OR (shift.checkout_profile IN ('ordinary','overnight-manager') AND shift.position='Dishwasher') OR (shift.checkout_profile='dishwasher' AND shift.position<>'Dishwasher') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checkout_profile_unsupported'; END IF;
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
