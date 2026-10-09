-- Candidate only. Availability writes do not publish or edit shifts.
BEGIN;
CREATE TABLE candidate_operations.availability_events(
 availability_id uuid NOT NULL REFERENCES candidate_operations.availability_references(id),
 revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 action text NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(availability_id,revision)
);
CREATE TABLE candidate_operations.availability_outbox(
 availability_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 message text NOT NULL,delivered_at timestamptz,PRIMARY KEY(availability_id,revision,recipient_id),
 FOREIGN KEY(availability_id,revision) REFERENCES candidate_operations.availability_events(availability_id,revision)
);
REVOKE ALL ON candidate_operations.availability_events,candidate_operations.availability_outbox FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.availability_period_conflict(p_data jsonb,p_start timestamptz,p_end timestamptz,p_timezone text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT 1 FROM generate_series(date_trunc('minute',p_start),p_end-interval '1 microsecond',interval '1 minute') t
 CROSS JOIN LATERAL (SELECT t AT TIME ZONE p_timezone AS wall) w CROSS JOIN generate_series(-1,1) offset_day
 CROSS JOIN LATERAL (SELECT wall::date+offset_day AS anchor,
  extract(hour FROM wall)::integer*60+extract(minute FROM wall)::integer-offset_day*1440 AS minute) a
 WHERE anchor BETWEEN (p_data->>'startDate')::date AND (p_data->>'endDate')::date
 AND p_data->'days' @> jsonb_build_array(extract(dow FROM anchor)::integer)
 AND NOT coalesce(p_data->'excludedDates','[]') @> to_jsonb(ARRAY[anchor::text])
 AND minute >= (p_data->>'startMinute')::integer-(p_data->>'beforeMinutes')::integer
 AND minute < (p_data->>'endMinute')::integer+(p_data->>'afterMinutes')::integer);
$body$;
REVOKE ALL ON FUNCTION candidate_operations.availability_period_conflict(jsonb,timestamptz,timestamptz,text) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.availability_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
<<availability_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.availability_references;
 old candidate_operations.availability_references; receipt candidate_operations.command_receipts; scope candidate_identity.restaurants;
 input jsonb; data jsonb; result jsonb; creating boolean; approve boolean; first_date date; last_date date; note text; n integer; key text;
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' NOT IN ('availability.save','availability.review')
 OR p_payload->>'action' IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.availability_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR (p_payload->>'action'='availability.review' OR rec.member_id<>actor.id) AND NOT EXISTS(
   SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=actor.id AND c.active AND c.capability='schedule.manage'
   AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_input'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 creating:=NOT p_payload ? 'recordId';
 IF creating THEN
  IF p_payload->>'action'<>'availability.save' OR p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_record'; END IF;
 ELSE
  SELECT * INTO rec FROM candidate_operations.availability_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='availability_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 END IF;
 IF p_payload->>'action'='availability.save' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','startDate','endDate','days','startMinute','endMinute','beforeMinutes','afterMinutes','title','kind','excludedDates','replacesId'))
  OR NOT input ?& ARRAY['startDate','endDate','days','startMinute','endMinute','title','kind'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_fields'; END IF;
  SELECT * INTO owner FROM candidate_identity.memberships WHERE id=coalesce((input->>'personId')::uuid,rec.member_id,actor.id) AND restaurant_id=p_restaurant AND (active OR schedule_only) FOR SHARE;
  IF NOT FOUND OR NOT creating AND owner.id<>rec.member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  IF NOT creating AND rec.status='approved' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF owner.id<>actor.id AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage'
   AND (actor.department=owner.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  FOR key IN SELECT unnest(ARRAY['startDate','endDate','title','kind']) LOOP
   IF jsonb_typeof(input->key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_value'; END IF;
  END LOOP;
  IF input->>'startDate' !~ '^\d{4}-\d{2}-\d{2}$' OR input->>'endDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_date'; END IF;
  first_date:=(input->>'startDate')::date;last_date:=(input->>'endDate')::date;
  IF last_date<first_date OR last_date-first_date>370 OR input->>'kind' NOT IN ('school','unavailable') OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 150
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_value'; END IF;
  IF jsonb_typeof(input->'days') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_days'; END IF;
  IF jsonb_array_length(input->'days')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'days') d WHERE jsonb_typeof(d)<>'number' OR d::text !~ '^[0-6]$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_days'; END IF;
  FOR key IN SELECT unnest(ARRAY['startMinute','endMinute','beforeMinutes','afterMinutes']) LOOP
   IF key IN ('beforeMinutes','afterMinutes') AND NOT input ? key THEN input:=input||jsonb_build_object(key,0); END IF;
   IF jsonb_typeof(input->key) IS DISTINCT FROM 'number' OR input->>key !~ '^[0-9]+$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_minutes'; END IF;
   n:=(input->>key)::integer;
   IF n>(CASE key WHEN 'startMinute' THEN 1439 WHEN 'endMinute' THEN 1440 ELSE 180 END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_minutes'; END IF;
  END LOOP;
  IF (input->>'endMinute')::integer<=(input->>'startMinute')::integer THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_minutes'; END IF;
  IF NOT input ? 'excludedDates' THEN input:=input||'{"excludedDates":[]}'; END IF;
  IF jsonb_typeof(input->'excludedDates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_exceptions'; END IF;
  IF jsonb_array_length(input->'excludedDates')>90 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'excludedDates') d WHERE jsonb_typeof(d)<>'string' OR d#>>'{}' !~ '^\d{4}-\d{2}-\d{2}$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_exceptions'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(input->'excludedDates') d WHERE d::date NOT BETWEEN first_date AND last_date) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_exceptions'; END IF;
  IF input ? 'replacesId' THEN
   PERFORM 1 FROM candidate_operations.availability_references WHERE id=(input->>'replacesId')::uuid AND member_id=owner.id AND restaurant_id=p_restaurant AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_replacement_conflict'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.capability='schedule.manage' AND c.active
   WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>owner.id AND (m.department=owner.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND capability='location.manage' AND active)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='availability_reviewer_required'; END IF;
  data:=input-'personId'||jsonb_build_object('title',btrim(input->>'title'),'days',(SELECT jsonb_agg(d ORDER BY d) FROM (SELECT DISTINCT d FROM jsonb_array_elements(input->'days') d) days),'status','pending','decision','');
  IF creating THEN
   INSERT INTO candidate_operations.availability_references(id,restaurant_id,member_id,department,revision,updated_at,status,data)
   VALUES(gen_random_uuid(),p_restaurant,owner.id,owner.department,1,clock_timestamp(),'pending',data) RETURNING * INTO rec;
  ELSE UPDATE candidate_operations.availability_references SET data=availability_work.data,status='pending',revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('approve','note')) OR NOT input ?& ARRAY['approve','note'] OR jsonb_typeof(input->'approve') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_review'; END IF;
  IF rec.member_id=actor.id OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage'
   AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF rec.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  approve:=(input->>'approve')::boolean;data:=rec.data||jsonb_build_object('status',CASE WHEN approve THEN 'approved' ELSE 'declined' END,'decision',btrim(input->>'note'));
  IF approve THEN
   IF rec.data ? 'replacesId' THEN
    SELECT * INTO old FROM candidate_operations.availability_references WHERE id=(rec.data->>'replacesId')::uuid AND restaurant_id=p_restaurant AND member_id=rec.member_id AND status='approved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_replacement_conflict'; END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.member_id=rec.member_id AND NOT s.cancelled
    AND EXISTS(SELECT 1 FROM (SELECT availability_work.data AS d UNION ALL SELECT a.data FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant AND a.member_id=rec.member_id AND a.status='approved' AND a.id<>coalesce(old.id,rec.id)) rules
     WHERE candidate_operations.availability_period_conflict(d,s.starts_at,s.ends_at,scope.timezone))) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
   IF old.id IS NOT NULL THEN
    UPDATE candidate_operations.availability_references SET status='superseded',data=old.data||jsonb_build_object('status','superseded','decision','Replaced by approved request '||rec.id),revision=revision+1,updated_at=clock_timestamp() WHERE id=old.id RETURNING * INTO old;
    INSERT INTO candidate_operations.availability_events VALUES(old.id,old.revision,actor.id,'superseded',old.data,clock_timestamp());
   END IF;
  END IF;
  UPDATE candidate_operations.availability_references SET data=availability_work.data,status=availability_work.data->>'status',revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 INSERT INTO candidate_operations.availability_events VALUES(rec.id,rec.revision,actor.id,p_payload->>'action',rec.data,clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF p_payload->>'action'='availability.review' THEN INSERT INTO candidate_operations.availability_outbox VALUES(rec.id,rec.revision,rec.member_id,'Availability '||rec.status,NULL);
 ELSE
  INSERT INTO candidate_operations.availability_outbox SELECT rec.id,rec.revision,m.id,'Availability review',NULL FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.capability='schedule.manage' AND c.active
  WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>rec.member_id AND (m.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND capability='location.manage' AND active));
 END IF;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.availability_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.availability_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
