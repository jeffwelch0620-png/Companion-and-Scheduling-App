-- Candidate scheduling references only; no training clearance or station setup commands.
BEGIN;
CREATE FUNCTION candidate_operations.dish_only_label(p_label text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT btrim(p_label) ~* '^(dish|dish\s*washer)(\s*(\((am|pm|morning|evening|night)\)|am|pm))?$';
$body$;
CREATE TABLE candidate_operations.station_references(
 id uuid PRIMARY KEY,restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),department text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 150),revision integer NOT NULL CHECK(revision>0),
 status text NOT NULL CHECK(status IN ('active','archived')),configured boolean NOT NULL DEFAULT false,
 all_job_members boolean NOT NULL DEFAULT false,UNIQUE(id,restaurant_id)
);
CREATE TABLE candidate_operations.station_jobs(
 station_id uuid NOT NULL REFERENCES candidate_operations.station_references(id),job text NOT NULL,
 CHECK(length(btrim(job)) BETWEEN 1 AND 100 AND job=btrim(job) AND NOT candidate_operations.dish_only_label(job)),PRIMARY KEY(station_id,job)
);
CREATE TABLE candidate_operations.station_members(
 station_id uuid NOT NULL,member_id uuid NOT NULL,restaurant_id text NOT NULL,PRIMARY KEY(station_id,member_id),
 FOREIGN KEY(station_id,restaurant_id) REFERENCES candidate_operations.station_references(id,restaurant_id),
 FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
ALTER TABLE candidate_operations.shift_references ADD COLUMN station_id uuid,ADD COLUMN station_name text,ADD COLUMN station_revision integer,
 ADD FOREIGN KEY(station_id,restaurant_id) REFERENCES candidate_operations.station_references(id,restaurant_id),
 ADD CHECK((station_id IS NULL AND station_name IS NULL AND station_revision IS NULL) OR (station_id IS NOT NULL AND station_name IS NOT NULL AND station_revision IS NOT NULL AND station_revision>0));
REVOKE ALL ON candidate_operations.station_references,candidate_operations.station_jobs,candidate_operations.station_members FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.station_assignment_allowed(p_station uuid,p_restaurant text,p_member uuid,p_job text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.station_references s JOIN candidate_identity.memberships m ON m.id=p_member AND m.restaurant_id=s.restaurant_id AND m.department=s.department
 WHERE s.id=p_station AND s.restaurant_id=p_restaurant AND s.status='active' AND s.configured AND (m.active OR m.schedule_only)
 AND NOT candidate_operations.dish_only_label(m.position) AND NOT candidate_operations.dish_only_label(p_job)
 AND EXISTS(SELECT 1 FROM candidate_operations.station_jobs j WHERE j.station_id=s.id AND j.job=p_job)
 AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND e.job=p_job)
 AND (s.all_job_members OR EXISTS(SELECT 1 FROM candidate_operations.station_members sm WHERE sm.station_id=s.id AND sm.member_id=m.id)));
$body$;
CREATE FUNCTION candidate_operations.protect_station_shift() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
 IF ROW(NEW.station_id,NEW.station_name,NEW.station_revision) IS DISTINCT FROM ROW(OLD.station_id,OLD.station_name,OLD.station_revision)
 AND (EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=OLD.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=OLD.id))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
 RETURN NEW;
END;
$body$;
CREATE TRIGGER protect_station_shift BEFORE UPDATE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.protect_station_shift();
REVOKE ALL ON FUNCTION candidate_operations.dish_only_label(text),candidate_operations.station_assignment_allowed(uuid,text,uuid,text),candidate_operations.protect_station_shift() FROM PUBLIC,candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.save_schedule_draft(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
<<draft_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; scope candidate_identity.restaurants; input jsonb; result jsonb;
 creating boolean; first_instant timestamptz; last_instant timestamptz; job text; note text; station candidate_operations.station_references; selected_station uuid;
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
$body$;
REVOKE ALL ON FUNCTION candidate_operations.save_schedule_draft(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.save_schedule_draft(text,uuid,text,uuid,jsonb) TO candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_shifts(
 p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after)
  AND (
   (caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)))
   OR s.published AND (s.member_id=actor.id
    OR actor.position<>'Dishwasher' AND ('location.manage'=ANY(caps) OR 'people.manage'=ANY(caps) AND actor.department=s.department)
    OR 'close.confirm'=ANY(caps) AND (actor.department=s.department OR 'location.manage'=ANY(caps)
      OR actor.position<>'Dishwasher' AND 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND s.department IN ('FOH','BOH')))
  ) ORDER BY s.id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','shift','locationId',s.restaurant_id,'area',s.department,'ownerId',s.member_id,'revision',s.revision,
  'data',jsonb_build_object('personId',s.member_id,'position',s.position,'start',s.starts_at,'end',s.ends_at,'published',s.published,'cancelled',s.cancelled,'releasedAt',s.released_at)||CASE WHEN s.station_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision) END) ORDER BY s.id),'[]')
 INTO items FROM candidate_operations.shift_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','shift-references-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_shifts(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_shifts(text,uuid,text,uuid,integer) TO candidate_runtime;
CREATE FUNCTION candidate_operations.list_schedule_stations(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT s.id FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after)
 AND caps&&ARRAY['schedule.manage','schedule.change','schedule.publish'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) ORDER BY s.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','station','locationId',s.restaurant_id,'area',s.department,'revision',s.revision,
 'data',jsonb_build_object('title',s.title,'status',s.status,'setup',CASE WHEN NOT s.configured THEN NULL ELSE jsonb_build_object('allJobMembers',s.all_job_members,
 'jobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_operations.station_jobs WHERE station_id=s.id),
 'memberIds',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=s.id)) END)) ORDER BY s.id),'[]') INTO items FROM candidate_operations.station_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','station-scheduling-references-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_stations(text,uuid,text,uuid,integer) TO candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.time_off_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; rec candidate_operations.time_off_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; result jsonb; affected uuid[]; s candidate_operations.shift_references; approve boolean;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('request.create','request.review')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
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
$body$;
REVOKE ALL ON FUNCTION candidate_operations.time_off_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.time_off_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
