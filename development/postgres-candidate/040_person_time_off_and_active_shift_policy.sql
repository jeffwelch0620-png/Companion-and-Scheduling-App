-- Approved scheduling corrections; published 001–039 remain immutable.
BEGIN;
CREATE FUNCTION candidate_operations.person_time_off_conflict(p_member uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships target
 JOIN candidate_identity.memberships peer ON peer.person_id=target.person_id
 JOIN candidate_operations.time_off_references leave_row ON leave_row.member_id=peer.id
 WHERE target.id=p_member AND leave_row.status='approved' AND leave_row.starts_at<p_end AND leave_row.ends_at>p_start);
$body$;
REVOKE ALL ON FUNCTION candidate_operations.person_time_off_conflict(uuid,timestamptz,timestamptz) FROM PUBLIC,candidate_runtime;

-- All leave writers, including administrative imports, coordinate the person's
-- stores. NOWAIT avoids row/store inversion; 40001 requires whole-TX retry.
CREATE FUNCTION candidate_operations.coordinate_person_time_off() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE old_member uuid;new_member uuid;store text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_member:=OLD.member_id; END IF;
 IF TG_OP<>'DELETE' THEN new_member:=NEW.member_id; END IF;
 FOR store IN SELECT DISTINCT m.restaurant_id FROM candidate_identity.memberships m
 WHERE m.person_id IN (SELECT person_id FROM candidate_identity.memberships WHERE id IN (old_member,new_member))
 ORDER BY m.restaurant_id LOOP PERFORM candidate_operations.lock_scope(store,true); END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.coordinate_person_time_off() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER aa_coordinate_person_time_off BEFORE INSERT OR UPDATE OR DELETE ON candidate_operations.time_off_references
 FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_person_time_off();

CREATE TABLE candidate_operations.time_off_shift_flags(
 request_id uuid NOT NULL REFERENCES candidate_operations.time_off_references(id),
 shift_id uuid NOT NULL REFERENCES candidate_operations.shift_references(id),
 restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 shift_revision integer NOT NULL,before_snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(reason IN ('ended_shift','cross_store_review')),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','resolved')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(request_id,shift_id)
);
CREATE TABLE candidate_operations.time_off_conflict_outbox(
 request_id uuid NOT NULL,shift_id uuid NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 message text NOT NULL,delivered_at timestamptz,
 PRIMARY KEY(request_id,shift_id,recipient_id),
 FOREIGN KEY(request_id,shift_id) REFERENCES candidate_operations.time_off_shift_flags(request_id,shift_id)
);
REVOKE ALL ON candidate_operations.time_off_shift_flags,candidate_operations.time_off_conflict_outbox FROM PUBLIC,candidate_runtime;

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
 IF NOT creating AND rec.starts_at<=clock_timestamp() AND (first_instant>rec.starts_at OR last_instant<clock_timestamp())
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='active_shift_time_conflict'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=owner.id AND e.active AND e.job=draft_work.job)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND NOT cancelled
 AND id<>coalesce(rec.id,'00000000-0000-0000-0000-000000000000'::uuid) AND starts_at<last_instant AND ends_at>first_instant)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF candidate_operations.person_time_off_conflict(owner.id,first_instant,last_instant)
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

CREATE OR REPLACE FUNCTION candidate_operations.offer_eligible(p_offer candidate_operations.schedule_offers, p_member uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE m candidate_identity.memberships;s candidate_operations.shift_references;zone text;
BEGIN
 IF candidate_operations.offer_issue(p_offer)<>'' THEN RETURN false; END IF;
 SELECT * INTO m FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_offer.restaurant_id AND active AND NOT schedule_only AND id<>p_offer.owner_id;
 IF NOT FOUND OR p_offer.mode='coverage' AND m.department<>p_offer.department THEN RETURN false; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_offer.shift_id;
 SELECT timezone INTO zone FROM candidate_identity.restaurants WHERE id=p_offer.restaurant_id;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_offer.restaurant_id AND time_off_complete)
 OR NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=m.id AND active AND job=s.position)
 OR s.station_id IS NOT NULL AND NOT candidate_operations.station_assignment_allowed(s.station_id,p_offer.restaurant_id,m.id,s.position)
 OR candidate_operations.person_shift_conflict(m.id,s.starts_at,s.ends_at,s.id)
 OR candidate_operations.person_time_off_conflict(m.id,s.starts_at,s.ends_at)
 OR EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND candidate_operations.availability_period_conflict(data,s.starts_at,s.ends_at,zone)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND (m.position='Dishwasher' OR m.id IN (c.manager_id,c.verifier_id) OR c.due<s.starts_at OR c.due>s.ends_at OR c.department<>m.department OR p_offer.mode='coverage' AND c.standard_snapshot->>'position'<>s.position OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=m.id AND restaurant_id=p_offer.restaurant_id AND active AND position=c.standard_snapshot->>'position'))) THEN RETURN false; END IF;
 RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.publish_shift_core(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb, p_batch boolean, p_week_start timestamp with time zone, p_week_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.shift_references; station candidate_operations.station_references; guide candidate_operations.standard_references;
 scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; goal candidate_operations.employee_goals;
 template jsonb; note text; result jsonb; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_batch AND (p_week_start IS NULL OR p_week_end IS NULL OR p_week_end<=p_week_start) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_period'; END IF;
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object' OR NOT (p_payload->'input') ? 'note'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'input') k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_publication_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
 IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
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
 IF candidate_operations.person_time_off_conflict(rec.member_id,rec.starts_at,rec.ends_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.weekly_review(p_subject text, p_member uuid, p_restaurant text, p_week text, p_selected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; week_start timestamptz; week_end timestamptz; tz text; scope_revision integer; ids uuid[]; snapshot jsonb; needs jsonb; stamp text;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_week IS NULL OR p_week !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(p_week::date,'YYYY-MM-DD')<>p_week OR jsonb_typeof(p_selected) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO ids FROM jsonb_array_elements_text(p_selected);
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_shift_selection'; END IF;
 SELECT timezone,revision INTO tz,scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 week_start:=p_week::date::timestamp AT TIME ZONE tz;week_end:=(p_week::date+7)::timestamp AT TIME ZONE tz;
 IF EXISTS(SELECT 1 FROM unnest(ids) AS sel(shift_id) WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=sel.shift_id AND s.restaurant_id=p_restaurant AND NOT s.published AND NOT s.cancelled AND s.released_at IS NULL AND s.ends_at>statement_timestamp() AND s.starts_at>=week_start AND s.starts_at<week_end AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
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
 'timeOff',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM candidate_operations.time_off_references t JOIN candidate_identity.memberships peer ON peer.id=t.member_id WHERE EXISTS(SELECT 1 FROM candidate_identity.memberships local_member WHERE local_member.restaurant_id=p_restaurant AND local_member.person_id=peer.person_id)),
 'closes',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM candidate_operations.closes c WHERE c.restaurant_id=p_restaurant),
 'standards',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.standard_references s WHERE s.restaurant_id=p_restaurant),
 'leadership',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM candidate_operations.leadership_references l WHERE l.restaurant_id=p_restaurant)) INTO snapshot;
 stamp:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 WITH planned AS (
 SELECT s.* FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id WHERE s.restaurant_id=p_restaurant AND NOT s.cancelled AND (s.published OR s.id=ANY(ids)) AND s.starts_at<week_end AND s.ends_at>week_start
 AND m.department=s.department AND (m.active OR m.schedule_only) AND candidate_operations.schedule_plan_allowed(actor.id,s.department)
 AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND e.job=s.position)
 AND (s.station_id IS NULL OR candidate_operations.station_assignment_allowed(s.station_id,p_restaurant,m.id,s.position))
 AND NOT candidate_operations.person_time_off_conflict(m.id,s.starts_at,s.ends_at)
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
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_shifts(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after) AND (s.published OR s.ends_at>statement_timestamp())
  AND (
   (caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)))
   OR s.published AND (s.member_id=actor.id
    OR actor.position<>'Dishwasher' AND ('location.manage'=ANY(caps) OR 'people.manage'=ANY(caps) AND actor.department=s.department)
    OR 'close.confirm'=ANY(caps) AND (actor.department=s.department OR 'location.manage'=ANY(caps)
      OR actor.position<>'Dishwasher' AND 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND s.department IN ('FOH','BOH')))
  ) ORDER BY s.id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','shift','locationId',s.restaurant_id,'area',s.department,'ownerId',s.member_id,'revision',s.revision,
  'data',jsonb_build_object('personId',s.member_id,'position',s.position,'start',s.starts_at,'end',s.ends_at,'published',s.published,'cancelled',s.cancelled,'releasedAt',s.released_at)||CASE WHEN s.station_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision) END||CASE WHEN caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) AND EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending') THEN jsonb_build_object('reviewFlags',(SELECT jsonb_agg(jsonb_build_object('reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.request_id) FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending')) ELSE '{}'::jsonb END) ORDER BY s.id),'[]')
 INTO items FROM candidate_operations.shift_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','shift-references-only');
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.schedule_consent_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships;rec candidate_operations.schedule_offers;s candidate_operations.shift_references;scope candidate_identity.restaurants;receipt candidate_operations.command_receipts;input jsonb;action text;creating boolean;target uuid;reason text;result jsonb;child_result jsonb;event_note text;recipients uuid[];
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 action:=p_payload->>'action';input:=p_payload->'input';creating:=action IN ('coverage.create','request.create');
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve','request.create','request.consent','request.review') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 IF NOT creating THEN
  SELECT * INTO rec FROM candidate_operations.schedule_offers WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR action LIKE 'coverage.%' AND rec.mode<>'coverage' OR action LIKE 'request.%' AND rec.mode<>'swap' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='offer_denied'; END IF;
  IF action='coverage.withdraw' AND actor.id<>rec.owner_id OR action='request.consent' AND actor.id<>rec.replacement_id OR action IN ('coverage.approve','request.review') AND (actor.id IN (rec.owner_id,rec.replacement_id) OR NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF action='coverage.approve' AND (input->>'personId')::uuid=actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='independent_reviewer_required'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF creating AND NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE id=(receipt.result->>'recordId')::uuid AND owner_id=actor.id AND restaurant_id=p_restaurant) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='offer_denied'; END IF;
  IF action IN ('coverage.volunteer','coverage.withdraw-volunteer') AND actor.id=rec.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF (action='coverage.approve' OR action='request.review' AND input->'approve'='true'::jsonb) AND NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.id=CASE WHEN action='coverage.approve' THEN (input->>'personId')::uuid ELSE rec.replacement_id END AND m.restaurant_id=p_restaurant AND candidate_operations.published_change_allowed(actor.id,p_restaurant,m.department,rec.starts_at,rec.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 event_note:=coalesce(input->>'note','');
 IF jsonb_typeof(input->'note') IS NOT NULL AND jsonb_typeof(input->'note')<>'string' OR length(event_note)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_note'; END IF;
 IF creating THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('shiftId','shiftRevision','note','type','start','end','replacementId')) OR NOT input ? 'shiftId' OR action='request.create' AND (input->>'type' IS DISTINCT FROM 'swap' OR NOT input ?& ARRAY['replacementId','start','end','note']) OR action='coverage.create' AND NOT input ? 'shiftRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
  SELECT * INTO s FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant AND member_id=actor.id AND published AND NOT cancelled AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF input ? 'shiftRevision' AND (jsonb_typeof(input->'shiftRevision') IS DISTINCT FROM 'number' OR input->>'shiftRevision' !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF input ? 'shiftRevision' AND (input->>'shiftRevision')::integer<>s.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF action='request.create' THEN
   IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string' OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_period'; END IF;
   IF (input->>'end')::timestamptz<=(input->>'start')::timestamptz OR (input->>'end')::timestamptz-(input->>'start')::timestamptz>interval '60 days' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_period'; END IF;
   IF length(btrim(event_note))=0 OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id NOT IN (actor.id,(input->>'replacementId')::uuid) AND candidate_operations.published_change_allowed(m.id,p_restaurant,s.department,s.starts_at,s.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='swap_reviewer_required'; END IF;
  END IF;
  PERFORM candidate_operations.invalidate_schedule_offers(p_restaurant);
  IF action='coverage.create' AND EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE shift_id=s.id AND mode='coverage' AND status='open') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='coverage_offer_exists'; END IF;
  INSERT INTO candidate_operations.schedule_offers(restaurant_id,owner_id,department,mode,shift_id,shift_revision,position,starts_at,ends_at,duties,note,status,replacement_id) VALUES(p_restaurant,actor.id,s.department,CASE WHEN action='coverage.create' THEN 'coverage' ELSE 'swap' END,s.id,s.revision,s.position,s.starts_at,s.ends_at,candidate_operations.offer_duties(s.id),btrim(event_note),CASE WHEN action='coverage.create' THEN 'open' ELSE 'pending' END,CASE WHEN action='request.create' THEN (input->>'replacementId')::uuid END) RETURNING * INTO rec;
  reason:=candidate_operations.offer_issue(rec);
  IF reason='offer_shift_ended' OR s.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
  IF reason<>'' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='offer_changed'; END IF;
  IF rec.mode='swap' AND NOT candidate_operations.offer_eligible(rec,rec.replacement_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='replacement_ineligible'; END IF;
 ELSE
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.status NOT IN ('open','pending','accepted-by-replacement') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF action='coverage.withdraw-volunteer' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(input)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=actor.id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_missing'; END IF;
   SELECT coalesce(jsonb_agg(v),'[]') INTO rec.volunteers FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'<>actor.id::text;
  ELSIF action='coverage.withdraw' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
   rec.status:='withdrawn';
  ELSE
   reason:=candidate_operations.offer_issue(rec);
   IF reason='offer_shift_ended' OR rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
   IF reason<>'' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='offer_changed'; END IF;
   IF action='coverage.volunteer' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'confirmed') OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='consent_confirmation_required'; END IF;
    IF NOT candidate_operations.offer_eligible(rec,actor.id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='replacement_ineligible'; END IF;
    IF jsonb_array_length(rec.volunteers)>=100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=actor.id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_conflict'; END IF;
    rec.volunteers:=rec.volunteers||jsonb_build_array(jsonb_build_object('personId',actor.id,'at',clock_timestamp()));
   ELSIF action='request.consent' THEN
    IF rec.status<>'pending' OR jsonb_typeof(input->'accept') IS DISTINCT FROM 'boolean' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'accept') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_consent'; END IF;
    rec.status:=CASE WHEN (input->>'accept')::boolean THEN 'accepted-by-replacement' ELSE 'declined' END;
    IF rec.status='declined' THEN rec.decision:='Replacement declined'; END IF;
   ELSE
    IF action='coverage.approve' THEN
     IF NOT input ?& ARRAY['personId','confirmed','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','confirmed','note')) OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='consent_confirmation_required'; END IF;
     target:=(input->>'personId')::uuid;
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=target::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_missing'; END IF;
    ELSE
     IF NOT input ?& ARRAY['approve','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('approve','note')) OR jsonb_typeof(input->'approve') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_review'; END IF;
     target:=rec.replacement_id;
     IF (input->>'approve')::boolean AND rec.status<>'accepted-by-replacement' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replacement_consent_required'; END IF;
    END IF;
    IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(event_note))=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_note'; END IF;
    rec.decision:=btrim(event_note);
    IF action='request.review' AND NOT (input->>'approve')::boolean THEN rec.status:='declined'; ELSE
     IF target=actor.id OR target=rec.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='independent_reviewer_required'; END IF;
     IF NOT candidate_operations.offer_eligible(rec,target) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replacement_no_longer_eligible'; END IF;
     SELECT * INTO s FROM candidate_operations.shift_references WHERE id=rec.shift_id FOR UPDATE;
     -- Close this offer before shared shift/closing triggers inspect the changed assignment.
     UPDATE candidate_operations.schedule_offers SET status='approved' WHERE id=rec.id;
     child_result:=candidate_operations.change_schedule(p_subject,p_member,p_restaurant,md5('consent:'||p_request::text)::uuid,jsonb_build_object('action','shift.save','recordId',s.id,'expectedRevision',s.revision,'input',jsonb_build_object('personId',target,'start',s.starts_at,'end',s.ends_at,'position',s.position,'note',rec.decision)));
     rec.status:='approved';rec.selected_id:=target;
    END IF;
   END IF;
  END IF;
  UPDATE candidate_operations.schedule_offers SET status=rec.status,selected_id=rec.selected_id,decision=rec.decision,volunteers=rec.volunteers,revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.schedule_offer_events VALUES(rec.id,rec.revision,actor.id,action,event_note,to_jsonb(rec),rec.updated_at);
 IF creating AND rec.mode='swap' THEN recipients:=ARRAY[rec.replacement_id];
 ELSE
  SELECT array_agg(DISTINCT id) INTO recipients FROM (
   SELECT rec.owner_id id UNION SELECT rec.replacement_id UNION SELECT rec.selected_id UNION SELECT (v->>'personId')::uuid FROM jsonb_array_elements(rec.volunteers) v
   UNION SELECT m.id FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>rec.owner_id AND m.id IS DISTINCT FROM target AND candidate_operations.published_change_allowed(m.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at)
   UNION SELECT m.id FROM candidate_identity.memberships m WHERE creating AND rec.mode='coverage' AND m.restaurant_id=p_restaurant AND candidate_operations.offer_eligible(rec,m.id)
  ) targets WHERE id IS NOT NULL;
 END IF;
 INSERT INTO candidate_operations.schedule_offer_outbox SELECT rec.id,rec.revision,id,'Schedule consent: '||action,NULL FROM unnest(recipients) id;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING * INTO scope;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 IF child_result IS NOT NULL THEN result:=result||jsonb_build_object('shift',child_result); END IF;
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.time_off_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; rec candidate_operations.time_off_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; result jsonb; affected uuid[]; s candidate_operations.shift_references; approve boolean; flagged jsonb:='[]';
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
   PERFORM candidate_operations.lock_scope(m.restaurant_id,true) FROM candidate_identity.memberships m
    WHERE m.person_id=(SELECT person_id FROM candidate_identity.memberships WHERE id=rec.member_id) ORDER BY m.restaurant_id;
   IF jsonb_typeof(input->'affectedShifts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'affectedShifts') v WHERE jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['id','revision'])
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_impact'; END IF;
   SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO affected FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at;
   IF cardinality(affected)<>jsonb_array_length(input->'affectedShifts') OR EXISTS(SELECT 1 FROM candidate_operations.shift_references shift_row WHERE shift_row.id=ANY(affected)
    AND (SELECT count(*) FROM jsonb_array_elements(input->'affectedShifts') v WHERE v->>'id'=shift_row.id::text AND v->'revision'=to_jsonb(shift_row.revision))<>1)
   THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   FOR s IN SELECT * FROM candidate_operations.shift_references WHERE id=ANY(affected) ORDER BY id FOR UPDATE LOOP
    IF s.ends_at<=clock_timestamp() THEN
     INSERT INTO candidate_operations.time_off_shift_flags(request_id,shift_id,restaurant_id,shift_revision,before_snapshot,reason)
      VALUES(rec.id,s.id,s.restaurant_id,s.revision,to_jsonb(s),'ended_shift');
     flagged:=flagged||jsonb_build_array(jsonb_build_object('id',s.id,'revision',s.revision,'reason','ended_shift','reviewStatus','pending'));
     CONTINUE;
    END IF;
    IF s.published OR s.released_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id)
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_cancellation_not_migrated'; END IF;
    UPDATE candidate_operations.shift_references SET cancelled=true,revision=revision+1 WHERE id=s.id RETURNING * INTO s;
    INSERT INTO candidate_operations.schedule_draft_events VALUES(s.id,s.revision,actor.id,jsonb_build_object('personId',s.member_id,'start',s.starts_at,'end',s.ends_at,'position',s.position,'published',false,'cancelled',true,'action','time-off-approved','requestId',rec.id,'note',btrim(input->>'note'),'stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision),clock_timestamp());
   END LOOP;
  END IF;
  IF approve THEN
   FOR s IN SELECT shift_row.* FROM candidate_operations.shift_references shift_row JOIN candidate_identity.memberships peer ON peer.id=shift_row.member_id
    WHERE peer.person_id=(SELECT person_id FROM candidate_identity.memberships WHERE id=rec.member_id)
     AND shift_row.restaurant_id<>p_restaurant AND NOT shift_row.cancelled AND shift_row.starts_at<rec.ends_at AND shift_row.ends_at>rec.starts_at ORDER BY shift_row.id LOOP
    INSERT INTO candidate_operations.time_off_shift_flags(request_id,shift_id,restaurant_id,shift_revision,before_snapshot,reason)
     VALUES(rec.id,s.id,s.restaurant_id,s.revision,to_jsonb(s),'cross_store_review');
   END LOOP;
  END IF;
  UPDATE candidate_operations.time_off_references SET status=CASE WHEN approve THEN 'approved' ELSE 'declined' END,decision=btrim(input->>'note'),revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 INSERT INTO candidate_operations.time_off_conflict_outbox
 SELECT flag.request_id,flag.shift_id,m.id,'Approved leave overlaps scheduled work; manager review required',NULL
 FROM candidate_operations.time_off_shift_flags flag JOIN candidate_identity.memberships m ON m.restaurant_id=flag.restaurant_id
 WHERE flag.request_id=rec.id AND m.active AND NOT m.schedule_only
 AND EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities cap WHERE cap.membership_id=m.id AND cap.active AND cap.capability IN ('schedule.manage','schedule.publish'))
 AND candidate_operations.goal_authorized(m.id,flag.before_snapshot->>'department','schedule.manage')
 ON CONFLICT DO NOTHING;
 INSERT INTO candidate_operations.time_off_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 result:=result||jsonb_build_object('flaggedShifts',flagged);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF p_payload->>'action'='request.review' THEN INSERT INTO candidate_operations.time_off_outbox VALUES(rec.id,rec.revision,rec.member_id,'Time off '||rec.status,NULL);
 ELSE
  INSERT INTO candidate_operations.time_off_outbox SELECT rec.id,rec.revision,m.id,'Time-off request review',NULL FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='schedule.manage'
  WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>actor.id AND (m.department=actor.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage'));
 END IF;
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.list_time_off(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; scope candidate_identity.restaurants; next_cursor uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT r.id FROM candidate_operations.time_off_references r WHERE r.restaurant_id=p_restaurant AND (p_after IS NULL OR r.id>p_after)
 AND (r.member_id=actor.id OR (actor.department=r.department OR 'location.manage'=ANY(caps)) AND (caps&&ARRAY['schedule.manage','schedule.change'] OR r.status='approved' AND 'schedule.publish'=ANY(caps))) ORDER BY r.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind','request','locationId',r.restaurant_id,'ownerId',r.member_id,'area',r.department,'revision',r.revision,'updatedAt',r.updated_at,
  'data',jsonb_build_object('type','time-off','start',r.starts_at,'end',r.ends_at,'status',r.status,
   'note',CASE WHEN 'schedule.change'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN r.note ELSE '' END,
   'decision',CASE WHEN 'schedule.change'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN r.decision ELSE NULL END),
  'flaggedShifts',CASE WHEN 'schedule.manage'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.shift_id,'revision',f.shift_revision,'reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.shift_id),'[]') FROM candidate_operations.time_off_shift_flags f WHERE f.request_id=r.id AND f.restaurant_id=p_restaurant) ELSE NULL END,
  'affectedShifts',CASE WHEN 'schedule.manage'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision) ORDER BY s.starts_at,s.id),'[]') FROM candidate_operations.shift_references s WHERE s.restaurant_id=r.restaurant_id AND s.member_id=r.member_id AND NOT s.cancelled AND s.starts_at<r.ends_at AND s.ends_at>r.starts_at) ELSE NULL END) ORDER BY r.id),'[]') INTO items FROM candidate_operations.time_off_references r WHERE r.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','time-off-only');
END;
$function$;

COMMIT;
