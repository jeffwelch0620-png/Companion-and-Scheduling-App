-- Isolated candidate: reviewed copy only. Batch replacements and forms remain separate.
BEGIN;
CREATE TABLE candidate_operations.schedule_copy_origins(
 kind text NOT NULL CHECK(kind IN ('shift','staffing')),target_id uuid NOT NULL,
 restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),source_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),source_week date NOT NULL,target_week date NOT NULL,
 timezone text NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),request_id uuid NOT NULL,
 source_key jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(kind,target_id)
);
CREATE INDEX schedule_copy_source_lookup ON candidate_operations.schedule_copy_origins(restaurant_id,kind,source_id,target_week);
REVOKE ALL ON candidate_operations.schedule_copy_origins FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.copy_selection(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE first_week date;last_week date;entry jsonb;family text;selected jsonb;output jsonb:='{}';
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ?& ARRAY['sourceWeek','targetWeek','shifts','staffing']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('sourceWeek','targetWeek','shifts','staffing'))
 OR jsonb_typeof(p_input->'sourceWeek') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'targetWeek') IS DISTINCT FROM 'string'
 OR p_input->>'sourceWeek' !~ '^\d{4}-\d{2}-\d{2}$' OR p_input->>'targetWeek' !~ '^\d{4}-\d{2}-\d{2}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_selection'; END IF;
 first_week:=(p_input->>'sourceWeek')::date;last_week:=(p_input->>'targetWeek')::date;
 IF last_week-first_week NOT BETWEEN 7 AND 364 OR (last_week-first_week)%7<>0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_week'; END IF;
 FOREACH family IN ARRAY ARRAY['shifts','staffing'] LOOP
  IF jsonb_typeof(p_input->family) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_selection'; END IF;
  IF jsonb_array_length(p_input->family)>100 OR family='shifts' AND jsonb_array_length(p_input->family)=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_selection'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_input->family) LOOP
   IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['id','revision']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('id','revision','startOccurrence','endOccurrence'))
   OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'string' OR entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(entry->'revision') IS DISTINCT FROM 'number' OR entry->>'revision' !~ '^[1-9][0-9]*$' OR (entry->>'revision')::numeric>2147483646
   OR entry ? 'startOccurrence' AND (jsonb_typeof(entry->'startOccurrence') IS DISTINCT FROM 'string' OR entry->>'startOccurrence' NOT IN ('','earlier','later'))
   OR entry ? 'endOccurrence' AND (jsonb_typeof(entry->'endOccurrence') IS DISTINCT FROM 'string' OR entry->>'endOccurrence' NOT IN ('','earlier','later'))
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_selection'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'id')::uuid) FROM jsonb_array_elements(p_input->family))<>jsonb_array_length(p_input->family) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_selection'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'revision',(value->>'revision')::integer,'startOccurrence',coalesce(value->>'startOccurrence',''),'endOccurrence',coalesce(value->>'endOccurrence','')) ORDER BY (value->>'id')::uuid),'[]') INTO selected FROM jsonb_array_elements(p_input->family);
  output:=output||jsonb_build_object(family,selected);
 END LOOP;
 RETURN output||jsonb_build_object('sourceWeek',first_week,'targetWeek',last_week);
END;
$$;

CREATE FUNCTION candidate_operations.copy_local_instant(p_original timestamptz,p_days integer,p_timezone text,p_occurrence text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE wanted timestamp;anchor timestamptz;choices timestamptz[];
BEGIN
 wanted:=(p_original AT TIME ZONE p_timezone)+make_interval(days=>p_days);anchor:=wanted AT TIME ZONE p_timezone;
 -- Discover offsets around the destination, including half-hour and date-line changes.
 SELECT array_agg(DISTINCT instant ORDER BY instant) INTO choices FROM (
  SELECT (wanted AT TIME ZONE 'UTC')-((g AT TIME ZONE p_timezone)-(g AT TIME ZONE 'UTC')) instant
  FROM generate_series(anchor-interval '2 days',anchor+interval '2 days',interval '1 hour') g
 ) candidates WHERE instant AT TIME ZONE p_timezone=wanted;
 IF coalesce(cardinality(choices),0)=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='copy_time_nonexistent'; END IF;
 IF cardinality(choices)>1 AND p_occurrence='' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='copy_occurrence_required'; END IF;
 RETURN CASE WHEN p_occurrence='later' THEN choices[cardinality(choices)] ELSE choices[1] END;
END;
$$;

CREATE FUNCTION candidate_operations.copy_actor(p_subject text,p_member uuid,p_restaurant text) RETURNS candidate_identity.memberships
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(p_restaurant,actor.position)
 OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 RETURN actor;
END;
$$;

CREATE FUNCTION candidate_operations.copy_plan(p_actor uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
<<copy_plan_work>>
DECLARE scope candidate_identity.restaurants;options jsonb;kind text;entry jsonb;s candidate_operations.shift_references;n candidate_operations.staffing_needs;
 owner candidate_identity.memberships;st candidate_operations.station_references;source jsonb;context jsonb;row_value jsonb;rows jsonb:='[]';final_rows jsonb:='[]';
 issue text;first_at timestamptz;last_at timestamptz;days integer;department_name text;job text;original_start timestamptz;original_end timestamptz;current_revision integer;
 duplicate_id uuid;related jsonb;bookings jsonb;leaves jsonb;avail jsonb;jobs jsonb;station_context jsonb;close_ids jsonb;
BEGIN
 options:=candidate_operations.copy_selection(p_selection);SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 IF (options->>'targetWeek')::date<(clock_timestamp() AT TIME ZONE scope.timezone)::date THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_week'; END IF;
 days:=(options->>'targetWeek')::date-(options->>'sourceWeek')::date;
 FOR kind,entry IN SELECT 'shift',value FROM jsonb_array_elements(options->'shifts') UNION ALL SELECT 'staffing',value FROM jsonb_array_elements(options->'staffing') LOOP
  source:=NULL;owner:=NULL;st:=NULL;context:=NULL;issue:='';first_at:=NULL;last_at:=NULL;duplicate_id:=NULL;close_ids:='[]';
  row_value:=jsonb_build_object('kind',kind,'id',entry->'id','sourceRevision',entry->'revision');
  IF kind='shift' THEN
   SELECT * INTO s FROM candidate_operations.shift_references WHERE id=(entry->>'id')::uuid AND restaurant_id=p_restaurant;
   IF FOUND AND candidate_operations.goal_authorized(p_actor,s.department,'schedule.manage') THEN
    source:=candidate_operations.correction_source_key(to_jsonb(s))||jsonb_build_object('id',s.id,'releasedAt',s.released_at,'stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision);
    department_name:=s.department;job:=s.position;original_start:=s.starts_at;original_end:=s.ends_at;current_revision:=s.revision;
    SELECT * INTO owner FROM candidate_identity.memberships WHERE id=s.member_id AND restaurant_id=p_restaurant;
    SELECT * INTO st FROM candidate_operations.station_references WHERE id=s.station_id AND restaurant_id=p_restaurant;
    SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') INTO close_ids FROM candidate_operations.closes WHERE shift_id=s.id;
    IF s.cancelled THEN issue:='copy_source_unavailable'; END IF;
   END IF;
  ELSE
   SELECT * INTO n FROM candidate_operations.staffing_needs WHERE id=(entry->>'id')::uuid AND restaurant_id=p_restaurant;
   IF FOUND AND candidate_operations.goal_authorized(p_actor,n.department,'schedule.manage') THEN
    source:=jsonb_build_object('id',n.id,'revision',n.revision,'department',n.department,'title',n.title,'position',n.position,'start',n.starts_at,'end',n.ends_at,'minimum',n.minimum,'source',n.source,'status',n.status);
    department_name:=n.department;job:=n.position;original_start:=n.starts_at;original_end:=n.ends_at;current_revision:=n.revision;
    IF n.status<>'approved' THEN issue:='copy_source_unavailable'; END IF;
   END IF;
  END IF;
  IF source IS NULL THEN
   rows:=rows||jsonb_build_array(row_value||jsonb_build_object('status','rejected','issues',jsonb_build_array(jsonb_build_object('code','copy_source_unavailable'))));CONTINUE;
  END IF;
  context:=jsonb_build_object('source',source,'closingIds',close_ids);
  row_value:=row_value||jsonb_build_object('area',department_name,'position',job,'sourceKey',source,'sourceStart',original_start,'sourceEnd',original_end,'currentSourceRevision',current_revision,'omittedClosingCount',jsonb_array_length(close_ids));
  IF kind='staffing' THEN
   context:=context||jsonb_build_object('departmentAvailable',EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.department=department_name AND (m.active OR m.schedule_only)));
   row_value:=row_value||jsonb_build_object('title',n.title,'minimum',n.minimum);
   IF issue='' AND context->'departmentAvailable' IS DISTINCT FROM 'true'::jsonb THEN issue:='invalid_staffing_department'; END IF;
  END IF;
  IF current_revision<>(entry->>'revision')::integer THEN issue:='revision_conflict';
  ELSIF (original_start AT TIME ZONE scope.timezone)::date<(options->>'sourceWeek')::date OR (original_start AT TIME ZONE scope.timezone)::date>=(options->>'sourceWeek')::date+7 THEN issue:='copy_source_week_conflict'; END IF;
  BEGIN
   first_at:=candidate_operations.copy_local_instant(original_start,days,scope.timezone,entry->>'startOccurrence');
   last_at:=candidate_operations.copy_local_instant(original_end,days,scope.timezone,entry->>'endOccurrence');
   IF last_at<=first_at OR last_at-first_at>interval '24 hours' THEN issue:='invalid_draft_duration';
   ELSIF first_at<=clock_timestamp() THEN issue:='copy_destination_started'; END IF;
  EXCEPTION WHEN SQLSTATE '22023' THEN issue:=SQLERRM;
  END;
  SELECT o.target_id INTO duplicate_id FROM candidate_operations.schedule_copy_origins o
  WHERE o.restaurant_id=p_restaurant AND o.kind=copy_plan_work.kind AND o.source_id=(entry->>'id')::uuid AND o.target_week=(options->>'targetWeek')::date
  AND (copy_plan_work.kind='shift' AND EXISTS(SELECT 1 FROM candidate_operations.shift_references t WHERE t.id=o.target_id AND NOT t.cancelled)
    OR copy_plan_work.kind='staffing' AND EXISTS(SELECT 1 FROM candidate_operations.staffing_needs t WHERE t.id=o.target_id AND t.status<>'retired')) ORDER BY o.target_id LIMIT 1;
  context:=context||jsonb_build_object('existingCopyId',duplicate_id);IF duplicate_id IS NOT NULL THEN issue:='copy_duplicate'; END IF;
  IF kind='shift' THEN
   row_value:=row_value||jsonb_build_object('personId',s.member_id,'personKey',owner.person_id,'stationId',s.station_id,'stationName',st.title,'stationRevision',st.revision);
   SELECT coalesce(jsonb_agg(jsonb_build_object('job',e.job,'source',e.source,'active',e.active) ORDER BY e.job,e.source),'[]') INTO jobs FROM candidate_identity.schedule_eligibility e WHERE e.member_id=owner.id;
   station_context:=CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('station',to_jsonb(st),'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.job),'[]') FROM candidate_operations.station_jobs j WHERE j.station_id=st.id),'members',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=st.id)) END;
   SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.shift_id),'[]') INTO bookings FROM candidate_operations.person_shift_bookings b WHERE b.person_id=owner.person_id AND first_at IS NOT NULL AND last_at>first_at AND b.period&&CASE WHEN first_at IS NOT NULL AND last_at>first_at THEN tstzrange(first_at,last_at,'[)') ELSE 'empty'::tstzrange END;
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'member',l.member_id,'start',l.starts_at,'end',l.ends_at,'status',l.status) ORDER BY l.id),'[]') INTO leaves FROM candidate_operations.time_off_references l JOIN candidate_identity.memberships m ON m.id=l.member_id WHERE m.person_id=owner.person_id AND l.status='approved' AND l.starts_at<last_at AND l.ends_at>first_at;
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'revision',a.revision,'status',a.status,'data',a.data) ORDER BY a.id),'[]') INTO avail FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant AND a.member_id=owner.id AND a.status='approved';
   context:=context||jsonb_build_object('member',jsonb_build_object('id',owner.id,'person',owner.person_id,'area',owner.department,'position',owner.position,'active',owner.active,'scheduleOnly',owner.schedule_only),'jobs',jobs,'station',station_context,'bookings',bookings,'leave',leaves,'availability',avail);
   IF issue='' THEN
    IF owner.id IS NULL OR NOT(owner.active OR owner.schedule_only) OR owner.department<>s.department THEN issue:='owner_denied';
    ELSIF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=owner.id AND e.active AND e.job=s.position) THEN issue:='schedule_job_denied';
    ELSIF s.station_id IS NOT NULL AND NOT candidate_operations.station_assignment_allowed(s.station_id,p_restaurant,owner.id,s.position) THEN issue:='station_needs_individual_review';
    ELSIF candidate_operations.person_time_off_conflict(owner.id,first_at,last_at) THEN issue:='approved_time_off_conflict';
    ELSIF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND status='approved' AND candidate_operations.availability_period_conflict(data,first_at,last_at,scope.timezone)) THEN issue:='availability_shift_conflict';
    ELSIF candidate_operations.person_shift_conflict(owner.id,first_at,last_at,NULL) THEN issue:='shift_overlap'; END IF;
   END IF;
  END IF;
  row_value:=row_value||jsonb_build_object('start',first_at,'end',last_at,'existingCopyId',duplicate_id,'status',CASE WHEN issue='' THEN 'ready' ELSE 'rejected' END,'issues',CASE WHEN issue='' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('code',issue)) END,'context',context);
  rows:=rows||jsonb_build_array(row_value);
 END LOOP;
 -- Copy proposals have no old destination slots to restore. Both conflicting new
 -- slots are permanent seeds; independent staffing rows never enter this graph.
 FOR row_value IN SELECT value FROM jsonb_array_elements(rows) ORDER BY value->>'kind',value->>'id' LOOP
  IF row_value->>'kind'='shift' AND (row_value->>'status'='ready' OR row_value->'issues'->0->>'code'='shift_overlap') THEN
   SELECT coalesce(jsonb_agg(other->'id' ORDER BY other->>'id'),'[]') INTO related FROM jsonb_array_elements(rows) other
   WHERE other->>'kind'='shift' AND (other->>'status'='ready' OR other->'issues'->0->>'code'='shift_overlap') AND other->>'id'<>row_value->>'id' AND other->>'personKey'=row_value->>'personKey'
   AND (other->>'start')::timestamptz<(row_value->>'end')::timestamptz AND (other->>'end')::timestamptz>(row_value->>'start')::timestamptz;
   IF jsonb_array_length(related)>0 THEN row_value:=row_value||jsonb_build_object('status','rejected','issues',(row_value->'issues')||jsonb_build_array(jsonb_build_object('code','proposed_shift_overlap','sourceIds',related))); END IF;
  END IF;
  final_rows:=final_rows||jsonb_build_array(row_value);
 END LOOP;
 RETURN jsonb_build_object('selection',options,'rows',final_rows,'configuration',jsonb_build_object('timezone',scope.timezone,'departments',scope.operating_departments,'dishPosition',scope.dish_position,'dishDepartment',scope.dish_department,'dishAliases',scope.dish_aliases),
 'actor',jsonb_build_object('id',p_actor,'area',(SELECT department FROM candidate_identity.memberships WHERE id=p_actor),'caps',(SELECT jsonb_agg(capability ORDER BY capability) FROM candidate_identity.membership_capabilities WHERE membership_id=p_actor AND active)),
 'complete',EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete));
END;
$$;

CREATE FUNCTION candidate_operations.read_schedule_copy_review(p_subject text,p_member uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;plan jsonb;items jsonb;token text;
BEGIN
 actor:=candidate_operations.copy_actor(p_subject,p_member,p_restaurant);plan:=candidate_operations.copy_plan(actor.id,p_restaurant,p_selection);
 SELECT jsonb_agg(value-'context'-'personKey'-'sourceKey' ORDER BY value->>'kind',value->>'id') INTO items FROM jsonb_array_elements(plan->'rows');
 token:=encode(sha256(convert_to(jsonb_build_object('version',1,'action','shift.copy-week','restaurant',p_restaurant,'plan',plan)::text,'UTF8')),'hex');
 RETURN jsonb_build_object('selection',plan->'selection','items',items,'reviewToken',token,'sourceReviewComplete',plan->'complete','timezone',plan->'configuration'->'timezone','coverage','candidate-schedule-copy-review');
END;
$$;

CREATE FUNCTION candidate_operations.copy_schedule_week(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;receipt candidate_operations.command_receipts;options jsonb;plan jsonb;review jsonb;input jsonb;row_value jsonb;outcome jsonb;outcomes jsonb:='[]';
 scope_key text;created uuid;rec candidate_operations.shift_references;need candidate_operations.staffing_needs;provenance jsonb;reason text;result jsonb;version integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.copy-week'
 OR NOT p_payload ? 'input' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_command'; END IF;
 actor:=candidate_operations.copy_actor(p_subject,p_member,p_restaurant);input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['sourceWeek','targetWeek','shifts','staffing','reviewToken','note','confirmed']
 OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'note')) NOT BETWEEN 1 AND 2000
 OR jsonb_typeof(input->'reviewToken') IS DISTINCT FROM 'string' OR input->>'reviewToken' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_command'; END IF;
 options:=candidate_operations.copy_selection(input-'reviewToken'-'note'-'confirmed');reason:=candidate_operations.attendance_text(input->>'note');
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  FOR row_value IN SELECT value FROM jsonb_array_elements(receipt.result->'items') LOOP
   IF row_value ? 'area' AND NOT candidate_operations.goal_authorized(actor.id,row_value->>'area','schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  END LOOP;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 -- Freeze person-wide inputs by taking existing affected scope locks in order.
 FOR scope_key IN SELECT DISTINCT m.restaurant_id FROM candidate_identity.memberships m WHERE m.person_id IN (
  SELECT source_member.person_id FROM candidate_operations.shift_references s JOIN candidate_identity.memberships source_member ON source_member.id=s.member_id
  WHERE s.restaurant_id=p_restaurant AND s.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(options->'shifts')) AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage')
 ) ORDER BY m.restaurant_id LOOP PERFORM candidate_operations.lock_scope(scope_key,true); END LOOP;
 review:=candidate_operations.read_schedule_copy_review(p_subject,p_member,p_restaurant,options);
 IF review->>'reviewToken'<>input->>'reviewToken' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='copy_review_changed'; END IF;
 IF review->'sourceReviewComplete' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 plan:=candidate_operations.copy_plan(actor.id,p_restaurant,options);
 FOR row_value IN SELECT value FROM jsonb_array_elements(plan->'rows') LOOP
  outcome:=row_value-'context'-'personKey'-'sourceKey';
  IF row_value->>'status'='ready' THEN
   created:=gen_random_uuid();provenance:=jsonb_build_object('id',row_value->'id','revision',row_value->'sourceRevision','sourceWeek',options->'sourceWeek','targetWeek',options->'targetWeek');
   IF row_value->>'kind'='shift' THEN
    INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,station_id,station_name,station_revision)
    VALUES(created,p_restaurant,(row_value->>'personId')::uuid,row_value->>'area',row_value->>'position',(row_value->>'start')::timestamptz,(row_value->>'end')::timestamptz,1,false,(row_value->>'stationId')::uuid,row_value->>'stationName',(row_value->>'stationRevision')::integer) RETURNING * INTO rec;
    INSERT INTO candidate_operations.schedule_draft_events VALUES(created,1,actor.id,jsonb_build_object('personId',rec.member_id,'position',rec.position,'start',rec.starts_at,'end',rec.ends_at,'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision,'published',false,'note',reason,'copiedFrom',provenance),clock_timestamp());
   ELSE
    SELECT * INTO need FROM candidate_operations.staffing_needs WHERE id=(row_value->>'id')::uuid;
    INSERT INTO candidate_operations.staffing_needs(id,restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status,revision,copied_from)
    VALUES(created,p_restaurant,need.department,actor.id,need.title,need.position,(row_value->>'start')::timestamptz,(row_value->>'end')::timestamptz,need.minimum,need.source,'draft',1,provenance) RETURNING * INTO need;
    INSERT INTO candidate_operations.staffing_events VALUES(created,1,actor.id,'staffing.save',reason,to_jsonb(need),clock_timestamp());
   END IF;
   INSERT INTO candidate_operations.schedule_copy_origins VALUES(row_value->>'kind',created,p_restaurant,(row_value->>'id')::uuid,(row_value->>'sourceRevision')::integer,(options->>'sourceWeek')::date,(options->>'targetWeek')::date,plan->'configuration'->>'timezone',actor.id,p_request,row_value->'sourceKey',clock_timestamp());
   outcome:=outcome||jsonb_build_object('status','saved','recordId',created,'revision',1);
  END IF;
  outcomes:=outcomes||jsonb_build_array(outcome);
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(outcomes) v WHERE v->>'status'='saved') THEN UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO version;
 ELSE SELECT revision INTO version FROM candidate_identity.restaurants WHERE id=p_restaurant; END IF;
 result:=jsonb_build_object('recordId',p_request,'revision',1,'requestId',p_request,'workspaceRevision',version,'appliedAt',clock_timestamp(),'replayed',false,'items',outcomes,
 'savedCount',(SELECT count(*) FROM jsonb_array_elements(outcomes) v WHERE v->>'status'='saved'),'rejectedCount',(SELECT count(*) FROM jsonb_array_elements(outcomes) v WHERE v->>'status'='rejected'),
 'scheduleRevision',(SELECT schedule_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant),'inputRevision',(SELECT input_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.copy_selection(jsonb),candidate_operations.copy_local_instant(timestamptz,integer,text,text),candidate_operations.copy_actor(text,uuid,text),candidate_operations.copy_plan(uuid,text,jsonb),candidate_operations.read_schedule_copy_review(text,uuid,text,jsonb),candidate_operations.copy_schedule_week(text,uuid,text,uuid,jsonb) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.read_schedule_copy_review(text,uuid,text,jsonb),candidate_operations.copy_schedule_week(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
