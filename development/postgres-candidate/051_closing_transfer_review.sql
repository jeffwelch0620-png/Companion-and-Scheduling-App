-- Candidate-only read review; shared guard used again inside the coordinated command.
BEGIN;
CREATE FUNCTION candidate_operations.closing_transfer_issue(p_actor uuid,p_close candidate_operations.closes,p_target candidate_operations.shift_references,p_published boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $function$
DECLARE owner_member candidate_identity.memberships; standard candidate_operations.standard_references;
BEGIN
 IF p_target.id IS NULL OR p_target.restaurant_id<>p_close.restaurant_id OR p_target.id=p_close.shift_id OR p_target.cancelled OR p_target.released_at IS NOT NULL
  OR p_published AND NOT p_target.published OR p_target.department<>p_close.department OR p_close.due<p_target.starts_at OR p_close.due>p_target.ends_at THEN RETURN 'closing_covering_shift_denied'; END IF;
 IF p_target.published AND NOT candidate_operations.published_change_allowed(p_actor,p_close.restaurant_id,p_target.department,p_target.starts_at,p_target.ends_at)
  OR NOT p_target.published AND NOT candidate_operations.goal_authorized(p_actor,p_target.department,'schedule.manage') THEN RETURN 'action_denied'; END IF;
 SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=p_target.member_id AND restaurant_id=p_close.restaurant_id AND active AND NOT schedule_only AND NOT candidate_operations.is_dish_position(p_close.restaurant_id,position);
 IF NOT FOUND OR owner_member.id IN (p_close.manager_id,p_close.verifier_id)
  OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_close.restaurant_id AND active AND position=p_close.standard_snapshot->>'position')
  OR NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=p_target.id AND standard_id=p_close.standard_id AND active) THEN RETURN 'closing_covering_employee_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=p_target.id AND phase<>'cancelled' AND zone=p_close.zone) THEN RETURN 'closing_zone_conflict'; END IF;
 SELECT * INTO standard FROM candidate_operations.standard_references WHERE id=p_close.standard_id AND restaurant_id=p_close.restaurant_id;
 IF NOT FOUND OR standard.status<>'approved' OR standard.revision<>p_close.standard_revision
  OR p_target.station_id IS NULL AND standard.position IS DISTINCT FROM p_target.position
  OR p_target.station_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_operations.station_references t WHERE t.id=p_target.station_id AND t.status='active' AND (t.setup_data->'standardIds' @> to_jsonb(ARRAY[p_close.standard_id::text]) OR lower(btrim(standard.position))=lower(btrim(t.title))))
  OR NOT candidate_operations.closing_manager_read(p_close.manager_id,p_close.restaurant_id,p_target.department,'close.confirm')
  OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=p_close.manager_id AND capability='location.manage' AND active) AND NOT EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE member_id=p_close.manager_id AND restaurant_id=p_close.restaurant_id AND department=p_target.department AND active AND starts_at<=p_close.due AND ends_at>=p_close.due)
  OR p_close.standard_snapshot->>'verification'='senior-then-manager' AND (p_close.verifier_id IS NULL OR p_close.verifier_id IN (p_target.member_id,p_close.manager_id) OR NOT candidate_operations.closing_manager_read(p_close.verifier_id,p_close.restaurant_id,p_target.department,'close.verify'))
  OR jsonb_array_length(candidate_operations.closing_publication_issues_read(p_target.id,p_close.restaurant_id))>0 THEN RETURN 'closing_publication_review_required'; END IF;
 RETURN '';
END;
$function$;
REVOKE ALL ON FUNCTION candidate_operations.closing_transfer_issue(uuid,candidate_operations.closes,candidate_operations.shift_references,boolean) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.read_shift_cancellation_review(p_subject text,p_member uuid,p_restaurant text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor candidate_identity.memberships; s candidate_operations.shift_references; c candidate_operations.closes; scope_revision integer; closings jsonb:='[]'; choices jsonb; pending_tasks boolean; count_closing integer;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant AND published;
 IF NOT FOUND OR NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,s.department,s.starts_at,s.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 IF s.cancelled OR s.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 IF s.ends_at<=statement_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT count(*)::integer INTO count_closing FROM candidate_operations.closes WHERE shift_id=s.id AND phase NOT IN ('closed','cancelled');
 IF count_closing>100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='closing_selection_limit'; END IF;
 pending_tasks:=EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id AND phase<>'closed');
 FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=s.id AND phase NOT IN ('closed','cancelled') ORDER BY id LOOP
  -- Hold a task-blocked review without exposing choices that cannot be submitted.
  SELECT coalesce(jsonb_agg(jsonb_build_object('shiftId',t.id,'revision',t.revision,'ownerId',t.member_id,'ownerName',p.name,'start',t.starts_at,'end',t.ends_at,'position',t.position,'area',t.department) ORDER BY t.starts_at,t.id),'[]') INTO choices
  FROM (SELECT t.* FROM candidate_operations.shift_references t WHERE NOT pending_tasks AND t.restaurant_id=p_restaurant AND t.id<>s.id AND t.published AND NOT t.cancelled AND t.released_at IS NULL AND t.department=c.department AND t.starts_at<=c.due AND t.ends_at>=c.due AND candidate_operations.closing_transfer_issue(actor.id,c,t,true)='' ORDER BY t.starts_at,t.id LIMIT 101) t
  JOIN candidate_identity.memberships m ON m.id=t.member_id JOIN candidate_identity.people p ON p.id=m.person_id;
  closings:=closings||jsonb_build_array(jsonb_build_object('id',c.id,'revision',c.revision,'zone',c.zone,'due',c.due,'phase',c.phase,'ownerId',c.owner_id,
   'standard',jsonb_build_object('id',c.standard_id,'title',c.standard_snapshot->>'title','version',c.standard_snapshot->'version','position',c.standard_snapshot->>'position'),
   'optionsTruncated',jsonb_array_length(choices)>100,'options',CASE WHEN jsonb_array_length(choices)>100 THEN choices - 100 ELSE choices END));
 END LOOP;
 RETURN jsonb_build_object('locationId',p_restaurant,'actorId',actor.id,'shiftId',s.id,'revision',s.revision,'workspaceRevision',scope_revision,'closing',closings,'canCancel',NOT pending_tasks,'blockedReason',CASE WHEN pending_tasks THEN 'linked_task_pending' ELSE '' END);
END;
$function$;
REVOKE ALL ON FUNCTION candidate_operations.read_shift_cancellation_review(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.read_shift_cancellation_review(text,uuid,text,uuid) TO candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.change_schedule(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; rec candidate_operations.shift_references; updated candidate_operations.shift_references; target candidate_operations.shift_references; station candidate_operations.station_references; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 c candidate_operations.closes; mapping jsonb; input jsonb; result jsonb; cancelling boolean; structural boolean; note text; original_owner uuid; old_helper uuid; transfer_issue text;
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
   SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=target.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND NOT candidate_operations.is_dish_position(p_restaurant,position) FOR SHARE;
   transfer_issue:=candidate_operations.closing_transfer_issue(actor.id,c,target,rec.published);
   IF transfer_issue<>'' THEN RAISE EXCEPTION USING ERRCODE=CASE WHEN transfer_issue='closing_covering_shift_denied' THEN '22023' WHEN transfer_issue IN ('action_denied','closing_covering_employee_denied') THEN '42501' ELSE 'P0001' END,MESSAGE=transfer_issue; END IF;
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
  IF rec.starts_at<=clock_timestamp() AND (updated.starts_at>rec.starts_at OR updated.ends_at<clock_timestamp())
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='active_shift_time_conflict'; END IF;
  IF NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,updated.department,updated.starts_at,updated.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=updated.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.member_id=owner_member.id AND s.id<>rec.id AND NOT s.cancelled AND s.starts_at<updated.ends_at AND s.ends_at>updated.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
  IF candidate_operations.person_time_off_conflict(owner_member.id,updated.starts_at,updated.ends_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
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
   IF structural AND (owner_member.id IN (c.manager_id,c.verifier_id) OR candidate_operations.is_dish_position(owner_member.restaurant_id,owner_member.position) OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_restaurant AND active AND position=c.standard_snapshot->>'position') OR c.due<updated.starts_at OR c.due>updated.ends_at OR updated.department<>c.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_covering_employee_denied'; END IF;
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
COMMIT;
