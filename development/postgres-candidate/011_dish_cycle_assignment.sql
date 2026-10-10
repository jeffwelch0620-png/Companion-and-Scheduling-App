-- Candidate foundation only: cycle assignment and scoped reads. No handoff/release authority.
BEGIN;
CREATE TABLE candidate_operations.dish_cycles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 business_date date NOT NULL,revision integer NOT NULL DEFAULT 1,title text NOT NULL,detail text NOT NULL,due timestamptz NOT NULL,
 created_by uuid NOT NULL,UNIQUE(restaurant_id,business_date),UNIQUE(id,restaurant_id),
 FOREIGN KEY(created_by,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.dish_participants(
 cycle_id uuid NOT NULL,restaurant_id text NOT NULL,slot integer NOT NULL CHECK(slot BETWEEN 0 AND 2),member_id uuid NOT NULL,task_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(cycle_id,slot),UNIQUE(cycle_id,member_id),FOREIGN KEY(cycle_id,restaurant_id) REFERENCES candidate_operations.dish_cycles(id,restaurant_id),
 FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),FOREIGN KEY(task_id,restaurant_id) REFERENCES candidate_operations.tasks(id,restaurant_id)
);
REVOKE ALL ON candidate_operations.dish_cycles,candidate_operations.dish_participants FROM PUBLIC;
CREATE FUNCTION candidate_operations.dish_manager(p_member uuid,p_restaurant text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; caps text[];
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 RETURN 'location.manage'=ANY(caps) OR 'tasks.manage'=ANY(caps) AND (actor.department='BOH' OR 'operations.store'=ANY(caps));
END;
$body$;
CREATE FUNCTION candidate_operations.assign_dish_cycle(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; person candidate_identity.memberships; cycle candidate_operations.dish_cycles;
 receipt candidate_operations.command_receipts; input jsonb; participants uuid[]; checkout_date date; due_at timestamptz; task_id uuid;
 title text; detail text; scope_revision integer; result jsonb; slot integer;
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR NOT candidate_operations.dish_manager(p_member,p_restaurant) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'task.dish-cycle' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt'))
 OR NOT input ?& ARRAY['amOwnerId','pmOwnerIds','businessDate','title','detail','due']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('amOwnerId','pmOwnerIds','businessDate','title','detail','due'))
 OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE f.key<>'pmOwnerIds' AND jsonb_typeof(f.value)<>'string')
 OR jsonb_typeof(input->'pmOwnerIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_cycle'; END IF;
 IF jsonb_array_length(input->'pmOwnerIds')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'pmOwnerIds') v WHERE jsonb_typeof(v)<>'string')
 OR input->>'businessDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_cycle'; END IF;
 participants:=ARRAY[(input->>'amOwnerId')::uuid,(input->'pmOwnerIds'->>0)::uuid,(input->'pmOwnerIds'->>1)::uuid];
 IF (SELECT count(DISTINCT id) FROM unnest(participants) id)<>3 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='distinct_dishwashers_required'; END IF;
 checkout_date:=(input->>'businessDate')::date;due_at:=(input->>'due')::timestamptz;title:=btrim(input->>'title');detail:=btrim(input->>'detail');
 IF length(title) NOT BETWEEN 1 AND 180 OR length(detail) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_text'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 FOREACH task_id IN ARRAY participants LOOP
  SELECT * INTO person FROM candidate_identity.memberships WHERE id=task_id AND restaurant_id=p_restaurant AND department='BOH' AND position='Dishwasher' AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dishwasher_denied'; END IF;
  PERFORM 1 FROM candidate_identity.auth_links WHERE person_id=person.person_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='sign_in_required'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM candidate_operations.dish_cycles c WHERE c.restaurant_id=p_restaurant AND c.business_date=checkout_date) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_cycle_conflict'; END IF;
 INSERT INTO candidate_operations.dish_cycles(restaurant_id,business_date,title,detail,due,created_by) VALUES(p_restaurant,checkout_date,title,detail,due_at,p_member) RETURNING * INTO cycle;
 FOR slot IN 0..2 LOOP
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind)
  VALUES(p_restaurant,participants[slot+1],'BOH',(CASE WHEN slot=0 THEN 'AM' ELSE 'PM' END)||' checkout: '||title,detail,due_at,'open',1,'task') RETURNING id INTO task_id;
  INSERT INTO candidate_operations.dish_participants(cycle_id,restaurant_id,slot,member_id,task_id) VALUES(cycle.id,p_restaurant,slot,participants[slot+1],task_id);
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task_id,p_restaurant,1,p_member,'assigned',detail,'open',participants[slot+1]);
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) VALUES(p_restaurant,participants[slot+1],task_id,1,'Dishwasher checkout assigned: '||title);
 END LOOP;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',cycle.id,'revision',1,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
CREATE FUNCTION candidate_operations.read_dish_cycle(p_subject text,p_member uuid,p_restaurant text,p_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; cycle candidate_operations.dish_cycles; manager boolean; checkouts jsonb; participants jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO cycle FROM candidate_operations.dish_cycles WHERE id=p_cycle AND restaurant_id=p_restaurant;
 manager:=candidate_operations.dish_manager(p_member,p_restaurant);
 IF NOT FOUND OR NOT(manager OR EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle AND member_id=p_member)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cycle_denied'; END IF;
 SELECT jsonb_agg(member_id ORDER BY slot) INTO participants FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle;
 SELECT jsonb_agg(jsonb_build_object('id',t.id,'ownerId',p.member_id,'revision',t.revision,'phase',t.phase,'shift',CASE WHEN p.slot=0 THEN 'AM' ELSE 'PM' END,'title',t.title,'detail',t.detail,'due',t.due) ORDER BY p.slot)
 INTO checkouts FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=p_cycle AND (manager OR p.member_id=p_member);
 RETURN jsonb_build_object('id',cycle.id,'revision',cycle.revision,'locationId',p_restaurant,'businessDate',cycle.business_date,'participantIds',participants,'checkouts',checkouts,'executionSupported',false);
END;
$body$;
-- Freeze dedicated tasks until the specialty execution slice is implemented.
ALTER FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb) RENAME TO command_before_dish;
REVOKE ALL ON FUNCTION candidate_operations.command_before_dish(text,uuid,text,uuid,jsonb) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 IF p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE task_id=(p_payload->>'recordId')::uuid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_execution_not_supported'; END IF;
 RETURN candidate_operations.command_before_dish(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb),candidate_operations.dish_manager(uuid,text),candidate_operations.assign_dish_cycle(text,uuid,text,uuid,jsonb),candidate_operations.read_dish_cycle(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb),candidate_operations.assign_dish_cycle(text,uuid,text,uuid,jsonb),candidate_operations.read_dish_cycle(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
