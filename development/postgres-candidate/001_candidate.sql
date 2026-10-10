-- Isolated review candidate. Do not apply to Inventory or hosted Supabase.
BEGIN;
CREATE SCHEMA candidate_identity;
CREATE SCHEMA candidate_operations;
REVOKE ALL ON SCHEMA candidate_identity, candidate_operations FROM PUBLIC;

CREATE TABLE candidate_identity.restaurants(
 id text PRIMARY KEY CHECK(length(btrim(id)) BETWEEN 1 AND 100),
 name text NOT NULL, timezone text NOT NULL DEFAULT 'America/New_York',
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TABLE candidate_identity.people(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL
);
CREATE TABLE candidate_identity.auth_links(
 subject text PRIMARY KEY, person_id uuid NOT NULL UNIQUE REFERENCES candidate_identity.people(id)
);
CREATE TABLE candidate_identity.memberships(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 person_id uuid NOT NULL REFERENCES candidate_identity.people(id),
 restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 department text NOT NULL, active boolean NOT NULL DEFAULT true,
 can_manage_tasks boolean NOT NULL DEFAULT false,
 UNIQUE(person_id,restaurant_id), UNIQUE(id,restaurant_id)
);
-- Flexible relationships are a proposal; this fixture does not grant access by job.
CREATE TABLE candidate_identity.job_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), membership_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 department text NOT NULL, job text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE candidate_operations.tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 assignee_id uuid NOT NULL, department text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 detail text NOT NULL CHECK(length(btrim(detail)) BETWEEN 1 AND 8000),
 due timestamptz NOT NULL,
 phase text NOT NULL CHECK(phase IN ('open','correction','verification','closed')),
 revision integer NOT NULL CHECK(revision>0),
 UNIQUE(id,restaurant_id),
 FOREIGN KEY(assignee_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.task_events(
 task_id uuid NOT NULL, restaurant_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), actor_id uuid NOT NULL,
 action text NOT NULL, note text NOT NULL, phase text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,revision),
 FOREIGN KEY(task_id,restaurant_id) REFERENCES candidate_operations.tasks(id,restaurant_id),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.command_receipts(
 restaurant_id text NOT NULL, actor_id uuid NOT NULL, request_id uuid NOT NULL,
 payload jsonb NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(restaurant_id,actor_id,request_id),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id text NOT NULL, recipient_id uuid NOT NULL,
 task_id uuid NOT NULL, revision integer NOT NULL, message text NOT NULL,
 delivered_at timestamptz,
 UNIQUE(task_id,revision,recipient_id),
 FOREIGN KEY(recipient_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(task_id,revision) REFERENCES candidate_operations.task_events(task_id,revision),
 FOREIGN KEY(task_id,restaurant_id) REFERENCES candidate_operations.tasks(id,restaurant_id)
);

CREATE FUNCTION candidate_operations.command(
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
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND a.subject=p_subject AND m.active
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
   IF NOT actor.can_manage_tasks THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
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
  IF NOT actor.can_manage_tasks THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision'
   OR (input->>'kind') IS DISTINCT FROM 'task'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','due'))
   OR NOT input ?& ARRAY['title','detail','kind','ownerId','due']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_creation';
  END IF;
  target_id:=(input->>'ownerId')::uuid; due_at:=(input->>'due')::timestamptz;
  SELECT * INTO target FROM candidate_identity.memberships
   WHERE id=target_id AND restaurant_id=p_restaurant AND active FOR SHARE;
  IF NOT FOUND OR target.department<>actor.department THEN
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
  IF NOT (task.assignee_id=actor.id OR (actor.can_manage_tasks AND task.department=actor.department)) THEN
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
   IF NOT actor.can_manage_tasks OR actor.department<>task.department THEN
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
   AND can_manage_tasks AND department=task.department AND id<>task.assignee_id;
 ELSE
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  VALUES(p_restaurant,task.assignee_id,task.id,task.revision,task.title||': '||task.phase);
 END IF;
 RETURN result;
END;
$body$;
REVOKE ALL ON ALL TABLES IN SCHEMA candidate_identity,candidate_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
CREATE FUNCTION candidate_operations.read_task(p_subject text,p_member uuid,p_restaurant text,p_task uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; task candidate_operations.tasks; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO task FROM candidate_operations.tasks WHERE id=p_task AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (task.assignee_id=actor.id OR (actor.can_manage_tasks AND task.department=actor.department)) THEN
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
REVOKE ALL ON FUNCTION candidate_operations.read_task(text,uuid,text,uuid) FROM PUBLIC;
COMMIT;
