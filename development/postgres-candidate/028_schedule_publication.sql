-- Individual candidate publication only; staffing/closing publication is held.
BEGIN;
ALTER TABLE candidate_operations.employee_goals ADD COLUMN station_learning jsonb;
CREATE TABLE candidate_operations.publication_reviews(
 shift_id uuid PRIMARY KEY REFERENCES candidate_operations.shift_references(id),shift_revision integer NOT NULL,
 workspace_revision integer NOT NULL,no_staffing boolean NOT NULL CHECK(no_staffing),no_closing boolean NOT NULL CHECK(no_closing),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 2000),reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE candidate_operations.station_goal_receipts(
 station_id uuid NOT NULL REFERENCES candidate_operations.station_references(id),member_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 template_id text NOT NULL,goal_id uuid NOT NULL UNIQUE REFERENCES candidate_operations.employee_goals(id),PRIMARY KEY(station_id,member_id,template_id)
);
CREATE TABLE candidate_operations.publication_events(
 shift_id uuid NOT NULL REFERENCES candidate_operations.shift_references(id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 data jsonb NOT NULL,note text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(shift_id,revision)
);
CREATE TABLE candidate_operations.publication_outbox(
 shift_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),message text NOT NULL,delivered_at timestamptz,
 PRIMARY KEY(shift_id,revision,recipient_id),FOREIGN KEY(shift_id,revision) REFERENCES candidate_operations.publication_events(shift_id,revision)
);
REVOKE ALL ON candidate_operations.publication_reviews,candidate_operations.station_goal_receipts,candidate_operations.publication_events,candidate_operations.publication_outbox FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.publish_shift(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.shift_references; station candidate_operations.station_references; guide candidate_operations.standard_references;
 scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; goal candidate_operations.employee_goals;
 template jsonb; note text; result jsonb; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object' OR NOT (p_payload->'input') ? 'note'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'input') k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_publication_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.publish') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND OR NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.publish') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
 IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.publication_reviews WHERE shift_id=rec.id AND shift_revision=rec.revision AND workspace_revision=scope.revision AND no_staffing AND no_closing)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_linked_work_held'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=rec.member_id AND restaurant_id=p_restaurant AND department=rec.department AND (active OR schedule_only) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=rec.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND id<>rec.id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND status='approved' AND starts_at<rec.ends_at AND ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND status='approved' AND candidate_operations.availability_period_conflict(data,rec.starts_at,rec.ends_at,scope.timezone)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
 IF rec.station_id IS NOT NULL THEN
  IF NOT candidate_operations.station_assignment_allowed(rec.station_id,p_restaurant,owner_member.id,rec.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_assignment_denied'; END IF;
  SELECT * INTO station FROM candidate_operations.station_references WHERE id=rec.station_id AND restaurant_id=p_restaurant FOR UPDATE;
  IF station.setup_data IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_setup_reference_only'; END IF;
 END IF;
 IF jsonb_typeof(p_payload->'input'->'note') IS DISTINCT FROM 'string' OR length(btrim(p_payload->'input'->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_publication_note'; END IF;
 note:=btrim(p_payload->'input'->>'note');
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 -- Source proposes goals only for non-ended shifts, and validates the reviewer even if all templates were issued.
 IF station.id IS NOT NULL AND rec.ends_at>applied_at AND jsonb_array_length(station.setup_data->'goals')>0 THEN
  SELECT * INTO reviewer FROM candidate_identity.memberships WHERE id=(station.setup_data->>'managerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=reviewer.id ORDER BY capability FOR SHARE;
  IF reviewer.id IS NULL OR reviewer.id=owner_member.id OR NOT candidate_operations.goal_authorized(reviewer.id,station.department,'people.manage') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_goal_reviewer_unavailable'; END IF;
  FOR template IN SELECT value FROM jsonb_array_elements(station.setup_data->'goals') LOOP
   IF EXISTS(SELECT 1 FROM candidate_operations.station_goal_receipts WHERE station_id=station.id AND member_id=owner_member.id AND template_id=template->>'id') THEN CONTINUE; END IF;
   guide:=NULL;
   IF template ? 'standardId' THEN
    SELECT * INTO guide FROM candidate_operations.standard_references WHERE id=(template->>'standardId')::uuid AND restaurant_id=p_restaurant AND department=station.department AND status='approved' FOR SHARE;
    IF NOT FOUND THEN CONTINUE; END IF;
   END IF;
   INSERT INTO candidate_operations.employee_goals(restaurant_id,department,owner_id,manager_id,title,definition,type,due,phase,standard_id,standard_revision,station_learning)
    VALUES(p_restaurant,station.department,owner_member.id,reviewer.id,template->>'title',template->>'definition','development',
    (((rec.starts_at AT TIME ZONE scope.timezone)::date+(template->>'dueDays')::integer)+time '23:59') AT TIME ZONE scope.timezone,'proposed',guide.id,guide.revision,
    jsonb_build_object('stationId',station.id,'stationName',station.title,'templateId',template->>'id','shiftId',rec.id)) RETURNING * INTO goal;
   INSERT INTO candidate_operations.goal_events VALUES(goal.id,1,actor.id,'station-goal-proposed','Proposed from the published station shift. No training clearance granted.',to_jsonb(goal),applied_at);
   INSERT INTO candidate_operations.goal_outbox SELECT goal.id,1,target,'Station learning goal proposed: '||goal.title,NULL FROM unnest(ARRAY[owner_member.id,reviewer.id]) target;
   INSERT INTO candidate_operations.station_goal_receipts VALUES(station.id,owner_member.id,template->>'id',goal.id);issued:=true;
  END LOOP;
 END IF;
 IF issued THEN
  UPDATE candidate_operations.station_references SET revision=revision+1 WHERE id=station.id RETURNING * INTO station;
  INSERT INTO candidate_operations.station_events VALUES(station.id,station.revision,actor.id,to_jsonb(station),'Station learning goals proposed',applied_at);
 END IF;
 UPDATE candidate_operations.shift_references SET published=true,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 INSERT INTO candidate_operations.publication_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),note,applied_at);
 INSERT INTO candidate_operations.publication_outbox VALUES(rec.id,rec.revision,rec.member_id,'Shift published',NULL);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',applied_at,'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.publish_shift(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.publish_shift(text,uuid,text,uuid,jsonb) TO candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.list_goals(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid; scope_revision integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT g.id FROM candidate_operations.employee_goals g WHERE g.restaurant_id=p_restaurant AND (p_after IS NULL OR g.id>p_after)
 AND (g.owner_id=actor.id OR g.manager_id=actor.id AND candidate_operations.goal_authorized(actor.id,g.department,CASE WHEN g.type='development' THEN 'people.manage' ELSE 'tasks.manage' END)) ORDER BY g.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'kind','goal','locationId',g.restaurant_id,'area',g.department,'ownerId',g.owner_id,'revision',g.revision,
 'data',(CASE WHEN g.station_learning IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationLearning',g.station_learning) END)||jsonb_build_object('title',g.title,'definition',g.definition,'type',g.type,'managerId',g.manager_id,'due',g.due,'phase',g.phase,'history',(SELECT jsonb_agg(jsonb_build_object('action',e.action,'note',e.note,'actorId',e.actor_id,'at',e.recorded_at) ORDER BY e.revision) FROM candidate_operations.goal_events e WHERE e.goal_id=g.id))||CASE WHEN g.standard_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('standardId',g.standard_id,'standardRevision',g.standard_revision) END) ORDER BY g.id),'[]') INTO items FROM candidate_operations.employee_goals g WHERE g.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope_revision,'coverage','manual-and-station-goals');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_goals(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_goals(text,uuid,text,uuid,integer) TO candidate_runtime;

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
 'data',jsonb_build_object('issuedGoals',(SELECT coalesce(jsonb_agg(jsonb_build_object('personId',r.member_id,'templateId',r.template_id,'goalId',r.goal_id) ORDER BY r.member_id,r.template_id),'[]') FROM candidate_operations.station_goal_receipts r WHERE r.station_id=s.id),'title',s.title,'status',s.status,'levels',s.levels,'independentLevel',s.independent_level,'definitionRevision',s.definition_revision,'setup',CASE WHEN NOT s.configured THEN NULL WHEN s.setup_data IS NOT NULL THEN s.setup_data ELSE jsonb_build_object('allJobMembers',s.all_job_members,
 'jobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_operations.station_jobs WHERE station_id=s.id),
 'memberIds',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=s.id)) END)) ORDER BY s.id),'[]') INTO items FROM candidate_operations.station_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','station-scheduling-references-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) TO candidate_runtime;


COMMIT;
