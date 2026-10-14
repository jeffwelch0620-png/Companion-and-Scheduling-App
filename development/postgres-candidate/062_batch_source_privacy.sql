-- Corrective batch review minimization. Preserve shared migrations 001-061.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.batch_plan(p_actor uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
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
  IF rec.revision<>(entry->>'revision')::integer THEN issue:='revision_conflict';
  ELSIF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN issue:='batch_source_ineligible';
  ELSIF rec.starts_at<=at_time THEN issue:='batch_source_started';
  ELSIF (rec.starts_at AT TIME ZONE scope.timezone)::date<(options->>'weekStart')::date OR (rec.starts_at AT TIME ZONE scope.timezone)::date>=(options->>'weekStart')::date+7 THEN issue:='batch_week_conflict';
  ELSIF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN issue:='draft_reference_only'; END IF;
  -- A scheduling-manager selection is not authority to inspect published duties.
  -- Classify noneditable sources before any linked-work or destination lookup.
  IF issue<>'' THEN
   rows:=rows||jsonb_build_array(row_value||jsonb_build_object('area',rec.department,'currentSourceRevision',rec.revision,'status','rejected','issues',jsonb_build_array(jsonb_build_object('code',issue,'round',0)),
    'context',jsonb_build_object('source',candidate_operations.correction_source_key(to_jsonb(rec))||jsonb_build_object('releasedAt',rec.released_at,'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision))));CONTINUE;
  END IF;
  source:=candidate_operations.correction_source_key(to_jsonb(rec))||jsonb_build_object('id',rec.id,'releasedAt',rec.released_at,'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision);
  SELECT jsonb_build_object('tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),'[]') FROM candidate_operations.tasks WHERE shift_id=rec.id),
   'closes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),'[]') FROM candidate_operations.closes WHERE shift_id=rec.id),
   'standardLinks',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.standard_id),'[]') FROM candidate_operations.shift_standard_links l WHERE l.shift_id=rec.id)) INTO links;
  SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') INTO linked_kinds FROM jsonb_each(links) WHERE jsonb_array_length(value)>0;
  context:=jsonb_build_object('source',source,'links',links);
  row_value:=row_value||jsonb_build_object('area',rec.department,'currentSourceRevision',rec.revision,'linkedKinds',linked_kinds,
   'before',jsonb_build_object('personId',rec.member_id,'position',rec.position,'start',rec.starts_at,'end',rec.ends_at,'startLocal',to_char(rec.starts_at AT TIME ZONE scope.timezone,'YYYY-MM-DD"T"HH24:MI:SS.US'),'endLocal',to_char(rec.ends_at AT TIME ZONE scope.timezone,'YYYY-MM-DD"T"HH24:MI:SS.US'),'stationId',rec.station_id,'stationName',rec.station_name,'stationRevision',rec.station_revision));
  IF jsonb_array_length(linked_kinds)>0 THEN issue:='linked_shift_protected'; END IF;
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
REVOKE ALL ON FUNCTION candidate_operations.batch_plan(uuid,text,jsonb) FROM PUBLIC,candidate_runtime;
COMMIT;
