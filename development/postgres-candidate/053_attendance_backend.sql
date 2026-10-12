-- Isolated candidate attendance. No shift correction, payroll or employee reads.
BEGIN;
CREATE FUNCTION candidate_operations.attendance_text(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT btrim(p_value,(SELECT string_agg(chr(c),'') FROM unnest(ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) c));
$$;
REVOKE ALL ON FUNCTION candidate_operations.attendance_text(text) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.attendance_facts_valid(p_facts jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(p_facts)='object'
  AND p_facts ?& ARRAY['contact','coverage','emergency']
  AND (p_facts - ARRAY['contact','coverage','emergency'])='{}'::jsonb
  AND p_facts->>'contact' IN ('unknown','phone','message','none')
  AND p_facts->>'coverage' IN ('unknown','confirmed','uncovered')
  AND p_facts->>'emergency' IN ('unknown','reported','not-reported'),false);
$$;
REVOKE ALL ON FUNCTION candidate_operations.attendance_facts_valid(jsonb) FROM PUBLIC,candidate_runtime;
CREATE TABLE candidate_operations.attendance_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 member_id uuid NOT NULL, person_id uuid NOT NULL REFERENCES candidate_identity.people(id), department text NOT NULL,
 employee_name_at_entry text NOT NULL, shift_id uuid NOT NULL REFERENCES candidate_operations.shift_references(id),
 shift_revision integer NOT NULL CHECK(shift_revision>0), shift_snapshot jsonb NOT NULL,
 attendance_type text NOT NULL CHECK(attendance_type IN ('call-in','no-show','late','left-early','other')),
 reported_at timestamptz NOT NULL, note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 2000),
 facts jsonb NOT NULL CHECK(candidate_operations.attendance_facts_valid(facts)),
 status text NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','voided')), review jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 1000), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id), UNIQUE(id,restaurant_id)
);
CREATE UNIQUE INDEX attendance_current_type ON candidate_operations.attendance_entries(restaurant_id,shift_id,person_id,attendance_type) WHERE status='recorded';
CREATE INDEX attendance_scope_page ON candidate_operations.attendance_entries(restaurant_id,department,id);
CREATE TABLE candidate_operations.attendance_events(
 attendance_id uuid NOT NULL, restaurant_id text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 actor_id uuid NOT NULL, actor_person_id uuid NOT NULL REFERENCES candidate_identity.people(id), actor_name_at_entry text NOT NULL,
 action text NOT NULL CHECK(action IN ('attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen')),
 change_reason text NOT NULL, before_value jsonb, after_value jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(attendance_id,revision), FOREIGN KEY(attendance_id,restaurant_id) REFERENCES candidate_operations.attendance_entries(id,restaurant_id),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON candidate_operations.attendance_entries,candidate_operations.attendance_events FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.attendance_allowed(p_member uuid,p_restaurant text,p_department text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.id=p_member AND m.restaurant_id=p_restaurant
  AND m.active AND NOT m.schedule_only AND NOT candidate_operations.is_dish_position(p_restaurant,m.position)
  AND (EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=m.id AND c.active AND c.capability='location.manage')
   OR m.department=p_department AND EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=m.id AND c.active AND c.capability='people.manage')));
$$;
CREATE FUNCTION candidate_operations.attendance_actor(p_subject text,p_member uuid,p_restaurant text) RETURNS candidate_identity.memberships
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,actor.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
 RETURN actor;
END;
$$;
CREATE FUNCTION candidate_operations.attendance_record_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'kind','attendance','ownerId',r.member_id,'locationId',r.restaurant_id,'area',r.department,'revision',r.revision,'updatedAt',r.updated_at,
 'data',jsonb_build_object('title',p.name||' · '||CASE r.attendance_type WHEN 'call-in' THEN 'Called in' WHEN 'no-show' THEN 'No-show' WHEN 'late' THEN 'Late arrival' WHEN 'left-early' THEN 'Left early' ELSE 'Other attendance note' END,'employeeName',p.name,'employeeNameAtEntry',r.employee_name_at_entry,'historicalNameLabel','name at time of entry',
 'shiftId',r.shift_id,'shiftRevision',r.shift_revision,'shift',r.shift_snapshot,'type',r.attendance_type,'reportedAt',r.reported_at,'note',r.note,'facts',r.facts,'status',r.status,
 'review',CASE WHEN r.review IS NULL THEN NULL ELSE r.review||jsonb_build_object('actorName',(SELECT name FROM candidate_identity.people WHERE id=(r.review->>'actorPersonId')::uuid)) END,
 'actions',jsonb_build_object('canCorrect',r.status='recorded' AND r.revision<1000,'canVoid',r.status='recorded' AND r.revision<1000,
 'canReview',r.status='recorded' AND r.revision<1000 AND r.review IS NULL,'canReopen',r.status='recorded' AND r.revision<1000 AND r.review IS NOT NULL)))
 FROM candidate_operations.attendance_entries r JOIN candidate_identity.people p ON p.id=r.person_id WHERE r.id=p_id;
$$;
REVOKE ALL ON FUNCTION candidate_operations.attendance_allowed(uuid,text,text),candidate_operations.attendance_actor(text,uuid,text),candidate_operations.attendance_record_json(uuid) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.attendance_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships; rec candidate_operations.attendance_entries; previous candidate_operations.attendance_entries;
 shift candidate_operations.shift_references; receipt candidate_operations.command_receipts; input jsonb; action text; result jsonb;
 creating boolean; reason text:=''; actor_name text; at timestamptz; workspace_revision integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 actor:=candidate_operations.attendance_actor(p_subject,p_member,p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_command'; END IF;
 -- Replay precedes mutable shift/status/revision validation, with current entry-area authorization.
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.attendance_entries WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,rec.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 action:=p_payload->>'action'; input:=p_payload->'input'; creating:=action='attendance.record';
 IF action IS NULL OR action NOT IN ('attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen')
  OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_command'; END IF;
 IF creating THEN
  IF p_payload ?| ARRAY['recordId','expectedRevision'] OR NOT input ?& ARRAY['shiftId','shiftRevision','type','reportedAt','note'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_fields'; END IF;
  SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,shift.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
  IF NOT shift.published OR shift.cancelled THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_source_ineligible'; END IF;
  IF jsonb_typeof(input->'shiftRevision') IS DISTINCT FROM 'number' OR input->>'shiftRevision' !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF (input->>'shiftRevision')::bigint<>shift.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  rec.id:=gen_random_uuid();rec.restaurant_id:=p_restaurant;rec.member_id:=shift.member_id;rec.department:=shift.department;rec.shift_id:=shift.id;rec.shift_revision:=shift.revision;
  SELECT m.person_id,p.name INTO rec.person_id,rec.employee_name_at_entry FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE m.id=shift.member_id;
  rec.shift_snapshot:=jsonb_build_object('start',shift.starts_at,'end',shift.ends_at,'position',shift.position,'timezone',(SELECT timezone FROM candidate_identity.restaurants WHERE id=p_restaurant));
  rec.status:='recorded';rec.revision:=1;rec.facts:='{"contact":"unknown","coverage":"unknown","emergency":"unknown"}'::jsonb;
 ELSE
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_fields'; END IF;
  SELECT * INTO rec FROM candidate_operations.attendance_entries WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,rec.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
  previous:=rec;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF (p_payload->>'expectedRevision')::bigint<>rec.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.status<>'recorded' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_voided'; END IF;
  IF rec.revision>=1000 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_history_limit'; END IF;
  rec.revision:=rec.revision+1;
 END IF;
 at:=clock_timestamp();SELECT name INTO actor_name FROM candidate_identity.people WHERE id=actor.person_id;
 IF action IN ('attendance.record','attendance.correct') THEN
  IF NOT input ?& ARRAY['type','reportedAt','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('shiftId','shiftRevision','type','reportedAt','note','facts','changeReason'))
   OR NOT creating AND input ?| ARRAY['shiftId','shiftRevision'] OR creating AND input ? 'changeReason' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_fields'; END IF;
  IF input->>'type' IS NULL OR input->>'type' NOT IN ('call-in','no-show','late','left-early','other') OR jsonb_typeof(input->'reportedAt') IS DISTINCT FROM 'string'
   OR input->>'reportedAt' !~ '^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_value'; END IF;
  rec.attendance_type:=input->>'type';rec.reported_at:=(input->>'reportedAt')::timestamptz;
  IF rec.reported_at>at+interval '60 seconds' OR rec.attendance_type='no-show' AND rec.reported_at<(rec.shift_snapshot->>'start')::timestamptz THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_time'; END IF;
  IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_note'; END IF;
  rec.note:=candidate_operations.attendance_text(input->>'note');rec.review:=NULL;
  IF input ? 'facts' THEN
   IF NOT candidate_operations.attendance_facts_valid(input->'facts') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_facts'; END IF;
   rec.facts:=input->'facts';
  END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.attendance_entries e WHERE e.restaurant_id=p_restaurant AND e.shift_id=rec.shift_id AND e.person_id=rec.person_id AND e.attendance_type=rec.attendance_type AND e.status='recorded' AND e.id<>rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_duplicate'; END IF;
  IF NOT creating THEN reason:=input->>'changeReason'; END IF;
 ELSIF action='attendance.void' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'changeReason') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_fields'; END IF;
  reason:=input->>'changeReason';rec.status:='voided';
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_fields'; END IF;
  reason:=input->>'note';
  IF action='attendance.review' THEN
   IF rec.review IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_already_reviewed'; END IF;
   rec.review:=jsonb_build_object('at',at,'actorId',actor.id,'actorPersonId',actor.person_id,'actorNameAtEntry',actor_name,'note',candidate_operations.attendance_text(reason));
  ELSE
   IF rec.review IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attendance_not_reviewed'; END IF;
   rec.review:=NULL;
  END IF;
 END IF;
 IF NOT creating AND (jsonb_typeof(input->CASE WHEN action IN ('attendance.correct','attendance.void') THEN 'changeReason' ELSE 'note' END) IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(reason)) NOT BETWEEN 1 AND 2000 OR reason IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_reason'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 rec.updated_at:=at;
 IF creating THEN INSERT INTO candidate_operations.attendance_entries SELECT rec.*;
 ELSE UPDATE candidate_operations.attendance_entries SET attendance_type=rec.attendance_type,reported_at=rec.reported_at,note=rec.note,facts=rec.facts,status=rec.status,review=rec.review,revision=rec.revision,updated_at=at WHERE id=rec.id; END IF;
 INSERT INTO candidate_operations.attendance_events VALUES(rec.id,p_restaurant,rec.revision,actor.id,actor.person_id,actor_name,action,candidate_operations.attendance_text(reason),CASE WHEN creating THEN NULL ELSE to_jsonb(previous) END,to_jsonb(rec),at);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO workspace_revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',workspace_revision,'requestId',p_request,'appliedAt',at,'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.attendance_command(text,uuid,text,uuid,jsonb) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.attendance_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;

CREATE FUNCTION candidate_operations.list_attendance(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_from date DEFAULT NULL,p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;selected uuid[];items jsonb;next_cursor uuid;
BEGIN
 actor:=candidate_operations.attendance_actor(p_subject,p_member,p_restaurant);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_from IS NULL)<>(p_to IS NULL) OR p_from>p_to THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_query'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT r.id FROM candidate_operations.attendance_entries r
 WHERE r.restaurant_id=p_restaurant AND candidate_operations.attendance_allowed(actor.id,p_restaurant,r.department) AND (p_after IS NULL OR r.id>p_after)
 AND (p_from IS NULL OR ((r.shift_snapshot->>'start')::timestamptz AT TIME ZONE (r.shift_snapshot->>'timezone'))::date BETWEEN p_from AND p_to)
 ORDER BY r.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(candidate_operations.attendance_record_json(id) ORDER BY id),'[]') INTO items FROM candidate_operations.attendance_entries WHERE id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'rangeComplete',next_cursor IS NULL,'from',p_from,'to',p_to,'workspaceRevision',(SELECT revision FROM candidate_identity.restaurants WHERE id=p_restaurant));
END;
$$;
CREATE FUNCTION candidate_operations.read_attendance(p_subject text,p_member uuid,p_restaurant text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;rec candidate_operations.attendance_entries;
BEGIN
 actor:=candidate_operations.attendance_actor(p_subject,p_member,p_restaurant);
 SELECT * INTO rec FROM candidate_operations.attendance_entries WHERE id=p_id AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,rec.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
 RETURN candidate_operations.attendance_record_json(rec.id);
END;
$$;
CREATE FUNCTION candidate_operations.read_attendance_history(p_subject text,p_member uuid,p_restaurant text,p_id uuid,p_after integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;rec candidate_operations.attendance_entries;selected integer[];items jsonb;next_cursor integer;
BEGIN
 actor:=candidate_operations.attendance_actor(p_subject,p_member,p_restaurant);
 SELECT * INTO rec FROM candidate_operations.attendance_entries WHERE id=p_id AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT candidate_operations.attendance_allowed(actor.id,p_restaurant,rec.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='attendance_denied'; END IF;
 IF p_after IS NULL OR p_after NOT BETWEEN 0 AND 1000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attendance_query'; END IF;
 SELECT array_agg(revision ORDER BY revision) INTO selected FROM (SELECT revision FROM candidate_operations.attendance_events WHERE attendance_id=rec.id AND revision>p_after ORDER BY revision LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('revision',e.revision,'action',e.action,'actorId',e.actor_id,'actorName',p.name,'actorNameAtEntry',e.actor_name_at_entry,'historicalNameLabel','name at time of entry','at',e.recorded_at,'changeReason',e.change_reason,'before',e.before_value,'after',e.after_value) ORDER BY e.revision),'[]')
 INTO items FROM candidate_operations.attendance_events e JOIN candidate_identity.people p ON p.id=e.actor_person_id WHERE e.attendance_id=rec.id AND e.revision=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'attendanceRevision',rec.revision,'historyComplete',next_cursor IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.list_attendance(text,uuid,text,uuid,integer,date,date),candidate_operations.read_attendance(text,uuid,text,uuid),candidate_operations.read_attendance_history(text,uuid,text,uuid,integer,integer) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.list_attendance(text,uuid,text,uuid,integer,date,date),candidate_operations.read_attendance(text,uuid,text,uuid),candidate_operations.read_attendance_history(text,uuid,text,uuid,integer,integer) TO candidate_runtime;
-- Explicit schedule projections are appended below; never patch runtime definitions with regex.
CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_shifts(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants; can_change boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 can_change:='schedule.change'=ANY(caps);
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after) AND (s.published OR s.ends_at>statement_timestamp())
  AND (
   (caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)))
   OR s.published AND (s.member_id=actor.id
    OR NOT candidate_operations.is_dish_position(actor.restaurant_id,actor.position) AND ('location.manage'=ANY(caps) OR 'people.manage'=ANY(caps) AND actor.department=s.department)
    OR 'close.confirm'=ANY(caps) AND (actor.department=s.department OR 'location.manage'=ANY(caps)
      OR NOT candidate_operations.is_dish_position(actor.restaurant_id,actor.position) AND 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND candidate_operations.operating_department(s.restaurant_id,s.department)))
  ) ORDER BY s.id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','shift','locationId',s.restaurant_id,'area',s.department,'ownerId',s.member_id,'revision',s.revision,
  'data',jsonb_build_object('personId',s.member_id,'position',s.position,'start',s.starts_at,'end',s.ends_at,'published',s.published,'cancelled',s.cancelled,'releasedAt',s.released_at,'attendanceActions',jsonb_build_object('canRecord',s.published AND NOT s.cancelled AND candidate_operations.attendance_allowed(actor.id,p_restaurant,s.department)),'publishedActions',CASE WHEN can_change THEN candidate_operations.published_shift_actions(actor.id,p_restaurant,s.id) ELSE jsonb_build_object('canEdit',false,'canChangeStructure',false,'canChangeStation',false,'canCancel',false,'unfinishedClosingCount',0,'hasLinkedTasks',false,'hasCompletedClosing',false,'editAreas','[]'::jsonb,'blockedReason','authority') END)||CASE WHEN s.station_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision) END||CASE WHEN caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) AND EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending') THEN jsonb_build_object('reviewFlags',(SELECT jsonb_agg(jsonb_build_object('reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.request_id) FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending')) ELSE '{}'::jsonb END) ORDER BY s.id),'[]')
 INTO items FROM candidate_operations.shift_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','shift-references-only');
END;
$function$;

CREATE OR REPLACE FUNCTION candidate_operations.schedule_viewer(p_subject text, p_member uuid, p_restaurant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; scope candidate_identity.restaurants; me jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT jsonb_build_object('id',actor.id,'locationId',actor.restaurant_id,'name',p.name,'area',actor.department,'position',actor.position,
 'capabilities',(SELECT coalesce(jsonb_agg(capability ORDER BY capability),'[]') FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active),
 'qualifications',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_identity.schedule_eligibility WHERE member_id=actor.id AND active AND source='qualification'),
 'scheduleJobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_identity.schedule_eligibility WHERE member_id=actor.id AND active AND source='schedule-job')) INTO me FROM candidate_identity.people p WHERE p.id=actor.person_id;
 RETURN jsonb_build_object('location',jsonb_build_object('id',scope.id,'name',scope.name,'timezone',scope.timezone,'revision',scope.revision,'configuration',jsonb_build_object('operatingDepartments',scope.operating_departments,'dishDepartment',scope.dish_department,'dishPosition',scope.dish_position,'dishAliases',scope.dish_aliases)),'me',me,'attendanceAreas',(SELECT coalesce(jsonb_agg(area ORDER BY area),'[]') FROM unnest(scope.operating_departments) area WHERE candidate_operations.attendance_allowed(actor.id,p_restaurant,area)),'leadershipOptions',(SELECT coalesce(jsonb_agg(jsonb_build_object('area',area,'leaders',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',p.name) ORDER BY p.name,m.id),'[]') FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE candidate_operations.leadership_target_allowed(m.id,p_restaurant,area))) ORDER BY area),'[]') FROM unnest(scope.operating_departments) area WHERE candidate_operations.goal_authorized(actor.id,area,'schedule.publish')),'workspaceRevision',scope.revision,'scheduleRevision',(SELECT schedule_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant),'inputRevision',(SELECT input_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
END;
$function$;

COMMIT;
