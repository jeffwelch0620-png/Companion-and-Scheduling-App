-- Candidate only. Station-free drafts; no publishing or imported-shift editing.
BEGIN;
CREATE TABLE candidate_operations.schedule_input_reviews(
 restaurant_id text PRIMARY KEY REFERENCES candidate_identity.restaurants(id),
 time_off_complete boolean NOT NULL DEFAULT false,
 reviewed_at timestamptz, CHECK(NOT time_off_complete OR reviewed_at IS NOT NULL)
);
CREATE TABLE candidate_operations.time_off_references(
 id uuid PRIMARY KEY,restaurant_id text NOT NULL,member_id uuid NOT NULL,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved','declined')),
 CHECK(ends_at>starts_at),FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.schedule_draft_events(
 shift_id uuid NOT NULL REFERENCES candidate_operations.shift_references(id),revision integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),data jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(shift_id,revision)
);
REVOKE ALL ON candidate_operations.schedule_input_reviews,candidate_operations.time_off_references,candidate_operations.schedule_draft_events FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.save_schedule_draft(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
<<draft_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; scope candidate_identity.restaurants; input jsonb; result jsonb;
 creating boolean; first_instant timestamptz; last_instant timestamptz; job text; note text;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.save'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
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
  -- Only command-created drafts have complete candidate metadata. Imported references remain protected.
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id)
  OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 IF input ? 'stationId' AND input->'stationId'<>'null'::jsonb AND input->>'stationId'<>''
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_assignment_not_migrated'; END IF;
 IF jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR length(btrim(input->>'position')) NOT BETWEEN 1 AND 100
 OR input ? 'note' AND (jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note'))>2000)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_text'; END IF;
 job:=btrim(input->>'position'); note:=btrim(coalesce(input->>'note',''));
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
 INSERT INTO candidate_operations.schedule_draft_events VALUES(rec.id,rec.revision,actor.id,
  jsonb_build_object('personId',owner.id,'start',first_instant,'end',last_instant,'position',job,'note',note,'published',false),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.save_schedule_draft(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.save_schedule_draft(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
