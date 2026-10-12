BEGIN;
-- Retain migration 040's original flags/snapshots. Resolution is a separate review fact.
ALTER TABLE candidate_operations.scope_coordination ADD COLUMN leave_review_revision integer NOT NULL DEFAULT 0 CHECK(leave_review_revision>=0);
ALTER TABLE candidate_operations.time_off_shift_flags
 ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision IN (1,2)),
 ADD COLUMN member_id uuid,ADD COLUMN person_id uuid,ADD COLUMN department text,ADD COLUMN timezone text,
 ADD COLUMN shift_local_date date,ADD COLUMN employee_name_at_flag text,ADD COLUMN identity_capture text NOT NULL DEFAULT 'migration058' CHECK(identity_capture IN ('migration058','flag-created')),ADD COLUMN resolution jsonb;
UPDATE candidate_operations.time_off_shift_flags f SET member_id=(f.before_snapshot->>'member_id')::uuid,person_id=m.person_id,
 department=f.before_snapshot->>'department',timezone=r.timezone,shift_local_date=((f.before_snapshot->>'starts_at')::timestamptz AT TIME ZONE r.timezone)::date,
 employee_name_at_flag=p.name FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id
 JOIN candidate_identity.restaurants r ON r.id=m.restaurant_id WHERE m.id=(f.before_snapshot->>'member_id')::uuid AND r.id=f.restaurant_id;
ALTER TABLE candidate_operations.time_off_shift_flags
 ALTER COLUMN member_id SET NOT NULL,ALTER COLUMN person_id SET NOT NULL,ALTER COLUMN department SET NOT NULL,
 ALTER COLUMN timezone SET NOT NULL,ALTER COLUMN shift_local_date SET NOT NULL,ALTER COLUMN employee_name_at_flag SET NOT NULL,
 ADD CONSTRAINT leave_review_identity UNIQUE(id),ADD CONSTRAINT leave_review_scope_identity UNIQUE(id,restaurant_id),
 ADD FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 ADD FOREIGN KEY(person_id) REFERENCES candidate_identity.people(id),
 ADD CONSTRAINT leave_review_resolution_shape CHECK((review_status='pending' AND revision=1 AND resolution IS NULL)
 OR (review_status='resolved' AND (revision=1 AND resolution IS NULL OR revision=2 AND resolution IS NOT NULL AND jsonb_typeof(resolution)='object')));
CREATE INDEX leave_review_scope_date_page ON candidate_operations.time_off_shift_flags(restaurant_id,review_status,shift_local_date,id);
CREATE TABLE candidate_operations.leave_review_events(
 flag_id uuid NOT NULL,restaurant_id text NOT NULL,revision integer NOT NULL CHECK(revision=2),
 actor_id uuid NOT NULL,actor_person_id uuid NOT NULL REFERENCES candidate_identity.people(id),actor_name_at_entry text NOT NULL,
 note text NOT NULL,source_context jsonb NOT NULL,before_value jsonb NOT NULL,after_value jsonb NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(flag_id,revision),FOREIGN KEY(flag_id,restaurant_id) REFERENCES candidate_operations.time_off_shift_flags(id,restaurant_id),
 FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON candidate_operations.leave_review_events FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.capture_leave_review_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m candidate_identity.memberships;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO m FROM candidate_identity.memberships WHERE id=(NEW.before_snapshot->>'member_id')::uuid AND restaurant_id=NEW.restaurant_id;
  IF NOT FOUND OR NEW.before_snapshot->>'id' IS DISTINCT FROM NEW.shift_id::text OR NEW.before_snapshot->>'restaurant_id' IS DISTINCT FROM NEW.restaurant_id
   OR (NEW.before_snapshot->>'revision')::integer IS DISTINCT FROM NEW.shift_revision OR NEW.review_status<>'pending' OR NEW.revision<>1 OR NEW.resolution IS NOT NULL
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_origin'; END IF;
  NEW.member_id:=m.id;NEW.person_id:=m.person_id;NEW.department:=NEW.before_snapshot->>'department';
  SELECT timezone INTO NEW.timezone FROM candidate_identity.restaurants WHERE id=NEW.restaurant_id;
  NEW.shift_local_date:=((NEW.before_snapshot->>'starts_at')::timestamptz AT TIME ZONE NEW.timezone)::date;
  SELECT name INTO NEW.employee_name_at_flag FROM candidate_identity.people WHERE id=NEW.person_id;
  NEW.identity_capture:='flag-created';
 ELSIF ROW(NEW.id,NEW.restaurant_id,NEW.request_id,NEW.shift_id,NEW.shift_revision,NEW.before_snapshot,NEW.reason,NEW.recorded_at,NEW.member_id,NEW.person_id,NEW.department,NEW.timezone,NEW.shift_local_date,NEW.employee_name_at_flag,NEW.identity_capture)
 IS DISTINCT FROM ROW(OLD.id,OLD.restaurant_id,OLD.request_id,OLD.shift_id,OLD.shift_revision,OLD.before_snapshot,OLD.reason,OLD.recorded_at,OLD.member_id,OLD.person_id,OLD.department,OLD.timezone,OLD.shift_local_date,OLD.employee_name_at_flag,OLD.identity_capture)
 OR OLD.review_status='resolved' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='leave_review_origin_immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION candidate_operations.coordinate_leave_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='leave_review_history_retained'; END IF;
 PERFORM candidate_operations.lock_scope(NEW.restaurant_id,true);
 UPDATE candidate_operations.scope_coordination SET leave_review_revision=leave_review_revision+1 WHERE restaurant_id=NEW.restaurant_id;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.capture_leave_review_origin(),candidate_operations.coordinate_leave_review() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER aa_coordinate_leave_review BEFORE INSERT OR UPDATE OR DELETE ON candidate_operations.time_off_shift_flags FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_leave_review();
CREATE TRIGGER capture_leave_review_origin BEFORE INSERT OR UPDATE ON candidate_operations.time_off_shift_flags FOR EACH ROW EXECUTE FUNCTION candidate_operations.capture_leave_review_origin();

CREATE FUNCTION candidate_operations.leave_review_context(p_flag uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('originalShift',candidate_operations.correction_source_key(f.before_snapshot)||jsonb_build_object('id',f.shift_id,'starts_at',(f.before_snapshot->>'starts_at')::timestamptz,'ends_at',(f.before_snapshot->>'ends_at')::timestamptz),
  'currentShift',candidate_operations.correction_source_key(to_jsonb(s))||jsonb_build_object('id',s.id),
  'request',CASE WHEN q.status='approved' AND qm.person_id=f.person_id THEN jsonb_build_object('id',q.id,'restaurantId',q.restaurant_id,'start',q.starts_at,'end',q.ends_at,'status',q.status,'revision',q.revision) ELSE NULL END,
  'sourceAvailable',s.restaurant_id=f.restaurant_id AND q.status='approved' AND qm.person_id=f.person_id,
  'sourceChanged',candidate_operations.correction_source_key(to_jsonb(s))<>(candidate_operations.correction_source_key(f.before_snapshot)||jsonb_build_object('starts_at',(f.before_snapshot->>'starts_at')::timestamptz,'ends_at',(f.before_snapshot->>'ends_at')::timestamptz)),
  'sameCurrentPerson',sm.person_id=f.person_id)
 FROM candidate_operations.time_off_shift_flags f JOIN candidate_operations.shift_references s ON s.id=f.shift_id
 JOIN candidate_identity.memberships sm ON sm.id=s.member_id JOIN candidate_operations.time_off_references q ON q.id=f.request_id
 JOIN candidate_identity.memberships qm ON qm.id=q.member_id WHERE f.id=p_flag;
$$;
CREATE FUNCTION candidate_operations.leave_review_token(p_flag uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',f.id,'revision',f.revision,'context',candidate_operations.leave_review_context(f.id))::text,'UTF8')),'hex')
 FROM candidate_operations.time_off_shift_flags f WHERE f.id=p_flag;
$$;
CREATE FUNCTION candidate_operations.retain_leave_review_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='leave_review_history_retained'; END;
$$;
CREATE TRIGGER retain_leave_review_event BEFORE UPDATE OR DELETE ON candidate_operations.leave_review_events FOR EACH ROW EXECUTE FUNCTION candidate_operations.retain_leave_review_event();
CREATE FUNCTION candidate_operations.check_leave_resolution_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF NEW.revision=2 AND NOT EXISTS(SELECT 1 FROM candidate_operations.leave_review_events WHERE flag_id=NEW.id AND revision=NEW.revision AND after_value=to_jsonb(NEW))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='leave_review_audit_required'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER check_leave_resolution_audit AFTER INSERT OR UPDATE ON candidate_operations.time_off_shift_flags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION candidate_operations.check_leave_resolution_audit();
REVOKE ALL ON FUNCTION candidate_operations.leave_review_context(uuid),candidate_operations.leave_review_token(uuid),candidate_operations.retain_leave_review_event(),candidate_operations.check_leave_resolution_audit() FROM PUBLIC,candidate_runtime;

-- Owner-selected policy: affected-store schedule managers see minimal approved leave
-- facts without origin-store grants; own-person review is allowed with a reason.
CREATE FUNCTION candidate_operations.leave_review_allowed(p_actor uuid,p_flag uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags f JOIN candidate_operations.shift_references s ON s.id=f.shift_id AND s.restaurant_id=f.restaurant_id
 JOIN candidate_identity.memberships a ON a.id=p_actor AND a.restaurant_id=f.restaurant_id
 WHERE f.id=p_flag AND a.active AND NOT a.schedule_only AND NOT candidate_operations.is_dish_position(f.restaurant_id,a.position)
 AND EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=a.id AND c.active AND c.capability='schedule.manage')
 AND (a.department=f.department AND a.department=s.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=a.id AND c.active AND c.capability='location.manage')));
$$;
CREATE FUNCTION candidate_operations.leave_review_actor(p_subject text,p_member uuid,p_restaurant text) RETURNS candidate_identity.memberships
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(p_restaurant,actor.position)
 OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities c WHERE c.membership_id=actor.id AND c.active AND c.capability='schedule.manage')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_denied'; END IF;
 RETURN actor;
END;
$$;
CREATE FUNCTION candidate_operations.leave_review_evidence_allowed(p_actor uuid,p_flag uuid,p_kind text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT candidate_operations.leave_review_allowed(p_actor,p_flag) AND EXISTS(
 SELECT 1 FROM candidate_operations.time_off_shift_flags f WHERE f.id=p_flag AND CASE p_kind
 WHEN 'attendance' THEN EXISTS(SELECT 1 FROM candidate_operations.attendance_entries r WHERE r.id=p_id AND r.restaurant_id=f.restaurant_id AND r.shift_id=f.shift_id AND r.person_id=f.person_id AND candidate_operations.attendance_allowed(p_actor,r.restaurant_id,r.department))
 WHEN 'correction' THEN EXISTS(SELECT 1 FROM candidate_operations.completed_shift_corrections r WHERE r.id=p_id AND r.restaurant_id=f.restaurant_id AND r.shift_id=f.shift_id AND r.person_id=f.person_id AND candidate_operations.correction_allowed(p_actor,r.restaurant_id,r.department))
 ELSE false END);
$$;
CREATE FUNCTION candidate_operations.leave_review_resolution_json(p_actor uuid,p_flag uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN f.resolution IS NULL THEN NULL ELSE (f.resolution-'evidence')||jsonb_build_object('evidence',
 (SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') FROM jsonb_array_elements(f.resolution->'evidence') WITH ORDINALITY x(v,n)
 WHERE candidate_operations.leave_review_evidence_allowed(p_actor,f.id,v->>'kind',(v->>'id')::uuid)),
 'restrictedEvidence',EXISTS(SELECT 1 FROM jsonb_array_elements(f.resolution->'evidence') v WHERE NOT candidate_operations.leave_review_evidence_allowed(p_actor,f.id,v->>'kind',(v->>'id')::uuid))) END
 FROM candidate_operations.time_off_shift_flags f WHERE f.id=p_flag;
$$;
CREATE FUNCTION candidate_operations.leave_review_json(p_actor uuid,p_flag uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH item AS (SELECT f.*,candidate_operations.leave_review_context(f.id) context FROM candidate_operations.time_off_shift_flags f WHERE f.id=p_flag AND candidate_operations.leave_review_allowed(p_actor,f.id)),
 evidence AS (SELECT 'attendance' kind,r.id,r.revision,r.attendance_type||' · '||r.status label,r.updated_at FROM candidate_operations.attendance_entries r JOIN item f ON f.shift_id=r.shift_id AND f.restaurant_id=r.restaurant_id AND f.person_id=r.person_id WHERE candidate_operations.attendance_allowed(p_actor,r.restaurant_id,r.department)
 UNION ALL SELECT 'correction',r.id,r.revision,'Planned correction · '||r.status,r.updated_at FROM candidate_operations.completed_shift_corrections r JOIN item f ON f.shift_id=r.shift_id AND f.restaurant_id=r.restaurant_id AND f.person_id=r.person_id WHERE candidate_operations.correction_allowed(p_actor,r.restaurant_id,r.department))
 SELECT jsonb_build_object('id',f.id,'kind','leave-review','locationId',f.restaurant_id,'ownerId',f.member_id,'area',f.department,'revision',f.revision,
 'data',jsonb_build_object('personId',f.person_id,'requestId',f.request_id,'shiftId',f.shift_id,'employeeName',p.name,'employeeNameAtCapture',f.employee_name_at_flag,'identityCapture',f.identity_capture,'reason',f.reason,'status',f.review_status,
 'recordedAt',f.recorded_at,'shiftLocalDate',f.shift_local_date,'timezone',f.timezone,'context',f.context,'reviewToken',candidate_operations.leave_review_token(f.id),
 'actions',jsonb_build_object('canResolve',f.review_status='pending' AND (f.context->>'sourceAvailable')::boolean AND ((f.before_snapshot->>'ends_at')::timestamptz<=statement_timestamp() OR (f.context->'currentShift'->>'cancelled')::boolean OR (f.context->'currentShift'->>'ends_at')::timestamptz<=statement_timestamp()),
 'canRecordAttendance',(f.context->>'sameCurrentPerson')::boolean AND (f.context->'currentShift'->>'published')::boolean AND NOT (f.context->'currentShift'->>'cancelled')::boolean AND candidate_operations.attendance_allowed(p_actor,f.restaurant_id,f.context->'currentShift'->>'department'),
 'blockedReason',CASE WHEN f.review_status='resolved' THEN 'resolved' WHEN NOT (f.context->>'sourceAvailable')::boolean THEN 'source_unavailable'
 WHEN (f.before_snapshot->>'ends_at')::timestamptz>statement_timestamp() AND NOT (f.context->'currentShift'->>'cancelled')::boolean AND (f.context->'currentShift'->>'ends_at')::timestamptz>statement_timestamp() THEN 'future_shift' ELSE '' END),
 'evidenceOptions',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'id',e.id,'revision',e.revision,'label',e.label) ORDER BY e.updated_at DESC,e.id),'[]') FROM (SELECT * FROM evidence ORDER BY updated_at DESC,id LIMIT 100) e),
 'moreEvidence',(SELECT count(*)>100 FROM evidence),'resolution',candidate_operations.leave_review_resolution_json(p_actor,f.id),
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('revision',e.revision,'action','leave.resolve','actorId',e.actor_id,'actorPersonId',e.actor_person_id,'actorName',ap.name,'note',e.note,'at',e.recorded_at,'resolution',candidate_operations.leave_review_resolution_json(p_actor,f.id)) ORDER BY e.revision),'[]') FROM candidate_operations.leave_review_events e JOIN candidate_identity.people ap ON ap.id=e.actor_person_id WHERE e.flag_id=f.id)))
 FROM item f JOIN candidate_identity.people p ON p.id=f.person_id;
$$;
CREATE FUNCTION candidate_operations.list_leave_reviews(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_status text DEFAULT 'pending') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;selected uuid[];next_cursor uuid;items jsonb;
BEGIN
 actor:=candidate_operations.leave_review_actor(p_subject,p_member,p_restaurant);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_status IS NULL OR p_status NOT IN ('pending','resolved','all') OR (p_from IS NULL)<>(p_to IS NULL)
 OR p_from IS NOT NULL AND (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_query'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT f.id FROM candidate_operations.time_off_shift_flags f WHERE f.restaurant_id=p_restaurant AND (p_after IS NULL OR f.id>p_after)
 AND (p_from IS NULL OR f.shift_local_date BETWEEN p_from AND p_to) AND (p_status='all' OR f.review_status=p_status) AND candidate_operations.leave_review_allowed(actor.id,f.id) ORDER BY f.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(candidate_operations.leave_review_json(actor.id,id) ORDER BY id),'[]') INTO items FROM candidate_operations.time_off_shift_flags WHERE id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'rangeComplete',next_cursor IS NULL,'from',p_from,'to',p_to,'status',p_status,'leaveReviewRevision',(SELECT leave_review_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
END;
$$;
CREATE FUNCTION candidate_operations.read_leave_review(p_subject text,p_member uuid,p_restaurant text,p_flag uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;item jsonb;
BEGIN
 actor:=candidate_operations.leave_review_actor(p_subject,p_member,p_restaurant);
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags WHERE id=p_flag AND restaurant_id=p_restaurant) OR NOT candidate_operations.leave_review_allowed(actor.id,p_flag)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_denied'; END IF;
 item:=candidate_operations.leave_review_json(actor.id,p_flag);RETURN item;
END;
$$;
CREATE FUNCTION candidate_operations.leave_review_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;f candidate_operations.time_off_shift_flags;previous candidate_operations.time_off_shift_flags;receipt candidate_operations.command_receipts;
 input jsonb;context jsonb;v jsonb;evidence_refs jsonb:='[]';version integer;origin text;at timestamptz;actor_name text;result jsonb;workspace_revision integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 actor:=candidate_operations.leave_review_actor(p_subject,p_member,p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_command'; END IF;
 -- Original receipt lookup precedes mutable status, source and evidence checks.
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF NOT candidate_operations.leave_review_allowed(actor.id,(receipt.result->>'recordId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF p_payload->>'action' IS DISTINCT FROM 'leave.resolve' OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[12]$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_command'; END IF;
 SELECT q.restaurant_id INTO origin FROM candidate_operations.time_off_shift_flags flag JOIN candidate_operations.time_off_references q ON q.id=flag.request_id WHERE flag.id=(p_payload->>'recordId')::uuid AND flag.restaurant_id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_denied'; END IF;
 -- NOWAIT origin coordination protects approved facts/identity and avoids cross-store lock inversion.
 IF origin<>p_restaurant THEN PERFORM candidate_operations.lock_scope(origin,true); END IF;
 SELECT * INTO f FROM candidate_operations.time_off_shift_flags WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT candidate_operations.leave_review_allowed(actor.id,f.id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_denied'; END IF;
 IF f.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF f.review_status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='leave_review_resolved'; END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['note','reviewToken','evidence'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('note','reviewToken','evidence'))
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'note')) NOT BETWEEN 1 AND 2000
 OR jsonb_typeof(input->'reviewToken') IS DISTINCT FROM 'string' OR input->>'reviewToken' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(input->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'evidence')>20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_fields'; END IF;
 context:=candidate_operations.leave_review_context(f.id);at:=clock_timestamp();
 IF NOT (context->>'sourceAvailable')::boolean THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='leave_review_source_unavailable'; END IF;
 IF candidate_operations.leave_review_token(f.id)<>input->>'reviewToken' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='leave_review_changed'; END IF;
 IF (f.before_snapshot->>'ends_at')::timestamptz>at AND NOT (context->'currentShift'->>'cancelled')::boolean AND (context->'currentShift'->>'ends_at')::timestamptz>at
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='leave_review_source_unavailable'; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(input->'evidence') LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['kind','id','revision'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('kind','id','revision'))
  OR v->>'kind' IS NULL OR v->>'kind' NOT IN ('attendance','correction') OR jsonb_typeof(v->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'revision') IS DISTINCT FROM 'number' OR v->>'revision' !~ '^[1-9][0-9]{0,2}$|^1000$'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(evidence_refs) e WHERE e->>'kind'=v->>'kind' AND e->>'id'=v->>'id') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leave_review_evidence'; END IF;
  IF NOT candidate_operations.leave_review_evidence_allowed(actor.id,f.id,v->>'kind',(v->>'id')::uuid) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leave_review_evidence_denied'; END IF;
  IF v->>'kind'='attendance' THEN SELECT revision INTO version FROM candidate_operations.attendance_entries WHERE id=(v->>'id')::uuid;
  ELSE SELECT revision INTO version FROM candidate_operations.completed_shift_corrections WHERE id=(v->>'id')::uuid; END IF;
  IF version<>(v->>'revision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='leave_review_evidence_changed'; END IF;
  evidence_refs:=evidence_refs||jsonb_build_array(v);
 END LOOP;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 previous:=f;SELECT name INTO actor_name FROM candidate_identity.people WHERE id=actor.person_id;
 f.resolution:=jsonb_build_object('kind',CASE WHEN (f.before_snapshot->>'published')::boolean THEN 'reviewed' ELSE 'planning-history' END,'reviewerId',actor.id,'reviewerPersonId',actor.person_id,'reviewerNameAtEntry',actor_name,'reviewedAt',at,'note',candidate_operations.attendance_text(input->>'note'),'evidence',evidence_refs);
 UPDATE candidate_operations.time_off_shift_flags SET review_status='resolved',revision=2,resolution=f.resolution WHERE id=f.id RETURNING * INTO f;
 INSERT INTO candidate_operations.leave_review_events VALUES(f.id,p_restaurant,2,actor.id,actor.person_id,actor_name,f.resolution->>'note',context,to_jsonb(previous),to_jsonb(f),at);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO workspace_revision;
 result:=jsonb_build_object('recordId',f.id,'revision',f.revision,'workspaceRevision',workspace_revision,'requestId',p_request,'appliedAt',at,'replayed',false,'reviewStatus','resolved','leaveReviewRevision',(SELECT leave_review_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.leave_review_allowed(uuid,uuid),candidate_operations.leave_review_actor(text,uuid,text),candidate_operations.leave_review_evidence_allowed(uuid,uuid,text,uuid),candidate_operations.leave_review_resolution_json(uuid,uuid),candidate_operations.leave_review_json(uuid,uuid) FROM PUBLIC,candidate_runtime;
REVOKE ALL ON FUNCTION candidate_operations.list_leave_reviews(text,uuid,text,uuid,integer,date,date,text),candidate_operations.read_leave_review(text,uuid,text,uuid),candidate_operations.leave_review_command(text,uuid,text,uuid,jsonb) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.list_leave_reviews(text,uuid,text,uuid,integer,date,date,text),candidate_operations.read_leave_review(text,uuid,text,uuid),candidate_operations.leave_review_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
COMMIT;
