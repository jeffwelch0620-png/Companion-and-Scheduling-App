-- Isolated candidate policy approved by the user. Preserve published migrations 001–037.
BEGIN;

CREATE OR REPLACE FUNCTION candidate_operations.change_schedule(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; rec candidate_operations.shift_references; updated candidate_operations.shift_references; target candidate_operations.shift_references; station candidate_operations.station_references; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 c candidate_operations.closes; mapping jsonb; input jsonb; result jsonb; cancelling boolean; structural boolean; note text; original_owner uuid; old_helper uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 cancelling:=p_payload->>'action'='shift.cancel';input:=p_payload->'input';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(p_payload->>'action','') NOT IN ('shift.save','shift.cancel') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_change'; END IF;
 IF jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR p_payload->>'recordId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_record'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 IF rec.published AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at) OR NOT rec.published AND NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF NOT cancelling AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF cancelling AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) t WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=(t->>'shiftId')::uuid AND s.restaurant_id=p_restaurant AND (s.published AND candidate_operations.published_change_allowed(actor.id,p_restaurant,s.department,s.starts_at,s.ends_at) OR NOT s.published AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage')))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.schedule_change_events e WHERE e.shift_id=rec.id AND e.revision=(receipt.result->>'revision')::integer AND (e.data->'before'->>'published')::boolean AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,e.data->'before'->>'department',(e.data->'before'->>'starts_at')::timestamptz,(e.data->'before'->>'ends_at')::timestamptz)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
 IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF rec.cancelled OR rec.released_at IS NOT NULL OR NOT cancelling AND NOT rec.published THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 -- Current server time after scope/row coordination; receipt replay above does not mutate.
 IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='schedule_change_note_required'; END IF;
 note:=btrim(input->>'note');original_owner:=rec.member_id;updated:=rec;updated.revision:=rec.revision+1;
 IF cancelling THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('note','closeTransfers')) OR input ? 'closeTransfers' AND jsonb_typeof(input->'closeTransfers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
  FOR mapping IN SELECT value FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) LOOP
   IF jsonb_typeof(mapping) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
   IF NOT mapping ?& ARRAY['closeId','closingRevision','shiftId','expectedRevision'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(mapping) k WHERE k NOT IN ('closeId','closingRevision','shiftId','expectedRevision')) OR jsonb_typeof(mapping->'closeId') IS DISTINCT FROM 'string' OR mapping->>'closeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(mapping->'shiftId') IS DISTINCT FROM 'string' OR mapping->>'shiftId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(mapping->'closingRevision') IS DISTINCT FROM 'number' OR mapping->>'closingRevision' !~ '^[1-9][0-9]*$' OR jsonb_typeof(mapping->'expectedRevision') IS DISTINCT FROM 'number' OR mapping->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id AND phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_task_pending'; END IF;
  IF jsonb_array_length(coalesce(input->'closeTransfers','[]'))<>(SELECT count(*) FROM candidate_operations.closes WHERE shift_id=rec.id AND phase NOT IN ('closed','cancelled')) OR (SELECT count(DISTINCT t->>'closeId') FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) t)<>jsonb_array_length(coalesce(input->'closeTransfers','[]')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
  FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=rec.id AND phase NOT IN ('closed','cancelled') ORDER BY id FOR UPDATE LOOP
   SELECT t INTO mapping FROM jsonb_array_elements(input->'closeTransfers') t WHERE t->>'closeId'=c.id::text;
   IF mapping IS NULL OR c.revision<>(mapping->>'closingRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
   SELECT * INTO target FROM candidate_operations.shift_references WHERE id=(mapping->>'shiftId')::uuid AND restaurant_id=p_restaurant AND id<>rec.id AND NOT cancelled AND released_at IS NULL FOR UPDATE;
   IF NOT FOUND OR target.revision<>(mapping->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
   IF rec.published AND NOT target.published OR target.department<>c.department OR c.due<target.starts_at OR c.due>target.ends_at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='closing_covering_shift_denied'; END IF;
   IF target.published AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,target.department,target.starts_at,target.ends_at) OR NOT target.published AND NOT candidate_operations.goal_authorized(actor.id,target.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=target.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
   IF NOT FOUND OR owner_member.id IN (c.manager_id,c.verifier_id) OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_restaurant AND active AND position=c.standard_snapshot->>'position') OR NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=target.id AND standard_id=c.standard_id AND active) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_covering_employee_denied'; END IF;
   IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=target.id AND phase<>'cancelled' AND zone=c.zone) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_zone_conflict'; END IF;
   old_helper:=c.helper_id;
   UPDATE candidate_operations.closes SET shift_id=target.id,shift_revision=target.revision,owner_id=owner_member.id,phase='open',answers='[]',helper_id=NULL,correction=NULL,revision=revision+1 WHERE id=c.id RETURNING * INTO c;
   IF jsonb_array_length(candidate_operations.closing_publication_issues(target.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
   INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note) VALUES(c.id,p_restaurant,c.revision,actor.id,'reassigned',rec.id::text||' -> '||target.id::text);
   INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message) SELECT c.id,p_restaurant,c.revision,id,'Closing work reassigned; complete and submit the work' FROM (SELECT DISTINCT unnest(ARRAY[c.owner_id,c.manager_id,old_helper]) id) recipients WHERE id IS NOT NULL;
  END LOOP;
  updated.cancelled:=true;
 ELSE
  IF NOT input ?& ARRAY['personId','start','end','position','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','start','end','position','note','stationId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_fields'; END IF;
  SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND (active OR schedule_only) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_fields'; END IF;
  updated.member_id:=owner_member.id;updated.department:=owner_member.department;updated.starts_at:=(input->>'start')::timestamptz;updated.ends_at:=(input->>'end')::timestamptz;updated.position:=btrim(input->>'position');
  IF updated.ends_at<=updated.starts_at OR updated.ends_at-updated.starts_at>interval '24 hours' OR length(updated.position) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_duration'; END IF;
  IF NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,updated.department,updated.starts_at,updated.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=updated.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.member_id=owner_member.id AND s.id<>rec.id AND NOT s.cancelled AND s.starts_at<updated.ends_at AND s.ends_at>updated.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_restaurant AND member_id=owner_member.id AND status='approved' AND starts_at<updated.ends_at AND ends_at>updated.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=owner_member.id AND status='approved' AND candidate_operations.availability_period_conflict(data,updated.starts_at,updated.ends_at,scope.timezone)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
  IF input ? 'stationId' THEN updated.station_id:=nullif(input->>'stationId','')::uuid; END IF;
  IF updated.station_id IS DISTINCT FROM rec.station_id AND EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_close_protected'; END IF;
  IF updated.station_id IS NOT NULL THEN
   IF NOT candidate_operations.station_assignment_allowed(updated.station_id,p_restaurant,owner_member.id,updated.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_assignment_denied'; END IF;
   SELECT * INTO station FROM candidate_operations.station_references WHERE id=updated.station_id;
   IF NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) THEN updated.station_name:=station.title;updated.station_revision:=station.revision; END IF;
  ELSE updated.station_name:=NULL;updated.station_revision:=NULL; END IF;
  structural:=ROW(updated.member_id,updated.department,updated.position,updated.starts_at,updated.ends_at) IS DISTINCT FROM ROW(rec.member_id,rec.department,rec.position,rec.starts_at,rec.ends_at);
  IF structural AND EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
  FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled' ORDER BY id FOR UPDATE LOOP
   IF structural AND c.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='completed_close_protected'; END IF;
   IF structural AND (owner_member.id IN (c.manager_id,c.verifier_id) OR owner_member.position='Dishwasher' OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_restaurant AND active AND position=c.standard_snapshot->>'position') OR c.due<updated.starts_at OR c.due>updated.ends_at OR updated.department<>c.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_covering_employee_denied'; END IF;
   old_helper:=c.helper_id;
   UPDATE candidate_operations.closes SET owner_id=owner_member.id,shift_revision=updated.revision,phase=CASE WHEN structural THEN 'open' ELSE phase END,answers=CASE WHEN structural THEN '[]'::jsonb ELSE answers END,helper_id=CASE WHEN structural THEN NULL ELSE helper_id END,correction=CASE WHEN structural THEN NULL ELSE correction END,revision=revision+1 WHERE id=c.id RETURNING * INTO c;
   INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note) VALUES(c.id,p_restaurant,c.revision,actor.id,CASE WHEN structural THEN 'schedule-changed' ELSE 'shift-link-updated' END,note);
   IF structural THEN INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message) SELECT c.id,p_restaurant,c.revision,id,'Closing responsibility changed; complete and submit the work' FROM (SELECT DISTINCT unnest(ARRAY[c.owner_id,c.manager_id,c.verifier_id,old_helper]) id) recipients WHERE id IS NOT NULL; END IF;
  END LOOP;
 END IF;
 INSERT INTO candidate_operations.shift_change_permits VALUES(rec.id,txid_current(),encode(sha256(convert_to(to_jsonb(rec)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(updated)::text,'UTF8')),'hex'));
 UPDATE candidate_operations.shift_references SET member_id=updated.member_id,department=updated.department,position=updated.position,starts_at=updated.starts_at,ends_at=updated.ends_at,station_id=updated.station_id,station_name=updated.station_name,station_revision=updated.station_revision,revision=updated.revision,cancelled=updated.cancelled WHERE id=rec.id RETURNING * INTO updated;
 DELETE FROM candidate_operations.shift_change_permits WHERE shift_id=rec.id;
 IF NOT cancelling THEN
  UPDATE candidate_operations.tasks SET shift_revision=updated.revision WHERE shift_id=rec.id;
  IF jsonb_array_length(candidate_operations.closing_publication_issues(rec.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
  PERFORM candidate_operations.propose_changed_shift_goals(actor.id,p_restaurant,updated.id);
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.schedule_change_events VALUES(updated.id,updated.revision,actor.id,p_payload->>'action',jsonb_build_object('before',to_jsonb(rec),'after',to_jsonb(updated)),note,clock_timestamp());
 IF rec.published THEN INSERT INTO candidate_operations.schedule_change_outbox SELECT updated.id,updated.revision,id,CASE WHEN cancelling THEN 'Shift cancelled' ELSE 'Your schedule changed' END,NULL FROM (SELECT DISTINCT unnest(ARRAY[original_owner,updated.member_id]) id) recipients; END IF;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',updated.id,'revision',updated.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.save_schedule_draft(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
<<draft_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; scope candidate_identity.restaurants; input jsonb; result jsonb;
 creating boolean; first_instant timestamptz; last_instant timestamptz; job text; note text; station candidate_operations.station_references; selected_station uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.save'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_input'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','start','end','position','note','stationId'))
 OR NOT input ?& ARRAY['personId','start','end','position'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_fields'; END IF;
 SELECT * INTO owner FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND (active OR schedule_only) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage')
 OR actor.department<>owner.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR actor.department<>rec.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 creating:=NOT p_payload ? 'recordId';
 IF creating THEN
  IF p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_record'; END IF;
 ELSE
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF actor.department<>rec.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
  IF rec.starts_at<=clock_timestamp() AND (jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='schedule_change_note_required'; END IF;
  -- Only command-created drafts have complete candidate metadata. Imported references remain protected.
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id)
  OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;

 IF jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR length(btrim(input->>'position')) NOT BETWEEN 1 AND 100
 OR input ? 'note' AND (jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note'))>2000)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_text'; END IF;
 job:=btrim(input->>'position'); note:=btrim(coalesce(input->>'note',''));
 selected_station:=CASE WHEN input ? 'stationId' THEN nullif(input->>'stationId','')::uuid ELSE rec.station_id END;
 IF selected_station IS NOT NULL THEN
  IF NOT candidate_operations.station_assignment_allowed(selected_station,p_restaurant,owner.id,job)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_assignment_denied'; END IF;
  SELECT * INTO station FROM candidate_operations.station_references WHERE id=selected_station AND restaurant_id=p_restaurant FOR SHARE;
 END IF;
 IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string'
 OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
 OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_time'; END IF;
 first_instant:=(input->>'start')::timestamptz; last_instant:=(input->>'end')::timestamptz;
 IF last_instant<=first_instant OR last_instant-first_instant>interval '24 hours'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_duration'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=owner.id AND e.active AND e.job=draft_work.job)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND NOT cancelled
 AND id<>coalesce(rec.id,'00000000-0000-0000-0000-000000000000'::uuid) AND starts_at<last_instant AND ends_at>first_instant)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND status='approved' AND starts_at<last_instant AND ends_at>first_instant)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND status='approved'
 AND candidate_operations.availability_period_conflict(data,first_instant,last_instant,scope.timezone))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
 IF creating THEN
  INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published)
  VALUES(gen_random_uuid(),p_restaurant,owner.id,owner.department,job,first_instant,last_instant,1,false) RETURNING * INTO rec;
 ELSE
  UPDATE candidate_operations.shift_references SET member_id=owner.id,department=owner.department,position=job,starts_at=first_instant,ends_at=last_instant,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 UPDATE candidate_operations.shift_references SET station_id=station.id,station_name=station.title,station_revision=station.revision WHERE id=rec.id RETURNING * INTO rec;
 INSERT INTO candidate_operations.schedule_draft_events VALUES(rec.id,rec.revision,actor.id,
  jsonb_build_object('personId',owner.id,'start',first_instant,'end',last_instant,'position',job,'note',note,'published',false,'stationId',station.id,'stationName',station.title,'stationRevision',station.revision),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.offer_issue(p_offer candidate_operations.schedule_offers)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s candidate_operations.shift_references;
BEGIN
 IF p_offer.status NOT IN ('open','pending','accepted-by-replacement') THEN RETURN 'offer_finished'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_offer.shift_id AND restaurant_id=p_offer.restaurant_id;
 IF NOT FOUND OR NOT s.published OR s.cancelled OR s.released_at IS NOT NULL THEN RETURN 'offer_shift_unavailable'; END IF;
 IF s.ends_at<=statement_timestamp() THEN RETURN 'offer_shift_ended'; END IF;
 IF ROW(s.member_id,s.revision,s.position,s.starts_at,s.ends_at,s.department) IS DISTINCT FROM ROW(p_offer.owner_id,p_offer.shift_revision,p_offer.position,p_offer.starts_at,p_offer.ends_at,p_offer.department) THEN RETURN 'offer_shift_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=p_offer.owner_id AND restaurant_id=p_offer.restaurant_id AND active AND NOT schedule_only) THEN RETURN 'offer_owner_inactive'; END IF;
 IF p_offer.mode='coverage' AND s.starts_at<=statement_timestamp() THEN RETURN 'offer_shift_started'; END IF;
 IF candidate_operations.offer_duties(s.id)<>p_offer.duties THEN RETURN 'offer_duties_changed'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c LEFT JOIN candidate_operations.standard_references g ON g.id=c.standard_id AND g.restaurant_id=p_offer.restaurant_id WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND g.status IS DISTINCT FROM 'approved') THEN RETURN 'offer_guide_unavailable'; END IF;
 RETURN '';
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.time_off_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; rec candidate_operations.time_off_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; result jsonb; affected uuid[]; s candidate_operations.shift_references; approve boolean;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('request.create','request.review')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.time_off_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR p_payload->>'action'='request.create' AND rec.member_id<>actor.id
  OR p_payload->>'action'='request.review' AND (rec.member_id=actor.id OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage'
   AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_input'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 IF p_payload->>'action'='request.create' THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR input->>'type' IS DISTINCT FROM 'time-off'
  OR NOT input ?& ARRAY['type','start','end','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('type','start','end','note'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_fields'; END IF;
  IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000
  OR jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string'
  OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
  OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_value'; END IF;
  IF (input->>'end')::timestamptz<=(input->>'start')::timestamptz OR (input->>'end')::timestamptz-(input->>'start')::timestamptz>interval '1440 hours'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_duration'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='schedule.manage'
   WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>actor.id AND (m.department=actor.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage')))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='time_off_reviewer_required'; END IF;
  INSERT INTO candidate_operations.time_off_references(id,restaurant_id,member_id,department,starts_at,ends_at,status,note)
  VALUES(gen_random_uuid(),p_restaurant,actor.id,actor.department,(input->>'start')::timestamptz,(input->>'end')::timestamptz,'pending',btrim(input->>'note')) RETURNING * INTO rec;
 ELSE
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision'] OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$'
  OR NOT input ?& ARRAY['approve','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('approve','note','affectedShifts'))
  OR jsonb_typeof(input->'approve') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_review'; END IF;
  SELECT * INTO rec FROM candidate_operations.time_off_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR rec.member_id=actor.id OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage'
   AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  approve:=(input->>'approve')::boolean;
  IF approve THEN
   IF jsonb_typeof(input->'affectedShifts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'affectedShifts') v WHERE jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['id','revision'])
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_impact'; END IF;
   SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO affected FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at;
   IF cardinality(affected)<>jsonb_array_length(input->'affectedShifts') OR EXISTS(SELECT 1 FROM candidate_operations.shift_references shift_row WHERE shift_row.id=ANY(affected)
    AND (SELECT count(*) FROM jsonb_array_elements(input->'affectedShifts') v WHERE v->>'id'=shift_row.id::text AND v->'revision'=to_jsonb(shift_row.revision))<>1)
   THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   FOR s IN SELECT * FROM candidate_operations.shift_references WHERE id=ANY(affected) ORDER BY id FOR UPDATE LOOP
    IF s.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
    IF s.published OR s.released_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id)
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_cancellation_not_migrated'; END IF;
    UPDATE candidate_operations.shift_references SET cancelled=true,revision=revision+1 WHERE id=s.id RETURNING * INTO s;
    INSERT INTO candidate_operations.schedule_draft_events VALUES(s.id,s.revision,actor.id,jsonb_build_object('personId',s.member_id,'start',s.starts_at,'end',s.ends_at,'position',s.position,'published',false,'cancelled',true,'action','time-off-approved','requestId',rec.id,'note',btrim(input->>'note'),'stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision),clock_timestamp());
   END LOOP;
  END IF;
  UPDATE candidate_operations.time_off_references SET status=CASE WHEN approve THEN 'approved' ELSE 'declined' END,decision=btrim(input->>'note'),revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 INSERT INTO candidate_operations.time_off_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF p_payload->>'action'='request.review' THEN INSERT INTO candidate_operations.time_off_outbox VALUES(rec.id,rec.revision,rec.member_id,'Time off '||rec.status,NULL);
 ELSE
  INSERT INTO candidate_operations.time_off_outbox SELECT rec.id,rec.revision,m.id,'Time-off request review',NULL FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='schedule.manage'
  WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>actor.id AND (m.department=actor.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage'));
 END IF;
 RETURN result;
END;
$function$;

COMMIT;
