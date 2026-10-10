-- Candidate time-off requests. Published/linked shift cancellation remains held.
BEGIN;
ALTER TABLE candidate_operations.time_off_references ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 ADD COLUMN note text NOT NULL DEFAULT '',ADD COLUMN decision text NOT NULL DEFAULT '',ADD COLUMN department text,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
UPDATE candidate_operations.time_off_references r SET department=m.department FROM candidate_identity.memberships m WHERE m.id=r.member_id;
ALTER TABLE candidate_operations.time_off_references ALTER COLUMN department SET NOT NULL;
CREATE TABLE candidate_operations.time_off_events(
 request_id uuid NOT NULL REFERENCES candidate_operations.time_off_references(id),revision integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),data jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(request_id,revision)
);
CREATE TABLE candidate_operations.time_off_outbox(
 request_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 message text NOT NULL,delivered_at timestamptz,PRIMARY KEY(request_id,revision,recipient_id),
 FOREIGN KEY(request_id,revision) REFERENCES candidate_operations.time_off_events(request_id,revision)
);
REVOKE ALL ON candidate_operations.time_off_events,candidate_operations.time_off_outbox FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.time_off_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
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
    INSERT INTO candidate_operations.schedule_draft_events VALUES(s.id,s.revision,actor.id,jsonb_build_object('personId',s.member_id,'start',s.starts_at,'end',s.ends_at,'position',s.position,'published',false,'cancelled',true,'action','time-off-approved','requestId',rec.id,'note',btrim(input->>'note')),clock_timestamp());
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
CREATE FUNCTION candidate_operations.list_time_off(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
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
  'affectedShifts',CASE WHEN 'schedule.manage'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision) ORDER BY s.starts_at,s.id),'[]') FROM candidate_operations.shift_references s WHERE s.restaurant_id=r.restaurant_id AND s.member_id=r.member_id AND NOT s.cancelled AND s.starts_at<r.ends_at AND s.ends_at>r.starts_at) ELSE NULL END) ORDER BY r.id),'[]') INTO items FROM candidate_operations.time_off_references r WHERE r.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','time-off-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_time_off(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_time_off(text,uuid,text,uuid,integer) TO candidate_runtime;
COMMIT;
