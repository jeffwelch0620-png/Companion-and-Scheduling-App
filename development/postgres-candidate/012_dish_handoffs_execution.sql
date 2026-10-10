BEGIN;
CREATE TABLE candidate_operations.dish_handoffs(
 task_id uuid PRIMARY KEY,restaurant_id text NOT NULL,cycle_id uuid NOT NULL,source_id uuid NOT NULL,
 accepted_by uuid,accepted_at timestamptz,CHECK((accepted_by IS NULL)=(accepted_at IS NULL)),
 FOREIGN KEY(task_id,restaurant_id) REFERENCES candidate_operations.tasks(id,restaurant_id),
 FOREIGN KEY(source_id,restaurant_id) REFERENCES candidate_operations.tasks(id,restaurant_id),
 FOREIGN KEY(cycle_id,restaurant_id) REFERENCES candidate_operations.dish_cycles(id,restaurant_id),
 FOREIGN KEY(accepted_by,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON candidate_operations.dish_handoffs FROM PUBLIC;
CREATE FUNCTION candidate_operations.dish_shape(p_cycle uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT (SELECT count(*) FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle)=3
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=p_cycle AND (t.assignee_id<>p.member_id OR t.department<>'BOH' OR t.kind<>'task' OR t.restaurant_id<>p.restaurant_id))
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=p_cycle AND
 (t.department<>'BOH' OR t.kind<>'task' OR t.restaurant_id<>h.restaurant_id OR NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p WHERE p.cycle_id=p_cycle AND p.slot=0 AND p.task_id=h.source_id)
 OR NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p WHERE p.cycle_id=p_cycle AND p.slot IN (1,2) AND p.member_id=t.assignee_id)
 OR h.accepted_by IS NOT NULL AND h.accepted_by<>t.assignee_id));
$body$;
CREATE FUNCTION candidate_operations.dish_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
#variable_conflict use_variable
DECLARE actor candidate_identity.memberships; incoming candidate_identity.memberships; task candidate_operations.tasks; source candidate_operations.tasks;
 link candidate_operations.dish_handoffs; participant candidate_operations.dish_participants; receipt candidate_operations.command_receipts;
 input jsonb; action text; step text; note text; next_phase text; cycle_id uuid; child_id uuid; due_at timestamptz;
 manager boolean; scope_revision integer; result jsonb; targets uuid[];
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';step:=input->>'step';note:=btrim(input->>'note');
 IF action IS NULL OR action NOT IN ('task.dish-pass','task.transition') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(note) NOT BETWEEN 1 AND 8000
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 IF action='task.dish-pass' THEN
  IF NOT input ?& ARRAY['incomingId','due','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('incomingId','due','note')) OR jsonb_typeof(input->'incomingId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'due') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 ELSE
  IF step IS NULL OR step NOT IN ('ready','verify','fix','accept') OR NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
 SELECT * INTO participant FROM candidate_operations.dish_participants WHERE task_id=task.id;
 SELECT * INTO link FROM candidate_operations.dish_handoffs WHERE task_id=task.id;
 cycle_id:=coalesce(participant.cycle_id,link.cycle_id);
 IF cycle_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_task_required'; END IF;
 manager:=candidate_operations.dish_manager(actor.id,p_restaurant);
 IF action='task.dish-pass' OR step IN ('ready','accept') THEN
  IF actor.id<>task.assignee_id OR actor.position<>'Dishwasher' OR actor.department<>'BOH' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_owner_denied'; END IF;
 ELSE
  IF NOT manager OR actor.id=task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF NOT candidate_operations.dish_shape(cycle_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
 IF action='task.dish-pass' THEN
  IF participant.slot IS DISTINCT FROM 0 OR task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position='Dishwasher' AND department='BOH' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  PERFORM 1 FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=cycle_id AND p.slot IN (1,2) AND p.member_id=incoming.id AND t.phase IN ('open','correction') FOR SHARE OF p,t;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  due_at:=(input->>'due')::timestamptz;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind) VALUES(p_restaurant,incoming.id,'BOH',left('Unfinished AM work: '||task.title,200),note,due_at,'open',1,'task') RETURNING id INTO child_id;
  INSERT INTO candidate_operations.dish_handoffs(task_id,restaurant_id,cycle_id,source_id) VALUES(child_id,p_restaurant,cycle_id,task.id);
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(child_id,p_restaurant,1,actor.id,'passed',note,'open',incoming.id);
  UPDATE candidate_operations.tasks SET revision=revision+1 WHERE id=task.id RETURNING * INTO task;
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,'passed',note||' Linked work: '||child_id,task.phase,task.assignee_id);
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) VALUES(p_restaurant,incoming.id,child_id,1,'Unfinished AM work awaits acceptance: '||note);
  result:=jsonb_build_object('recordId',child_id,'revision',1);
 ELSE
  IF step='accept' THEN
   IF link.task_id IS NULL OR link.accepted_by IS NOT NULL OR task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   UPDATE candidate_operations.dish_handoffs SET accepted_by=actor.id,accepted_at=clock_timestamp() WHERE task_id=task.id;
   UPDATE candidate_operations.tasks SET revision=revision+1 WHERE id=link.source_id RETURNING * INTO source;
   INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(source.id,p_restaurant,source.revision,actor.id,'incoming-accepted',note||' Linked work: '||task.id,source.phase,source.assignee_id);
   next_phase:=task.phase;
  ELSIF step='ready' THEN
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF link.task_id IS NOT NULL AND link.accepted_by IS DISTINCT FROM actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='acceptance_required'; END IF;
   IF participant.slot IN (1,2) AND EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND t.assignee_id=actor.id AND t.phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
   next_phase:='verification';
  ELSIF step='verify' THEN
   IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='closed';
  ELSE
   IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
  END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1 WHERE id=task.id RETURNING * INTO task;
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,step,note,task.phase,task.assignee_id);
  IF step IN ('ready','accept') THEN
   SELECT array_agg(id) INTO targets FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND candidate_operations.dish_manager(id,p_restaurant);
  ELSE targets:=ARRAY[task.assignee_id]; END IF;
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) SELECT p_restaurant,id,task.id,task.revision,task.title||': '||step FROM (SELECT DISTINCT unnest(targets) id) recipients WHERE id IS NOT NULL;
  result:=jsonb_build_object('recordId',task.id,'revision',task.revision);
 END IF;
 UPDATE candidate_operations.dish_cycles SET revision=revision+1 WHERE id=cycle_id;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=result||jsonb_build_object('workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
CREATE OR REPLACE FUNCTION candidate_operations.command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 IF p_payload ? 'recordId' AND (EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE task_id=(p_payload->>'recordId')::uuid) OR EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs WHERE task_id=(p_payload->>'recordId')::uuid)) THEN
  RETURN candidate_operations.dish_command(p_subject,p_member,p_restaurant,p_request,p_payload);
 END IF;
 IF p_payload->>'action'='task.dish-pass' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_task_required'; END IF;
 RETURN candidate_operations.command_before_dish(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.dish_shape(uuid),candidate_operations.dish_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
ALTER FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid) RENAME TO read_dish_cycle_basic;
REVOKE ALL ON FUNCTION candidate_operations.read_dish_cycle_basic(text,uuid,text,uuid) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.read_dish_cycle(p_subject text,p_member uuid,p_restaurant text,p_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE result jsonb; handoffs jsonb; receipts jsonb; manager boolean;
BEGIN
 result:=candidate_operations.read_dish_cycle_basic(p_subject,p_member,p_restaurant,p_cycle);manager:=candidate_operations.dish_manager(p_member,p_restaurant);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ownerId',t.assignee_id,'phase',t.phase,'revision',t.revision,'sourceId',h.source_id,'acceptedBy',h.accepted_by,'acceptedAt',h.accepted_at,'detail',t.detail)), '[]') INTO handoffs
 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=p_cycle AND (manager OR t.assignee_id=p_member);
 SELECT coalesce(jsonb_agg(jsonb_build_object('handoffId',h.task_id,'acceptedBy',h.accepted_by,'acceptedAt',h.accepted_at)),'[]') INTO receipts
 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.dish_participants p ON p.task_id=h.source_id WHERE h.cycle_id=p_cycle AND (manager OR p.member_id=p_member);
 RETURN result||jsonb_build_object('executionSupported',true,'handoffs',handoffs,'outgoingReceipts',receipts);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
