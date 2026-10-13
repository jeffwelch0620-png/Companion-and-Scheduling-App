-- Review refinement: fixed external preflight precedes pairwise seeds.
-- Preserve all shared migrations 001-059; no active application adoption.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.copy_plan(p_actor uuid,p_restaurant text,p_selection jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
<<copy_plan_work>>
DECLARE scope candidate_identity.restaurants;options jsonb;kind text;entry jsonb;s candidate_operations.shift_references;n candidate_operations.staffing_needs;
 owner candidate_identity.memberships;st candidate_operations.station_references;source jsonb;context jsonb;row_value jsonb;rows jsonb:='[]';final_rows jsonb:='[]';
 issue text;first_at timestamptz;last_at timestamptz;days integer;department_name text;job text;original_start timestamptz;original_end timestamptz;current_revision integer;
 duplicate_id uuid;related jsonb;bookings jsonb;leaves jsonb;avail jsonb;jobs jsonb;station_context jsonb;close_ids jsonb;staffing_overlaps jsonb;warnings jsonb;
BEGIN
 options:=candidate_operations.copy_selection(p_selection);SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 IF (options->>'targetWeek')::date<(clock_timestamp() AT TIME ZONE scope.timezone)::date THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_copy_week'; END IF;
 days:=(options->>'targetWeek')::date-(options->>'sourceWeek')::date;
 FOR kind,entry IN SELECT 'shift',value FROM jsonb_array_elements(options->'shifts') UNION ALL SELECT 'staffing',value FROM jsonb_array_elements(options->'staffing') LOOP
  source:=NULL;owner:=NULL;st:=NULL;context:=NULL;issue:='';first_at:=NULL;last_at:=NULL;duplicate_id:=NULL;close_ids:='[]';warnings:='[]';
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
  IF kind='staffing' AND issue='' THEN
   -- Draft creation stays available. Approval uses this same store/department/job
   -- overlap predicate; only a minimal warning is exposed to the authorized viewer.
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',approved.id,'revision',approved.revision,'start',approved.starts_at,'end',approved.ends_at) ORDER BY approved.id),'[]') INTO staffing_overlaps
   FROM candidate_operations.staffing_needs approved
   WHERE approved.restaurant_id=p_restaurant AND approved.department=department_name AND approved.position=job
   AND approved.status='approved' AND approved.starts_at<last_at AND approved.ends_at>first_at;
   context:=context||jsonb_build_object('approvedStaffingOverlaps',staffing_overlaps);
   IF jsonb_array_length(staffing_overlaps)>0 THEN warnings:=jsonb_build_array(jsonb_build_object('code','staffing_overlap_at_approval','message','This staffing draft overlaps an approved need. Resolve the overlap before approval.')); END IF;
  END IF;
  row_value:=row_value||jsonb_build_object('warnings',warnings);
  row_value:=row_value||jsonb_build_object('start',first_at,'end',last_at,'existingCopyId',duplicate_id,'status',CASE WHEN issue='' THEN 'ready' ELSE 'rejected' END,'issues',CASE WHEN issue='' THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('code',issue)) END,'context',context);
  rows:=rows||jsonb_build_array(row_value);
 END LOOP;
 -- Copy proposals have no old destination slots to restore. Both conflicting new
 -- slots are permanent seeds only after fixed external preflight passes on both
 -- sides. Rejected rows and independent staffing never enter this pair graph.
 FOR row_value IN SELECT value FROM jsonb_array_elements(rows) ORDER BY value->>'kind',value->>'id' LOOP
  IF row_value->>'kind'='shift' AND row_value->>'status'='ready' THEN
   SELECT coalesce(jsonb_agg(other->'id' ORDER BY other->>'id'),'[]') INTO related FROM jsonb_array_elements(rows) other
   WHERE other->>'kind'='shift' AND other->>'status'='ready' AND other->>'id'<>row_value->>'id' AND other->>'personKey'=row_value->>'personKey'
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
REVOKE ALL ON FUNCTION candidate_operations.copy_plan(uuid,text,jsonb) FROM PUBLIC,candidate_runtime;
COMMIT;
