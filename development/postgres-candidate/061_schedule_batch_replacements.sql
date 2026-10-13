-- Isolated candidate only. Preserve published migrations 001-060.
-- Future command-created draft replacements; no publication or linked-work edits.
BEGIN;
CREATE FUNCTION candidate_operations.batch_selection(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE week_date date;entry jsonb;fields jsonb;key text;selected jsonb:='[]';
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT p_input ?& ARRAY['weekStart','drafts']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('weekStart','drafts'))
 OR jsonb_typeof(p_input->'weekStart') IS DISTINCT FROM 'string' OR p_input->>'weekStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR jsonb_typeof(p_input->'drafts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'drafts') NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_selection'; END IF;
 week_date:=(p_input->>'weekStart')::date;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_input->'drafts') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['id','revision','input']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('id','revision','input'))
  OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'string' OR entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(entry->'revision') IS DISTINCT FROM 'number' OR entry->>'revision' !~ '^[1-9][0-9]*$' OR (entry->>'revision')::numeric>2147483646
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_selection'; END IF;
  fields:=entry->'input';
  IF jsonb_typeof(fields) IS DISTINCT FROM 'object' OR NOT fields ?& ARRAY['personId','position','startLocal','endLocal']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(fields) k WHERE k NOT IN ('personId','position','startLocal','endLocal','startOccurrence','endOccurrence'))
  OR jsonb_typeof(fields->'personId') IS DISTINCT FROM 'string' OR fields->>'personId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR jsonb_typeof(fields->'position') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(fields->>'position')) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_fields'; END IF;
  FOREACH key IN ARRAY ARRAY['startLocal','endLocal'] LOOP
   IF jsonb_typeof(fields->key) IS DISTINCT FROM 'string' OR fields->>key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$'
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_time'; END IF;
   fields:=jsonb_set(fields,ARRAY[key],to_jsonb(to_char((fields->>key)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US')));
  END LOOP;
  FOREACH key IN ARRAY ARRAY['startOccurrence','endOccurrence'] LOOP
   IF fields ? key AND (jsonb_typeof(fields->key) IS DISTINCT FROM 'string' OR fields->>key NOT IN ('','earlier','later'))
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_occurrence'; END IF;
   fields:=jsonb_set(fields,ARRAY[key],coalesce(fields->key,'""'::jsonb));
  END LOOP;
  fields:=fields||jsonb_build_object('personId',(fields->>'personId')::uuid,'position',candidate_operations.attendance_text(fields->>'position'));
  selected:=selected||jsonb_build_array(jsonb_build_object('id',(entry->>'id')::uuid,'revision',(entry->>'revision')::integer,'input',fields));
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(selected))<>jsonb_array_length(selected)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_selection'; END IF;
 SELECT jsonb_agg(value ORDER BY value->>'id') INTO selected FROM jsonb_array_elements(selected);
 RETURN jsonb_build_object('weekStart',week_date,'drafts',selected);
END;
$$;

CREATE FUNCTION candidate_operations.batch_local_instant(p_local text,p_original timestamptz,p_timezone text,p_occurrence text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE wanted timestamp;anchor timestamptz;choices timestamptz[];
BEGIN
 wanted:=p_local::timestamp;
 -- Retain the exact saved instant only for an unchanged local field without a choice.
 IF p_occurrence='' AND wanted=p_original AT TIME ZONE p_timezone THEN RETURN p_original; END IF;
 anchor:=wanted AT TIME ZONE p_timezone;
 SELECT array_agg(DISTINCT instant ORDER BY instant) INTO choices FROM (
  SELECT (wanted AT TIME ZONE 'UTC')-((g AT TIME ZONE p_timezone)-(g AT TIME ZONE 'UTC')) instant
  FROM generate_series(anchor-interval '2 days',anchor+interval '2 days',interval '1 hour') g
 ) candidates WHERE instant AT TIME ZONE p_timezone=wanted;
 IF coalesce(cardinality(choices),0)=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='batch_time_nonexistent'; END IF;
 IF cardinality(choices)>1 AND p_occurrence='' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='batch_occurrence_required'; END IF;
 RETURN CASE WHEN p_occurrence='later' THEN choices[cardinality(choices)] ELSE choices[1] END;
END;
$$;

CREATE FUNCTION candidate_operations.batch_plan(p_actor uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE scope candidate_identity.restaurants;options jsonb;entry jsonb;fields jsonb;rec candidate_operations.shift_references;
 target candidate_identity.memberships;station candidate_operations.station_references;local_ids uuid[];old_slots jsonb;rows jsonb:='[]';next_rows jsonb;
 row_value jsonb;source jsonb;context jsonb;links jsonb;linked_kinds jsonb;jobs jsonb;bookings jsonb;leaves jsonb;availability jsonb;
 related jsonb;public_related jsonb;dependencies jsonb;rejected_ids uuid[];new_rejected_ids uuid[];visible_ids uuid[];graph jsonb;next_rejections jsonb;rejection_info jsonb:='{}';issue text;first_at timestamptz;last_at timestamptz;round_number integer;at_time timestamptz:=clock_timestamp();
BEGIN
 options:=candidate_operations.batch_selection(p_selection);SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO local_ids FROM candidate_operations.shift_references
 WHERE restaurant_id=p_restaurant AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(options->'drafts'));
 SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.shift_id),'[]') INTO old_slots FROM candidate_operations.person_shift_bookings b WHERE b.shift_id=ANY(local_ids);
 FOR entry IN SELECT value FROM jsonb_array_elements(options->'drafts') LOOP
  fields:=entry->'input';issue:='';first_at:=NULL;last_at:=NULL;target:=NULL;station:=NULL;
  row_value:=jsonb_build_object('kind','shift','id',entry->'id','sourceRevision',entry->'revision');
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND id=(entry->>'id')::uuid;
  IF NOT FOUND OR NOT candidate_operations.goal_authorized(p_actor,rec.department,'schedule.manage') THEN
   rows:=rows||jsonb_build_array(row_value||jsonb_build_object('status','rejected','issues',jsonb_build_array(jsonb_build_object('code','batch_source_unavailable'))));CONTINUE;
  END IF;
  source:=candidate_operations.correction_source_key(to_jsonb(rec))||jsonb_build_object('id',rec.id,'releasedAt',rec.released_at,'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision);
  SELECT jsonb_build_object('tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),'[]') FROM candidate_operations.tasks WHERE shift_id=rec.id),
   'closes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),'[]') FROM candidate_operations.closes WHERE shift_id=rec.id),
   'standardLinks',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.standard_id),'[]') FROM candidate_operations.shift_standard_links l WHERE l.shift_id=rec.id)) INTO links;
  SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') INTO linked_kinds FROM jsonb_each(links) WHERE jsonb_array_length(value)>0;
  context:=jsonb_build_object('source',source,'links',links);
  row_value:=row_value||jsonb_build_object('area',rec.department,'currentSourceRevision',rec.revision,'linkedKinds',linked_kinds,
   'before',jsonb_build_object('personId',rec.member_id,'position',rec.position,'start',rec.starts_at,'end',rec.ends_at,'startLocal',to_char(rec.starts_at AT TIME ZONE scope.timezone,'YYYY-MM-DD"T"HH24:MI:SS.US'),'endLocal',to_char(rec.ends_at AT TIME ZONE scope.timezone,'YYYY-MM-DD"T"HH24:MI:SS.US'),'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision));
  IF rec.revision<>(entry->>'revision')::integer THEN issue:='revision_conflict';
  ELSIF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN issue:='batch_source_ineligible';
  ELSIF rec.starts_at<=at_time THEN issue:='batch_source_started';
  ELSIF (rec.starts_at AT TIME ZONE scope.timezone)::date<(options->>'weekStart')::date OR (rec.starts_at AT TIME ZONE scope.timezone)::date>=(options->>'weekStart')::date+7 THEN issue:='batch_week_conflict';
  ELSIF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN issue:='draft_reference_only';
  ELSIF jsonb_array_length(linked_kinds)>0 THEN issue:='linked_shift_protected'; END IF;
  BEGIN
   first_at:=candidate_operations.batch_local_instant(fields->>'startLocal',rec.starts_at,scope.timezone,fields->>'startOccurrence');
   last_at:=candidate_operations.batch_local_instant(fields->>'endLocal',rec.ends_at,scope.timezone,fields->>'endOccurrence');
   IF issue='' THEN
    IF last_at<=first_at OR last_at-first_at>interval '24 hours' THEN issue:='invalid_draft_duration';
    ELSIF first_at<=at_time THEN issue:='batch_destination_started';
    ELSIF (first_at AT TIME ZONE scope.timezone)::date<(options->>'weekStart')::date OR (first_at AT TIME ZONE scope.timezone)::date>=(options->>'weekStart')::date+7 THEN issue:='batch_week_conflict'; END IF;
   END IF;
  EXCEPTION WHEN SQLSTATE '22023' THEN IF issue='' THEN issue:=SQLERRM; END IF;
  END;
  SELECT * INTO target FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND id=(fields->>'personId')::uuid;
  SELECT * INTO station FROM candidate_operations.station_references WHERE restaurant_id=p_restaurant AND id=rec.station_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('job',e.job,'source',e.source,'active',e.active) ORDER BY e.job,e.source),'[]') INTO jobs FROM candidate_identity.schedule_eligibility e WHERE e.member_id=target.id;
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.shift_id),'[]') INTO bookings FROM candidate_operations.person_shift_bookings b WHERE b.person_id=target.person_id AND first_at IS NOT NULL AND last_at>first_at
   AND b.period&&CASE WHEN first_at IS NOT NULL AND last_at>first_at THEN tstzrange(first_at,last_at,'[)') ELSE 'empty'::tstzrange END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'member',l.member_id,'start',l.starts_at,'end',l.ends_at,'status',l.status) ORDER BY l.id),'[]') INTO leaves FROM candidate_operations.time_off_references l JOIN candidate_identity.memberships m ON m.id=l.member_id WHERE m.person_id=target.person_id AND l.status='approved' AND l.starts_at<last_at AND l.ends_at>first_at;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'status',status,'data',data) ORDER BY id),'[]') INTO availability FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=target.id AND status='approved';
  context:=context||jsonb_build_object('member',CASE WHEN target.id IS NULL THEN NULL ELSE jsonb_build_object('id',target.id,'person',target.person_id,'area',target.department,'position',target.position,'active',target.active,'scheduleOnly',target.schedule_only) END,'jobs',jobs,'bookings',bookings,'leave',leaves,'availability',availability,
   'station',CASE WHEN station.id IS NULL THEN NULL ELSE jsonb_build_object('definition',to_jsonb(station),'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.job),'[]') FROM candidate_operations.station_jobs j WHERE j.station_id=station.id),'members',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=station.id)) END);
  IF issue='' THEN
   IF target.id IS NULL OR NOT(target.active OR target.schedule_only) OR target.department<>rec.department THEN issue:='owner_denied';
   ELSIF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=target.id AND e.active AND e.job=fields->>'position') THEN issue:='schedule_job_denied';
   ELSIF rec.station_id IS NOT NULL AND NOT candidate_operations.station_assignment_allowed(rec.station_id,p_restaurant,target.id,fields->>'position') THEN issue:='station_needs_individual_review';
   ELSIF candidate_operations.person_time_off_conflict(target.id,first_at,last_at) THEN issue:='approved_time_off_conflict';
   ELSIF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=target.id AND status='approved' AND candidate_operations.availability_period_conflict(data,first_at,last_at,scope.timezone)) THEN issue:='availability_shift_conflict';
   ELSIF EXISTS(SELECT 1 FROM candidate_operations.person_shift_bookings b WHERE b.person_id=target.person_id AND b.shift_id<>ALL(local_ids) AND b.period&&tstzrange(first_at,last_at,'[)')) THEN issue:='shift_overlap'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(b.shift_id ORDER BY b.shift_id),'[]') INTO dependencies FROM candidate_operations.person_shift_bookings b WHERE b.person_id=target.person_id AND b.shift_id=ANY(local_ids) AND b.shift_id<>rec.id AND first_at IS NOT NULL AND last_at>first_at
   AND b.period&&CASE WHEN first_at IS NOT NULL AND last_at>first_at THEN tstzrange(first_at,last_at,'[)') ELSE 'empty'::tstzrange END;
  row_value:=row_value||jsonb_build_object('personKey',target.person_id,'dependencyIds',dependencies,'context',context,
   'after',jsonb_build_object('personId',fields->'personId','position',fields->'position','start',first_at,'end',last_at,'startLocal',fields->'startLocal','endLocal',fields->'endLocal','stationId',rec.station_id,'stationName',station.title,'stationRevision',station.revision),
   'status',CASE WHEN issue='' THEN 'ready' ELSE 'rejected' END,'issues',CASE WHEN issue='' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('code',issue,'round',0)) END);
  rows:=rows||jsonb_build_array(row_value);
 END LOOP;
 -- Seed pairs simultaneously from the preflight-ready set only.
 next_rows:='[]';
 FOR row_value IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF row_value->>'status'='ready' THEN
   SELECT coalesce(jsonb_agg(other->'id' ORDER BY other->>'id'),'[]') INTO related FROM jsonb_array_elements(rows) other
   WHERE other->>'status'='ready' AND other->>'id'<>row_value->>'id' AND other->'personKey'=row_value->'personKey'
   AND (other->'after'->>'start')::timestamptz<(row_value->'after'->>'end')::timestamptz AND (other->'after'->>'end')::timestamptz>(row_value->'after'->>'start')::timestamptz;
   IF jsonb_array_length(related)>0 THEN row_value:=row_value||jsonb_build_object('status','rejected','issues',jsonb_build_array(jsonb_build_object('code','proposed_shift_overlap','sourceIds',related,'round',1))); END IF;
  END IF;
  next_rows:=next_rows||jsonb_build_array(row_value);
 END LOOP;
 rows:=next_rows;
 -- Propagate over a compact graph, without copying full private review contexts
 -- for every row in every round. Each round reads the preceding rejected set.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->'id','dependencyIds',value->'dependencyIds') ORDER BY value->>'id'),'[]') INTO graph FROM jsonb_array_elements(rows) WHERE value->>'status'='ready';
 SELECT coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) INTO rejected_ids FROM jsonb_array_elements(rows) WHERE value->>'status'='rejected';
 SELECT coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) INTO visible_ids FROM jsonb_array_elements(rows) WHERE value ? 'area';
 FOR round_number IN 2..101 LOOP
  WITH hits AS (
   SELECT candidate->>'id' id,jsonb_agg(dep.value ORDER BY dep.value) related
   FROM jsonb_array_elements(graph) candidate CROSS JOIN LATERAL jsonb_array_elements(candidate->'dependencyIds') dep(value)
   WHERE (candidate->>'id')::uuid<>ALL(rejected_ids) AND (dep.value#>>'{}')::uuid=ANY(rejected_ids)
   GROUP BY candidate->>'id'
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',hits.id,'related',hits.related) ORDER BY hits.id),'[]') INTO next_rejections FROM hits;
  EXIT WHEN jsonb_array_length(next_rejections)=0;
  SELECT array_agg((value->>'id')::uuid) INTO new_rejected_ids FROM jsonb_array_elements(next_rejections);
  FOR row_value IN SELECT value FROM jsonb_array_elements(next_rejections) LOOP
   SELECT coalesce(jsonb_agg(value ORDER BY value),'[]') INTO public_related FROM jsonb_array_elements(row_value->'related') WHERE (value#>>'{}')::uuid=ANY(visible_ids);
   rejection_info:=jsonb_set(rejection_info,ARRAY[row_value->>'id'],CASE WHEN jsonb_array_length(public_related)>0 THEN jsonb_build_object('code','depends_on_rejected_row','sourceIds',public_related,'round',round_number) ELSE jsonb_build_object('code','shift_overlap','round',round_number) END);
  END LOOP;
  rejected_ids:=rejected_ids||new_rejected_ids;
 END LOOP;
 SELECT jsonb_agg(CASE WHEN rejection_info ? (value->>'id') THEN value||jsonb_build_object('status','rejected','issues',jsonb_build_array(rejection_info->(value->>'id'))) ELSE value END ORDER BY value->>'id') INTO rows FROM jsonb_array_elements(rows);
 RETURN jsonb_build_object('selection',options,'rows',rows,'oldSlots',old_slots,'configuration',jsonb_build_object('timezone',scope.timezone,'departments',scope.operating_departments,'dishPosition',scope.dish_position,'dishDepartment',scope.dish_department,'dishAliases',scope.dish_aliases),
  'actor',jsonb_build_object('id',p_actor,'area',(SELECT department FROM candidate_identity.memberships WHERE id=p_actor),'caps',(SELECT jsonb_agg(capability ORDER BY capability) FROM candidate_identity.membership_capabilities WHERE membership_id=p_actor AND active)),
  'complete',EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete));
END;
$$;

CREATE FUNCTION candidate_operations.batch_review_token(p_restaurant text,p_plan jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('version',1,'action','shift.save-batch','restaurant',p_restaurant,'plan',p_plan)::text,'UTF8')),'hex');
$$;

CREATE FUNCTION candidate_operations.read_schedule_batch_review(p_subject text,p_member uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;plan jsonb;items jsonb;
BEGIN
 actor:=candidate_operations.copy_actor(p_subject,p_member,p_restaurant);plan:=candidate_operations.batch_plan(actor.id,p_restaurant,p_selection);
 SELECT jsonb_agg(value-'context'-'personKey'-'dependencyIds' ORDER BY value->>'id') INTO items FROM jsonb_array_elements(plan->'rows');
 RETURN jsonb_build_object('selection',plan->'selection','items',items,'reviewToken',candidate_operations.batch_review_token(p_restaurant,plan),'sourceReviewComplete',plan->'complete','timezone',plan->'configuration'->'timezone','coverage','candidate-schedule-batch-review',
  'readyCount',(SELECT count(*) FROM jsonb_array_elements(items) WHERE value->>'status'='ready'),'rejectedCount',(SELECT count(*) FROM jsonb_array_elements(items) WHERE value->>'status'='rejected'));
END;
$$;

CREATE FUNCTION candidate_operations.save_schedule_batch(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;receipt candidate_operations.command_receipts;options jsonb;plan jsonb;input jsonb;row_value jsonb;outcome jsonb;outcomes jsonb:='[]';
 scope_key text;rec candidate_operations.shift_references;reason text;result jsonb;version integer;accepted_ids uuid[];
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.save-batch'
 OR NOT p_payload ? 'input' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_command'; END IF;
 actor:=candidate_operations.copy_actor(p_subject,p_member,p_restaurant);input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['weekStart','drafts','reviewToken','note','confirmed']
 OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'note')) NOT BETWEEN 1 AND 2000
 OR jsonb_typeof(input->'reviewToken') IS DISTINCT FROM 'string' OR input->>'reviewToken' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_command'; END IF;
 options:=candidate_operations.batch_selection(input-'reviewToken'-'note'-'confirmed');reason:=candidate_operations.attendance_text(input->>'note');
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  FOR row_value IN SELECT value FROM jsonb_array_elements(receipt.result->'items') LOOP
   IF row_value ? 'area' AND NOT candidate_operations.goal_authorized(actor.id,row_value->>'area','schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  END LOOP;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 -- Coordinate old and proposed people, including their other existing memberships.
 FOR scope_key IN SELECT DISTINCT m.restaurant_id FROM candidate_identity.memberships m WHERE m.person_id IN (
  SELECT original.person_id FROM candidate_operations.shift_references s JOIN candidate_identity.memberships original ON original.id=s.member_id
  WHERE s.restaurant_id=p_restaurant AND s.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(options->'drafts')) AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage')
  UNION
  SELECT proposed.person_id FROM jsonb_array_elements(options->'drafts') selected JOIN candidate_operations.shift_references s ON s.id=(selected->>'id')::uuid AND s.restaurant_id=p_restaurant
   JOIN candidate_identity.memberships proposed ON proposed.id=(selected->'input'->>'personId')::uuid AND proposed.restaurant_id=p_restaurant AND proposed.department=s.department
  WHERE candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage')
 ) ORDER BY m.restaurant_id LOOP PERFORM candidate_operations.lock_scope(scope_key,true); END LOOP;
 PERFORM 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(options->'drafts')) AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage') ORDER BY s.id FOR UPDATE;
 plan:=candidate_operations.batch_plan(actor.id,p_restaurant,options);
 IF candidate_operations.batch_review_token(p_restaurant,plan)<>input->>'reviewToken' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='batch_review_changed'; END IF;
 IF plan->'complete' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 SELECT coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) INTO accepted_ids FROM jsonb_array_elements(plan->'rows') WHERE value->>'status'='ready';
 -- Remove only accepted old private projections inside this coordinated transaction.
 -- Original shift rows remain intact until their updates; readers see the committed
 -- old schedule. Normal triggers reinsert every final booking, with the immediate
 -- exclusion constraint continuously enabled. No trigger or constraint is disabled.
 DELETE FROM candidate_operations.person_shift_bookings WHERE shift_id=ANY(accepted_ids);
 FOR row_value IN SELECT value FROM jsonb_array_elements(plan->'rows') LOOP
  outcome:=row_value-'context'-'personKey'-'dependencyIds';
  IF row_value->>'status'='ready' THEN
   UPDATE candidate_operations.shift_references SET member_id=(row_value->'after'->>'personId')::uuid,position=row_value->'after'->>'position',starts_at=(row_value->'after'->>'start')::timestamptz,ends_at=(row_value->'after'->>'end')::timestamptz,
    station_name=row_value->'after'->>'stationName',station_revision=(row_value->'after'->>'stationRevision')::integer,revision=revision+1 WHERE id=(row_value->>'id')::uuid AND restaurant_id=p_restaurant RETURNING * INTO rec;
   INSERT INTO candidate_operations.schedule_draft_events VALUES(rec.id,rec.revision,actor.id,jsonb_build_object('action','shift.save-batch','batch',jsonb_build_object('requestId',p_request,'weekStart',options->'weekStart','timezone',plan->'configuration'->>'timezone'),
    'before',row_value->'before','beforeRevision',row_value->'currentSourceRevision','after',row_value->'after','personId',rec.member_id,'position',rec.position,'start',rec.starts_at,'end',rec.ends_at,'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision,'note',reason,'published',false),clock_timestamp());
   outcome:=outcome||jsonb_build_object('status','saved','recordId',rec.id,'revision',rec.revision);
  END IF;
  outcomes:=outcomes||jsonb_build_array(outcome);
 END LOOP;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references s LEFT JOIN candidate_operations.person_shift_bookings b ON b.shift_id=s.id JOIN candidate_identity.memberships m ON m.id=s.member_id
  WHERE s.id=ANY(accepted_ids) AND (b.shift_id IS NULL OR b.member_id<>s.member_id OR b.person_id<>m.person_id OR b.period<>tstzrange(s.starts_at,s.ends_at,'[)')))
 THEN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='batch_booking_invariant_failure'; END IF;
 IF cardinality(accepted_ids)>0 THEN UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO version;
 ELSE SELECT revision INTO version FROM candidate_identity.restaurants WHERE id=p_restaurant; END IF;
 result:=jsonb_build_object('recordId',p_request,'revision',1,'requestId',p_request,'workspaceRevision',version,'appliedAt',clock_timestamp(),'replayed',false,'items',outcomes,'savedCount',cardinality(accepted_ids),'rejectedCount',jsonb_array_length(outcomes)-cardinality(accepted_ids),
  'scheduleRevision',(SELECT schedule_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant),'inputRevision',(SELECT input_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.batch_selection(jsonb),candidate_operations.batch_local_instant(text,timestamptz,text,text),candidate_operations.batch_plan(uuid,text,jsonb),candidate_operations.batch_review_token(text,jsonb),candidate_operations.read_schedule_batch_review(text,uuid,text,jsonb),candidate_operations.save_schedule_batch(text,uuid,text,uuid,jsonb) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.read_schedule_batch_review(text,uuid,text,jsonb),candidate_operations.save_schedule_batch(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
