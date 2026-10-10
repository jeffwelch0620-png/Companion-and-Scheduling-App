-- Candidate extension only; preserve 001/002 migration history. No Inventory/Supabase adoption.
BEGIN;
ALTER TABLE candidate_identity.memberships ADD COLUMN position text NOT NULL DEFAULT 'Unassigned',
 ADD COLUMN schedule_only boolean NOT NULL DEFAULT false;
CREATE TABLE candidate_identity.membership_capabilities(
 membership_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 capability text NOT NULL CHECK(capability IN ('schedule.manage','schedule.publish','schedule.change','tasks.manage',
 'operations.store','close.verify','close.confirm','standards.approve','orders.request','orders.review',
 'people.manage','people.approve','operations.escalation','location.manage')),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(membership_id,capability)
);
INSERT INTO candidate_identity.membership_capabilities(membership_id,capability)
 SELECT id,'tasks.manage' FROM candidate_identity.memberships WHERE can_manage_tasks;
ALTER TABLE candidate_identity.memberships DROP COLUMN can_manage_tasks;
REVOKE ALL ON candidate_identity.membership_capabilities FROM PUBLIC;
CREATE FUNCTION candidate_operations.task_manager(p_member uuid,p_restaurant text,p_department text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; task_access boolean; location_access boolean;
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant
  AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 -- Lock grants through commit: a concurrent downgrade must wait for this authorized transaction.
 -- Grant administrators must use restaurant-first coordination before changing policy rows.
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='tasks.manage'),
  EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
 INTO task_access,location_access;
 RETURN task_access AND (actor.department=p_department OR location_access);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.task_manager(uuid,text,text) FROM PUBLIC;
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
 action text; input jsonb; old_revision integer; target_id uuid; due_at timestamptz;
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
  -- Manager receipt visibility is rechecked after role changes.
  IF receipt.payload->>'action'='task.create' OR receipt.payload->'input'->>'step' IN ('verify','fix') THEN
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
   OR (input->>'kind') IS DISTINCT FROM 'task'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','due'))
   OR NOT input ?& ARRAY['title','detail','kind','ownerId','due']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_creation';
  END IF;
  target_id:=(input->>'ownerId')::uuid; due_at:=(input->>'due')::timestamptz;
  SELECT * INTO target FROM candidate_identity.memberships
   WHERE id=target_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.task_manager(actor.id,p_restaurant,target.department) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='assignee_denied';
  END IF;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision)
  VALUES(p_restaurant,target.id,target.department,btrim(input->>'title'),btrim(input->>'detail'),due_at,'open',1)
  RETURNING * INTO task;
  verb:='assigned'; note:=task.detail; old_revision:=0;
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
 INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase)
 VALUES(task.id,p_restaurant,task.revision,actor.id,verb,note,task.phase);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant
 RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',task.id,'revision',task.revision,
  'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result)
 VALUES(p_restaurant,actor.id,p_request,p_payload,
  encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF verb='ready' THEN
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
  'at',recorded_at,'revision',revision) ORDER BY revision),'[]'::jsonb) INTO history
 FROM candidate_operations.task_events WHERE task_id=task.id;
 RETURN jsonb_build_object('id',task.id,'locationId',task.restaurant_id,'ownerId',task.assignee_id,
  'area',task.department,'kind','task','revision',task.revision,'data',jsonb_build_object(
   'title',task.title,'detail',task.detail,'kind','task','phase',task.phase,'due',task.due,'history',history));
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
   AND (assignee_id=actor.id OR (candidate_operations.task_manager(actor.id,p_restaurant,department)))
   AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(candidate_operations.read_task(p_subject,p_member,p_restaurant,id)
  ORDER BY ordinal),'[]'::jsonb) INTO items
 FROM unnest(selected) WITH ORDINALITY AS entry(id,ordinal) WHERE ordinal<=p_limit;
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
END;
$body$;

CREATE OR REPLACE FUNCTION candidate_operations.resolve_identity(p_subject text,p_session uuid,p_restaurant text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE member candidate_identity.memberships;
BEGIN
 -- Consistent scope-first locking. Held through command/read by the HTTP transaction.
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 PERFORM 1 FROM candidate_identity.sessions WHERE id=p_session AND subject=p_subject
  AND active AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='session_denied'; END IF;
 SELECT m.* INTO member FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE a.subject=p_subject AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 RETURN jsonb_build_object('subject',p_subject,'membershipId',member.id);
END;
$body$;

COMMIT;
