-- Candidate definitions/setup; no proficiency assessment or employee goal issuance.
BEGIN;
ALTER TABLE candidate_operations.station_references ADD COLUMN levels jsonb NOT NULL DEFAULT '[]',ADD COLUMN independent_level integer,
 ADD COLUMN definition_revision integer NOT NULL DEFAULT 1 CHECK(definition_revision>0),ADD COLUMN setup_data jsonb,
 ADD COLUMN owner_id uuid,ADD FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id);
UPDATE candidate_operations.station_references SET definition_revision=revision;
CREATE UNIQUE INDEX station_title_scope ON candidate_operations.station_references(restaurant_id,department,lower(title));
CREATE TABLE candidate_operations.station_events(
 station_id uuid NOT NULL REFERENCES candidate_operations.station_references(id),revision integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),data jsonb NOT NULL,note text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(station_id,revision)
);
REVOKE ALL ON candidate_operations.station_events FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.save_station(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; rec candidate_operations.station_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; setup_json jsonb; rubric jsonb; goal jsonb; goals jsonb:='[]';
 result jsonb; department_name text; station_title text; reason text; key text; n integer; threshold integer; reviewer uuid; creating boolean; rubric_changed boolean;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'station.save'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.station_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='people.manage' AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['title','levels','status','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('area','title','levels','independentLevel','status','note','setup')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_fields'; END IF;
 creating:=NOT p_payload ? 'recordId';
 IF creating THEN
  IF p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_record'; END IF;
  department_name:=coalesce(input->>'area',actor.department);
 ELSE
  SELECT * INTO rec FROM candidate_operations.station_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  department_name:=rec.department;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='people.manage' AND (actor.department=department_name OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 IF length(btrim(department_name)) NOT BETWEEN 1 AND 50 OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND department=department_name AND (active OR schedule_only)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_department'; END IF;
 IF jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 OR input->>'status' IS NULL OR input->>'status' NOT IN ('active','archived') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_text'; END IF;
 station_title:=btrim(input->>'title');reason:=btrim(input->>'note');
 IF NOT creating AND station_title<>rec.title THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_name_immutable'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant AND s.department=department_name AND lower(s.title)=lower(station_title) AND s.id<>coalesce(rec.id,'00000000-0000-0000-0000-000000000000'::uuid)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_title_conflict'; END IF;
 IF jsonb_typeof(input->'levels') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 n:=jsonb_array_length(input->'levels');IF n<>0 AND n NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'levels') l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object' OR jsonb_typeof(l->'label') IS DISTINCT FROM 'string' OR length(btrim(l->>'label')) NOT BETWEEN 1 AND 80 OR l ? 'definition' AND (jsonb_typeof(l->'definition') IS DISTINCT FROM 'string' OR length(btrim(l->>'definition'))>500)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('value',ordinality,'label',btrim(l->>'label'),'definition',btrim(coalesce(l->>'definition',''))) ORDER BY ordinality),'[]') INTO rubric FROM jsonb_array_elements(input->'levels') WITH ORDINALITY e(l,ordinality);
 IF (SELECT count(DISTINCT lower(l->>'label')) FROM jsonb_array_elements(rubric) l)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_levels'; END IF;
 IF input ? 'independentLevel' AND input->'independentLevel'<>'null'::jsonb THEN
  IF jsonb_typeof(input->'independentLevel') IS DISTINCT FROM 'number' OR input->>'independentLevel' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_threshold'; END IF;
  threshold:=(input->>'independentLevel')::integer;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rubric) l WHERE (l->>'value')::integer=threshold AND length(l->>'definition')>0) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_threshold'; END IF;
 END IF;
 IF input ? 'setup' THEN
  setup_json:=input->'setup';
  IF jsonb_typeof(setup_json) IS DISTINCT FROM 'object' OR NOT setup_json ?& ARRAY['jobs','memberIds','standardIds','goals'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(setup_json) k WHERE k NOT IN ('jobs','memberIds','standardIds','goals','allJobMembers','managerId')) OR setup_json ? 'allJobMembers' AND jsonb_typeof(setup_json->'allJobMembers') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_setup'; END IF;
  FOREACH key IN ARRAY ARRAY['jobs','memberIds','standardIds'] LOOP
   IF jsonb_typeof(setup_json->key) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_selection'; END IF;
   n:=jsonb_array_length(setup_json->key);
   IF n>(CASE WHEN key='memberIds' THEN 500 ELSE 40 END) OR EXISTS(SELECT 1 FROM jsonb_array_elements(setup_json->key) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_selection'; END IF;
   IF key='jobs' THEN
    IF (SELECT count(DISTINCT btrim(v)) FROM jsonb_array_elements_text(setup_json->key) v)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_selection'; END IF;
    setup_json:=jsonb_set(setup_json,ARRAY[key],(SELECT coalesce(jsonb_agg(btrim(v) ORDER BY ordinality),'[]') FROM jsonb_array_elements_text(setup_json->key) WITH ORDINALITY e(v,ordinality)));
   ELSE
    IF (SELECT count(DISTINCT btrim(v)::uuid) FROM jsonb_array_elements_text(setup_json->key) v)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_selection'; END IF;
    setup_json:=jsonb_set(setup_json,ARRAY[key],(SELECT coalesce(jsonb_agg(btrim(v)::uuid ORDER BY ordinality),'[]') FROM jsonb_array_elements_text(setup_json->key) WITH ORDINALITY e(v,ordinality)));
   END IF;
  END LOOP;
  setup_json:=setup_json||jsonb_build_object('allJobMembers',coalesce((setup_json->>'allJobMembers')::boolean,false));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'jobs') j WHERE candidate_operations.dish_only_label(j) OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.schedule_eligibility e ON e.member_id=m.id AND e.active AND e.job=j WHERE m.restaurant_id=p_restaurant AND m.department=department_name AND (m.active OR m.schedule_only))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_job_selection_denied'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'memberIds') v WHERE NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.id=v::uuid AND m.restaurant_id=p_restaurant AND m.department=department_name AND (m.active OR m.schedule_only) AND NOT candidate_operations.dish_only_label(m.position) AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND setup_json->'jobs' @> to_jsonb(ARRAY[e.job])))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_member_selection_denied'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'standardIds') v WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.standard_references s WHERE s.id=v::uuid AND s.restaurant_id=p_restaurant AND s.department=department_name AND s.status<>'retired')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_guide_selection_denied'; END IF;
  IF jsonb_typeof(setup_json->'goals') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goals'; END IF;
  IF jsonb_array_length(setup_json->'goals')>5 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goals'; END IF;
  FOR goal IN SELECT value FROM jsonb_array_elements(setup_json->'goals') LOOP
   IF jsonb_typeof(goal) IS DISTINCT FROM 'object' OR NOT goal ?& ARRAY['id','title','definition','dueDays'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   FOREACH key IN ARRAY ARRAY['id','title','definition'] LOOP
    IF jsonb_typeof(goal->key) IS DISTINCT FROM 'string' OR length(btrim(goal->>key)) NOT BETWEEN 1 AND (CASE key WHEN 'id' THEN 100 WHEN 'title' THEN 200 ELSE 2000 END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   END LOOP;
   IF jsonb_typeof(goal->'dueDays') IS DISTINCT FROM 'number' OR goal->>'dueDays' !~ '^[1-9][0-9]*$' OR (goal->>'dueDays')::integer NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   IF coalesce(goal->>'standardId','')<>'' AND NOT setup_json->'standardIds' @> to_jsonb(ARRAY[(goal->>'standardId')::uuid::text]) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_goal_guide_denied'; END IF;
   goals:=goals||jsonb_build_array(jsonb_build_object('id',btrim(goal->>'id'),'title',btrim(goal->>'title'),'definition',btrim(goal->>'definition'),'dueDays',(goal->>'dueDays')::integer)||CASE WHEN coalesce(goal->>'standardId','')='' THEN '{}'::jsonb ELSE jsonb_build_object('standardId',(goal->>'standardId')::uuid) END);
  END LOOP;
  IF (SELECT count(DISTINCT g->>'id') FROM jsonb_array_elements(goals) g)<>jsonb_array_length(goals) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_goals'; END IF;
  IF setup_json ? 'managerId' AND jsonb_typeof(setup_json->'managerId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_reviewer'; END IF;
  reviewer:=nullif(setup_json->>'managerId','')::uuid;
  IF jsonb_array_length(goals)>0 AND (reviewer IS NULL OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='people.manage' WHERE m.id=reviewer AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND NOT candidate_operations.dish_only_label(m.position) AND (m.department=department_name OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage'))) OR NOT (setup_json->>'allJobMembers')::boolean AND setup_json->'memberIds' @> to_jsonb(ARRAY[reviewer::text])) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_goal_reviewer_denied'; END IF;
  setup_json:=setup_json||jsonb_build_object('managerId',coalesce(reviewer::text,''),'goals',goals);
 ELSE
  IF NOT creating AND rec.configured AND rec.setup_data IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_setup_reference_only'; END IF;
  setup_json:=rec.setup_data;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 rubric_changed:=NOT creating AND (rec.levels<>rubric OR rec.independent_level IS DISTINCT FROM threshold OR rec.status<>input->>'status');
 IF creating THEN
  INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members,levels,independent_level,definition_revision,setup_data,owner_id)
  VALUES(gen_random_uuid(),p_restaurant,department_name,station_title,1,input->>'status',setup_json IS NOT NULL,coalesce((setup_json->>'allJobMembers')::boolean,false),rubric,threshold,1,setup_json,actor.id) RETURNING * INTO rec;
 ELSE
  UPDATE candidate_operations.station_references SET revision=revision+1,status=input->>'status',configured=setup_json IS NOT NULL,all_job_members=coalesce((setup_json->>'allJobMembers')::boolean,false),levels=rubric,independent_level=threshold,definition_revision=CASE WHEN rubric_changed THEN revision+1 ELSE definition_revision END,setup_data=setup_json WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF input ? 'setup' THEN
  DELETE FROM candidate_operations.station_jobs WHERE station_id=rec.id;DELETE FROM candidate_operations.station_members WHERE station_id=rec.id;
  INSERT INTO candidate_operations.station_jobs SELECT rec.id,j FROM jsonb_array_elements_text(setup_json->'jobs') j;
  INSERT INTO candidate_operations.station_members SELECT rec.id,v::uuid,p_restaurant FROM jsonb_array_elements_text(setup_json->'memberIds') v;
 END IF;
 INSERT INTO candidate_operations.station_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),reason,clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.save_station(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.save_station(text,uuid,text,uuid,jsonb) TO candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_stations(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT s.id FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after)
 AND caps&&ARRAY['people.manage','schedule.manage','schedule.change','schedule.publish'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) ORDER BY s.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','station','locationId',s.restaurant_id,'area',s.department,'revision',s.revision,
 'data',jsonb_build_object('title',s.title,'status',s.status,'levels',s.levels,'independentLevel',s.independent_level,'definitionRevision',s.definition_revision,'setup',CASE WHEN NOT s.configured THEN NULL WHEN s.setup_data IS NOT NULL THEN s.setup_data ELSE jsonb_build_object('allJobMembers',s.all_job_members,
 'jobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_operations.station_jobs WHERE station_id=s.id),
 'memberIds',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=s.id)) END)) ORDER BY s.id),'[]') INTO items FROM candidate_operations.station_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','station-scheduling-references-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) TO candidate_runtime;
COMMIT;
