-- Candidate only, applies after 003. Handoffs and checkout links remain excluded.
BEGIN;
ALTER TABLE candidate_operations.tasks ADD COLUMN kind text NOT NULL DEFAULT 'task' CHECK(kind IN ('task','issue'));
ALTER TABLE candidate_operations.task_events ADD COLUMN previous_assignee_id uuid, ADD COLUMN assignee_id uuid;
UPDATE candidate_operations.task_events e SET assignee_id=t.assignee_id FROM candidate_operations.tasks t WHERE t.id=e.task_id;
ALTER TABLE candidate_operations.task_events ALTER COLUMN assignee_id SET NOT NULL,
 ADD FOREIGN KEY(previous_assignee_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 ADD FOREIGN KEY(assignee_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id);
CREATE OR REPLACE FUNCTION candidate_operations.command(
 p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $body$
DECLARE
 actor candidate_identity.memberships;
 target candidate_identity.memberships;
 task candidate_operations.tasks;
 receipt candidate_operations.command_receipts;
 scope_revision integer; result jsonb; next_phase text; verb text; note text;
 action text; input jsonb; old_revision integer; target_id uuid; due_at timestamptz; previous_assignee uuid;
BEGIN
 -- The subject is trusted backend input, never a browser-selected actor.
 IF p_subject IS NULL OR p_member IS NULL OR p_restaurant IS NULL OR p_request IS NULL
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command';
 END IF;
 -- Scope coordination serializes commands. Identity administration must use the same
 -- scope-first ordering; member SHARE locks also prevent revocation during this commit.
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants
 WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND a.subject=p_subject AND m.active AND NOT m.schedule_only
 FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts
 WHERE restaurant_id=p_restaurant AND actor_id=actor.id AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict';
  END IF;
  -- Recheck receipt visibility after grants or responsibility change.
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT (task.assignee_id=actor.id OR candidate_operations.task_manager(actor.id,p_restaurant,task.department)) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF receipt.payload->>'action'='task.transition' AND receipt.payload->'input'->>'step'='ready' AND task.assignee_id<>actor.id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
  END IF;
  IF receipt.payload->>'action' IN ('task.create','task.reassign') OR receipt.payload->'input'->>'step' IN ('verify','fix') THEN
   SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
   IF NOT FOUND OR NOT candidate_operations.task_manager(actor.id,p_restaurant,task.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  END IF;
  RETURN receipt.result || jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
  WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unexpected_field';
 END IF;
 action:=p_payload->>'action'; input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_input';
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_capture_time';
  END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 IF action='task.create' THEN
  IF NOT candidate_operations.task_manager(actor.id,p_restaurant,actor.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision'
   OR (input->>'kind') IS NULL OR (input->>'kind') NOT IN ('task','issue')
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','due'))
   OR NOT input ?& ARRAY['title','detail','kind','ownerId','due']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_creation';
  END IF;
  target_id:=(input->>'ownerId')::uuid; due_at:=(input->>'due')::timestamptz;
  SELECT * INTO target FROM candidate_identity.memberships
   WHERE id=target_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.task_manager(actor.id,p_restaurant,target.department) OR target.position='Dishwasher' AND input->>'kind'<>'task' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='assignee_denied';
  END IF;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind)
  VALUES(p_restaurant,target.id,target.department,btrim(input->>'title'),btrim(input->>'detail'),due_at,'open',1,input->>'kind')
  RETURNING * INTO task;
  verb:='assigned'; note:=task.detail; old_revision:=0;
 ELSIF action='task.reassign' THEN
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision']
   OR jsonb_typeof(p_payload->'recordId')<>'string' OR jsonb_typeof(p_payload->'expectedRevision')<>'number'
   OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
   OR NOT input ?& ARRAY['ownerId','note']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('ownerId','note'))
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_reassignment';
  END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR NOT candidate_operations.task_manager(actor.id,p_restaurant,task.department) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  SELECT * INTO target FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR target.department<>task.department OR NOT candidate_operations.task_manager(actor.id,p_restaurant,target.department)
   OR target.position='Dishwasher' AND task.kind<>'task' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='assignee_denied';
  END IF;
  note:=btrim(input->>'note');
  IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
  previous_assignee:=task.assignee_id;old_revision:=task.revision;verb:='reassigned';
  note:=previous_assignee::text||' → '||target.id::text||': '||note;
  UPDATE candidate_operations.tasks SET assignee_id=target.id,phase='open',revision=revision+1 WHERE id=task.id RETURNING * INTO task;
 ELSIF action='task.transition' THEN
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision']
   OR jsonb_typeof(p_payload->'recordId')<>'string'
   OR jsonb_typeof(p_payload->'expectedRevision')<>'number'
   OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note'))
   OR NOT input ?& ARRAY['step','note']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_transition'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks
  WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF NOT (task.assignee_id=actor.id OR (candidate_operations.task_manager(actor.id,p_restaurant,task.department))) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict';
  END IF;
  verb:=input->>'step'; note:=btrim(input->>'note'); old_revision:=task.revision;
  IF length(note) NOT BETWEEN 1 AND 8000 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note';
  END IF;
  IF verb='ready' THEN
   IF actor.position='Dishwasher' AND task.kind<>'task' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   IF task.assignee_id<>actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:='verification';
  ELSIF verb IN ('verify','fix') THEN
   IF NOT candidate_operations.task_manager(actor.id,p_restaurant,task.department) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
   END IF;
   IF verb='verify' THEN
    IF actor.id=task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='self_verification_denied'; END IF;
    IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
    next_phase:='closed';
   ELSE
    IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
    next_phase:='correction';
   END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_step'; END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1
  WHERE id=task.id RETURNING * INTO task;
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_action'; END IF;
 INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,previous_assignee_id,assignee_id)
 VALUES(task.id,p_restaurant,task.revision,actor.id,verb,note,task.phase,previous_assignee,task.assignee_id);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant
 RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',task.id,'revision',task.revision,
  'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result)
 VALUES(p_restaurant,actor.id,p_request,p_payload,
  encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF verb='reassigned' THEN
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  SELECT p_restaurant,recipient,task.id,task.revision,task.title||': responsibility changed'
  FROM (SELECT DISTINCT unnest(ARRAY[previous_assignee,task.assignee_id]) AS recipient) recipients;
 ELSIF verb='ready' THEN
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  SELECT p_restaurant,id,task.id,task.revision,task.title||': '||task.phase
  FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND active
   AND candidate_operations.task_manager(id,p_restaurant,task.department) AND id<>task.assignee_id;
 ELSE
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  VALUES(p_restaurant,task.assignee_id,task.id,task.revision,task.title||': '||task.phase);
 END IF;
 RETURN result;
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
 IF NOT FOUND OR NOT (task.assignee_id=actor.id OR (candidate_operations.task_manager(actor.id,p_restaurant,task.department))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,
  'at',recorded_at,'revision',revision,'previousOwnerId',previous_assignee_id,'ownerId',assignee_id) ORDER BY revision),'[]'::jsonb) INTO history
 FROM candidate_operations.task_events WHERE task_id=task.id;
 RETURN jsonb_build_object('id',task.id,'locationId',task.restaurant_id,'ownerId',task.assignee_id,
  'area',task.department,'kind','task','revision',task.revision,'data',jsonb_build_object(
   'title',task.title,'detail',task.detail,'kind',task.kind,'phase',task.phase,'due',task.due,'history',history));
END;
$body$;

COMMIT;
