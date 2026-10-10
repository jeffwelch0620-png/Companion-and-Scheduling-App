-- Corrective candidate migration: exact batch selection, bounded publication and runtime entry grants.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.weekly_review(p_subject text,p_member uuid,p_restaurant text,p_week text,p_selected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; week_start timestamptz; week_end timestamptz; tz text; scope_revision integer; ids uuid[]; snapshot jsonb; needs jsonb; stamp text;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_week IS NULL OR p_week !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(p_week::date,'YYYY-MM-DD')<>p_week OR jsonb_typeof(p_selected) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO ids FROM jsonb_array_elements_text(p_selected);
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_shift_selection'; END IF;
 SELECT timezone,revision INTO tz,scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 week_start:=p_week::date::timestamp AT TIME ZONE tz;week_end:=(p_week::date+7)::timestamp AT TIME ZONE tz;
 IF EXISTS(SELECT 1 FROM unnest(ids) AS sel(shift_id) WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=sel.shift_id AND s.restaurant_id=p_restaurant AND NOT s.published AND NOT s.cancelled AND s.released_at IS NULL AND s.starts_at>=week_start AND s.starts_at<week_end AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
 -- The conservative snapshot also detects privileged fixture changes that did not advance a scope revision.
 SELECT jsonb_build_object('week',p_week,'selected',to_jsonb(ids),'workspaceRevision',scope_revision,
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant),
 'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.member_id,e.job,e.source),'[]') FROM candidate_identity.schedule_eligibility e JOIN candidate_identity.memberships m ON m.id=e.member_id WHERE m.restaurant_id=p_restaurant),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.membership_id,c.capability),'[]') FROM candidate_identity.membership_capabilities c JOIN candidate_identity.memberships m ON m.id=c.membership_id WHERE m.restaurant_id=p_restaurant),
 'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant),
 'needs',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant),
 'stations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant),
 'stationJobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.station_id,j.job),'[]') FROM candidate_operations.station_jobs j JOIN candidate_operations.station_references s ON s.id=j.station_id WHERE s.restaurant_id=p_restaurant),
 'stationMembers',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.station_id,m.member_id),'[]') FROM candidate_operations.station_members m WHERE m.restaurant_id=p_restaurant),
 'availability',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant),
 'timeOff',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM candidate_operations.time_off_references t WHERE t.restaurant_id=p_restaurant),
 'closes',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM candidate_operations.closes c WHERE c.restaurant_id=p_restaurant),
 'standards',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.standard_references s WHERE s.restaurant_id=p_restaurant),
 'leadership',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM candidate_operations.leadership_references l WHERE l.restaurant_id=p_restaurant)) INTO snapshot;
 stamp:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 WITH planned AS (
 SELECT s.* FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id WHERE s.restaurant_id=p_restaurant AND NOT s.cancelled AND (s.published OR s.id=ANY(ids)) AND s.starts_at<week_end AND s.ends_at>week_start
 AND m.department=s.department AND (m.active OR m.schedule_only) AND candidate_operations.schedule_plan_allowed(actor.id,s.department)
 AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND e.job=s.position)
 AND (s.station_id IS NULL OR candidate_operations.station_assignment_allowed(s.station_id,p_restaurant,m.id,s.position))
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.time_off_references t WHERE t.restaurant_id=p_restaurant AND t.member_id=m.id AND t.status='approved' AND t.starts_at<s.ends_at AND t.ends_at>s.starts_at)
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant AND a.member_id=m.id AND a.status='approved' AND candidate_operations.availability_period_conflict(a.data,s.starts_at,s.ends_at,tz))
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references other WHERE other.restaurant_id=p_restaurant AND other.member_id=m.id AND other.id<>s.id AND NOT other.cancelled AND (other.published OR other.id=ANY(ids)) AND other.starts_at<s.ends_at AND other.ends_at>s.starts_at)
 ), staffing AS (SELECT n.*,greatest(n.starts_at,week_start) first_at,least(n.ends_at,week_end) last_at FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.status='approved' AND n.starts_at<week_end AND n.ends_at>week_start AND candidate_operations.schedule_plan_allowed(actor.id,n.department)),
 boundaries AS (SELECT n.id,n.first_at point FROM staffing n UNION SELECT n.id,n.last_at FROM staffing n UNION SELECT n.id,greatest(s.starts_at,n.first_at) FROM staffing n JOIN planned s ON s.department=n.department AND s.position=n.position AND s.starts_at<n.last_at AND s.ends_at>n.first_at UNION SELECT n.id,least(s.ends_at,n.last_at) FROM staffing n JOIN planned s ON s.department=n.department AND s.position=n.position AND s.starts_at<n.last_at AND s.ends_at>n.first_at),
 segments AS (SELECT id,point first_at,lead(point) OVER(PARTITION BY id ORDER BY point) last_at FROM boundaries),
 counts AS (SELECT b.*,n.minimum,(SELECT count(DISTINCT s.member_id)::integer FROM planned s WHERE s.department=n.department AND s.position=n.position AND s.starts_at<=b.first_at AND s.ends_at>=b.last_at) scheduled FROM segments b JOIN staffing n ON n.id=b.id WHERE b.last_at>b.first_at),
 gaps AS (SELECT *,CASE WHEN lag(last_at) OVER(PARTITION BY id ORDER BY first_at)=first_at AND lag(scheduled) OVER(PARTITION BY id ORDER BY first_at)=scheduled THEN 0 ELSE 1 END boundary FROM counts WHERE scheduled<minimum),
 grouped AS (SELECT *,sum(boundary) OVER(PARTITION BY id ORDER BY first_at) grp FROM gaps),
 merged AS (SELECT id,min(first_at) first_at,max(last_at) last_at,minimum,scheduled FROM grouped GROUP BY id,grp,minimum,scheduled)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'required',n.minimum,'gaps',coalesce((SELECT jsonb_agg(jsonb_build_object('start',g.first_at,'end',g.last_at,'required',g.minimum,'scheduled',g.scheduled) ORDER BY g.first_at) FROM merged g WHERE g.id=n.id),'[]')) ORDER BY n.id),'[]') INTO needs FROM staffing n;
 RETURN jsonb_build_object('weekStart',p_week,'period',jsonb_build_object('start',week_start,'end',week_end),'planningReview',stamp,'staffing',needs,'plannedGapCount',(SELECT coalesce(sum(jsonb_array_length(n->'gaps')),0) FROM jsonb_array_elements(needs) n),'workspaceRevision',scope_revision,'coverage','candidate-planned-staffing-gaps');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.weekly_review(text,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.weekly_review(text,uuid,text,text,jsonb) TO candidate_runtime;
CREATE FUNCTION candidate_operations.publish_shift_core(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb,p_batch boolean,p_week_start timestamptz,p_week_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.shift_references; station candidate_operations.station_references; guide candidate_operations.standard_references;
 scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; goal candidate_operations.employee_goals;
 template jsonb; note text; result jsonb; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 IF p_batch AND (p_week_start IS NULL OR p_week_end IS NULL OR p_week_end<=p_week_start) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_period'; END IF;
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
 IF p_batch AND (rec.starts_at<p_week_start OR rec.starts_at>=p_week_end) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
 IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF NOT p_batch AND NOT EXISTS(SELECT 1 FROM candidate_operations.publication_reviews WHERE shift_id=rec.id AND shift_revision=rec.revision AND workspace_revision=scope.revision AND no_staffing AND no_closing=NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled'))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=rec.department AND n.starts_at<rec.ends_at AND n.ends_at>rec.starts_at AND (n.status='approved' AND NOT p_batch OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=rec.position)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staffing_publication_review_required'; END IF;
 IF jsonb_array_length(candidate_operations.closing_publication_issues(rec.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_linked_work_held'; END IF;
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
 UPDATE candidate_operations.closes SET shift_revision=rec.revision,revision=revision+1 WHERE shift_id=rec.id AND phase<>'cancelled';
 INSERT INTO candidate_operations.close_events SELECT id,restaurant_id,revision,actor.id,'schedule-published','Linked shift revision advanced by publication',applied_at FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled';
 INSERT INTO candidate_operations.publication_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),note,applied_at);
 INSERT INTO candidate_operations.publication_outbox VALUES(rec.id,rec.revision,rec.member_id,'Shift published',NULL);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',applied_at,'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.publish_shift_core(text,uuid,text,uuid,jsonb,boolean,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION candidate_operations.publish_shift_core(text,uuid,text,uuid,jsonb,boolean,timestamptz,timestamptz) FROM candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.publish_shift_core(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb,p_batch boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_batch THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='batch_period_required'; END IF;
 RETURN candidate_operations.publish_shift_core(p_subject,p_member,p_restaurant,p_request,p_payload,false,NULL,NULL);
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.publish_shift_core(text,uuid,text,uuid,jsonb,boolean) FROM PUBLIC,candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.publish_week(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; review jsonb; input jsonb; selection jsonb; closing jsonb;
 ids jsonb; result jsonb; effects jsonb:='[]'; effect jsonb; coverage_note text:=''; batch_id uuid:=gen_random_uuid(); selected_shift candidate_operations.shift_references;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish-batch' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_command'; END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['weekStart','drafts','planningReview','confirmed','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('weekStart','drafts','planningReview','confirmed','note','coverageAcknowledged','coverageNote')) OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'drafts') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'drafts') NOT BETWEEN 1 AND 100 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_fields'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'drafts') d WHERE jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT d ?& ARRAY['id','revision','closing'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('id','revision','closing')) OR jsonb_typeof(d->'revision') IS DISTINCT FROM 'number' OR d->>'revision' !~ '^[1-9][0-9]*$' OR jsonb_typeof(d->'closing') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'drafts') d WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=(d->>'id')::uuid AND s.restaurant_id=p_restaurant AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 SELECT jsonb_agg(d->>'id') INTO ids FROM jsonb_array_elements(input->'drafts') d;
 review:=candidate_operations.weekly_review(p_subject,p_member,p_restaurant,input->>'weekStart',ids);
 IF jsonb_typeof(input->'planningReview') IS DISTINCT FROM 'string' OR input->>'planningReview'<>review->>'planningReview' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='planning_review_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=p_restaurant AND workspace_revision=scope.revision) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='weekly_scope_review_required'; END IF;
 IF (review->>'plannedGapCount')::integer>0 THEN
  IF input->'coverageAcknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'coverageNote') IS DISTINCT FROM 'string' OR length(btrim(input->>'coverageNote')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='staffing_gap_plan_required'; END IF;
  coverage_note:=btrim(input->>'coverageNote');
 END IF;
 -- Exact closing selections are reviewed before any child publishes; later failure still rolls back all children.
 FOR selection IN SELECT value FROM jsonb_array_elements(input->'drafts') LOOP
  SELECT * INTO selected_shift FROM candidate_operations.shift_references WHERE id=(selection->>'id')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF selected_shift.revision<>(selection->>'revision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision) ORDER BY c.id),'[]') INTO closing FROM candidate_operations.closes c WHERE c.shift_id=selected_shift.id AND c.phase<>'cancelled';
  IF selection->'closing'<>closing THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_selection_conflict'; END IF;
 END LOOP;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 FOR selection IN SELECT d FROM jsonb_array_elements(input->'drafts') d JOIN candidate_operations.shift_references s ON s.id=(d->>'id')::uuid ORDER BY s.starts_at,s.id LOOP
  effect:=candidate_operations.publish_shift_core(p_subject,p_member,p_restaurant,gen_random_uuid(),jsonb_build_object('action','shift.publish','recordId',selection->>'id','expectedRevision',selection->'revision','input',jsonb_build_object('note',btrim(input->>'note'))),true,(review->'period'->>'start')::timestamptz,(review->'period'->>'end')::timestamptz);
  effects:=effects||jsonb_build_array(effect);
  IF coverage_note<>'' THEN UPDATE candidate_operations.publication_events SET data=data||jsonb_build_object('staffingException',coverage_note) WHERE shift_id=(selection->>'id')::uuid AND revision=(effect->>'revision')::integer; END IF;
 END LOOP;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 result:=jsonb_build_object('recordId',batch_id,'revision',1,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false,'published',effects);
 INSERT INTO candidate_operations.publication_batches VALUES(batch_id,p_restaurant,actor.id,p_payload,result,review,coverage_note,clock_timestamp());
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.publish_week(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.publish_week(text,uuid,text,uuid,jsonb) TO candidate_runtime;
GRANT USAGE ON SCHEMA candidate_operations TO candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb),candidate_operations.read_task(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
