-- Isolated manual employee goals; automatic learning/station issuance remains held.
BEGIN;
CREATE TABLE candidate_operations.employee_goals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 department text NOT NULL,owner_id uuid NOT NULL,manager_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),definition text NOT NULL CHECK(length(definition) BETWEEN 1 AND 2000),
 type text NOT NULL CHECK(type IN ('development','required-correction')),due timestamptz NOT NULL,
 phase text NOT NULL CHECK(phase IN ('proposed','active','declined','verification','closed','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),standard_id uuid,standard_revision integer,
 CHECK(owner_id<>manager_id),CHECK((standard_id IS NULL)=(standard_revision IS NULL)),
 CHECK(type<>'required-correction' OR standard_id IS NOT NULL),
 FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(manager_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(standard_id,restaurant_id) REFERENCES candidate_operations.standard_references(id,restaurant_id)
);
CREATE TABLE candidate_operations.goal_events(
 goal_id uuid NOT NULL REFERENCES candidate_operations.employee_goals(id),revision integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),action text NOT NULL,note text NOT NULL,
 data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(goal_id,revision)
);
CREATE TABLE candidate_operations.goal_outbox(
 goal_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 message text NOT NULL,delivered_at timestamptz,PRIMARY KEY(goal_id,revision,recipient_id),
 FOREIGN KEY(goal_id,revision) REFERENCES candidate_operations.goal_events(goal_id,revision)
);
REVOKE ALL ON candidate_operations.employee_goals,candidate_operations.goal_events,candidate_operations.goal_outbox FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.goal_authorized(p_member uuid,p_department text,p_cap text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability=p_cap
 WHERE m.id=p_member AND m.active AND NOT m.schedule_only AND (m.department=p_department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage')));
$$;
REVOKE ALL ON FUNCTION candidate_operations.goal_authorized(uuid,text,text) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.goal_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.employee_goals; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 guide candidate_operations.standard_references; input jsonb; result jsonb; cap text; step text; note text; next_phase text; creating boolean; linked boolean;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(p_payload->>'action','') NOT IN ('goal.create','goal.transition')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.employee_goals WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  cap:=CASE WHEN rec.type='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF NOT FOUND OR (p_payload->>'action'='goal.transition' AND NOT (actor.id=rec.owner_id OR actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  IF p_payload->>'action'='goal.create' AND (rec.type='required-correction' OR actor.id<>rec.owner_id) AND NOT candidate_operations.goal_authorized(actor.id,rec.department,cap) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF p_payload->>'action'='goal.transition' AND p_payload->'input'->>'step' IN ('coach','verify','fix') AND (actor.id<>rec.manager_id OR NOT candidate_operations.goal_authorized(actor.id,rec.department,cap)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';creating:=p_payload->>'action'='goal.create';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_fields'; END IF;
 IF creating THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR NOT input ?& ARRAY['ownerId','managerId','title','definition','type','due'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('ownerId','managerId','title','definition','type','due','standardId','standardRevision')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_fields'; END IF;
  IF coalesce(input->>'type','') NOT IN ('development','required-correction') OR jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(input->'definition') IS DISTINCT FROM 'string' OR length(btrim(input->>'definition')) NOT BETWEEN 1 AND 2000
   OR jsonb_typeof(input->'due') IS DISTINCT FROM 'string' OR input->>'due' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' OR NOT isfinite((input->>'due')::timestamptz) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_value'; END IF;
  SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR owner_member.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_owner_denied'; END IF;
  cap:=CASE WHEN input->>'type'='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF (input->>'type'='required-correction' OR owner_member.id<>actor.id) AND NOT candidate_operations.goal_authorized(actor.id,owner_member.department,cap) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  SELECT * INTO reviewer FROM candidate_identity.memberships WHERE id=(input->>'managerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=reviewer.id ORDER BY capability FOR SHARE;
  IF reviewer.id IS NULL OR reviewer.id=owner_member.id OR NOT candidate_operations.goal_authorized(reviewer.id,owner_member.department,cap) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='goal_reviewer_denied'; END IF;
  linked:=input->>'type'='required-correction' OR input ? 'standardId';
  IF linked THEN
   SELECT * INTO guide FROM candidate_operations.standard_references WHERE id=(input->>'standardId')::uuid AND restaurant_id=p_restaurant AND department=owner_member.department AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='goal_guide_denied'; END IF;
   IF input->>'type'='development' OR input ? 'standardRevision' THEN
    IF jsonb_typeof(input->'standardRevision') IS DISTINCT FROM 'number' OR input->>'standardRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_guide_revision'; END IF;
    IF guide.revision<>(input->>'standardRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='goal_guide_changed'; END IF;
   END IF;
  ELSIF input ? 'standardRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_guide_revision'; END IF;
  next_phase:=CASE WHEN input->>'type'='required-correction' OR owner_member.id=actor.id THEN 'active' ELSE 'proposed' END;
  step:=CASE WHEN input->>'type'='required-correction' THEN 'required-correction-assigned' WHEN next_phase='active' THEN 'employee-chosen' ELSE 'proposed' END;note:=btrim(input->>'definition');
  INSERT INTO candidate_operations.employee_goals(restaurant_id,department,owner_id,manager_id,title,definition,type,due,phase,standard_id,standard_revision)
   VALUES(p_restaurant,owner_member.department,owner_member.id,reviewer.id,btrim(input->>'title'),note,input->>'type',(input->>'due')::timestamptz,next_phase,guide.id,guide.revision) RETURNING * INTO rec;
 ELSE
  IF NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 OR coalesce(input->>'step','') NOT IN ('accept','decline','practice','coach','ready','verify','fix','cancel') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_transition'; END IF;
  SELECT * INTO rec FROM candidate_operations.employee_goals WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  cap:=CASE WHEN rec.type='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF NOT (actor.id=rec.owner_id OR actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  step:=input->>'step';note:=btrim(input->>'note');next_phase:=rec.phase;
  IF step IN ('accept','decline','practice','ready') AND actor.id<>rec.owner_id OR step IN ('coach','verify','fix') AND (actor.id<>rec.manager_id OR NOT candidate_operations.goal_authorized(actor.id,rec.department,cap)) OR step='cancel' AND NOT (actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap) OR actor.id=rec.owner_id AND rec.type='development') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF step IN ('accept','decline') THEN
   IF rec.type<>'development' OR rec.phase<>'proposed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:=CASE WHEN step='accept' THEN 'active' ELSE 'declined' END;
  ELSIF step IN ('practice','coach','ready') THEN
   IF rec.phase<>'active' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF step='ready' THEN next_phase:='verification'; END IF;
  ELSIF step IN ('verify','fix') THEN
   IF rec.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:=CASE WHEN step='verify' THEN 'closed' ELSE 'active' END;
  ELSE
   IF rec.phase NOT IN ('proposed','active','verification') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:='cancelled';
  END IF;
  IF rec.standard_id IS NOT NULL AND step IN ('accept','practice','coach','ready','verify') THEN
   PERFORM 1 FROM candidate_operations.standard_references WHERE id=rec.standard_id AND restaurant_id=p_restaurant AND revision=rec.standard_revision AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='goal_guide_changed'; END IF;
  END IF;
  UPDATE candidate_operations.employee_goals SET phase=next_phase,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.goal_events VALUES(rec.id,rec.revision,actor.id,step,note,to_jsonb(rec),clock_timestamp());
 IF step<>'practice' THEN
  INSERT INTO candidate_operations.goal_outbox SELECT rec.id,rec.revision,target,rec.title||': '||rec.phase,NULL FROM (SELECT DISTINCT unnest(CASE WHEN step='coach' THEN ARRAY[rec.owner_id] ELSE ARRAY[rec.owner_id,rec.manager_id] END) target) recipients;
 END IF;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.goal_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.goal_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
CREATE FUNCTION candidate_operations.list_goals(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid; scope_revision integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT g.id FROM candidate_operations.employee_goals g WHERE g.restaurant_id=p_restaurant AND (p_after IS NULL OR g.id>p_after)
 AND (g.owner_id=actor.id OR g.manager_id=actor.id AND candidate_operations.goal_authorized(actor.id,g.department,CASE WHEN g.type='development' THEN 'people.manage' ELSE 'tasks.manage' END)) ORDER BY g.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'kind','goal','locationId',g.restaurant_id,'area',g.department,'ownerId',g.owner_id,'revision',g.revision,
 'data',jsonb_build_object('title',g.title,'definition',g.definition,'type',g.type,'managerId',g.manager_id,'due',g.due,'phase',g.phase,'history',(SELECT jsonb_agg(jsonb_build_object('action',e.action,'note',e.note,'actorId',e.actor_id,'at',e.recorded_at) ORDER BY e.revision) FROM candidate_operations.goal_events e WHERE e.goal_id=g.id))||CASE WHEN g.standard_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('standardId',g.standard_id,'standardRevision',g.standard_revision) END) ORDER BY g.id),'[]') INTO items FROM candidate_operations.employee_goals g WHERE g.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope_revision,'coverage','manual-goals-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_goals(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_goals(text,uuid,text,uuid,integer) TO candidate_runtime;
COMMIT;
