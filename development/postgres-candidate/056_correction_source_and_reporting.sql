-- Corrective candidate source durability, effective reporting dates and known job validation.
-- Published 001-055 and historical events remain unchanged. No permission grants or owner-policy change.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.correction_source_key(p_snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('revision',p_snapshot->'revision','member_id',p_snapshot->'member_id',
  'department',p_snapshot->'department','starts_at',p_snapshot->'starts_at','ends_at',p_snapshot->'ends_at',
  'position',p_snapshot->'position','published',p_snapshot->'published','cancelled',p_snapshot->'cancelled');
$$;
REVOKE ALL ON FUNCTION candidate_operations.correction_source_key(jsonb) FROM PUBLIC,candidate_runtime;
ALTER TABLE candidate_operations.completed_shift_corrections ADD COLUMN source_key jsonb;
-- Derive only from captured evidence, never from the current (possibly changed) source row.
UPDATE candidate_operations.completed_shift_corrections SET source_key=candidate_operations.correction_source_key(original_snapshot);
ALTER TABLE candidate_operations.completed_shift_corrections ALTER COLUMN source_key SET NOT NULL;
ALTER TABLE candidate_operations.completed_shift_corrections ADD CONSTRAINT completed_correction_source_key_shape CHECK(jsonb_typeof(source_key)='object' AND source_key ?& ARRAY['revision','member_id','department','starts_at','ends_at','position','published','cancelled']);
CREATE OR REPLACE FUNCTION candidate_operations.correction_position_allowed(p_restaurant text,p_original text,p_position text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT p_position=p_original OR EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e
  JOIN candidate_identity.memberships m ON m.id=e.member_id
  WHERE m.restaurant_id=p_restaurant AND e.active AND e.job=p_position);
$$;
REVOKE ALL ON FUNCTION candidate_operations.correction_position_allowed(text,text,text) FROM PUBLIC,candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.guard_completed_correction_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
 IF ROW(NEW.id,NEW.restaurant_id,NEW.shift_id,NEW.source_revision,NEW.member_id,NEW.person_id,NEW.department,NEW.employee_name_at_entry,NEW.original_snapshot,NEW.source_key,NEW.timezone,NEW.shift_local_date)
 IS DISTINCT FROM ROW(OLD.id,OLD.restaurant_id,OLD.shift_id,OLD.source_revision,OLD.member_id,OLD.person_id,OLD.department,OLD.employee_name_at_entry,OLD.original_snapshot,OLD.source_key,OLD.timezone,OLD.shift_local_date)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='correction_origin_immutable'; END IF;RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION candidate_operations.correction_source_matches(p_rec candidate_operations.completed_shift_corrections) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id AND m.restaurant_id=s.restaurant_id
 WHERE s.id=p_rec.shift_id AND s.restaurant_id=p_rec.restaurant_id AND s.published AND NOT s.cancelled AND m.person_id=p_rec.person_id
 AND candidate_operations.correction_source_key(to_jsonb(s))=p_rec.source_key);
$$;

CREATE OR REPLACE FUNCTION candidate_operations.correction_actions(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('canPropose',r.status<>'pending' AND r.revision<1000 AND candidate_operations.correction_source_matches(r)
  AND (m.person_id=r.person_id OR candidate_operations.correction_notice_recipients(r.restaurant_id) IS NOT NULL),
 'canApprove',r.status='pending' AND r.revision<1000 AND m.person_id<>r.author_person_id AND m.person_id<>r.person_id
  AND r.proposal_base_revision=r.applied_revision AND candidate_operations.correction_source_matches(r)
  AND EXISTS(SELECT 1 FROM candidate_identity.memberships a WHERE a.id=r.author_id AND a.person_id=r.author_person_id AND candidate_operations.correction_allowed(a.id,r.restaurant_id,r.department))
  AND candidate_operations.correction_position_allowed(r.restaurant_id,r.original_snapshot->>'position',r.proposal_summary->>'position')
  AND candidate_operations.correction_notice_recipients(r.restaurant_id) IS NOT NULL,
 'canReject',r.status='pending' AND r.revision<1000 AND m.person_id<>r.author_person_id AND m.person_id<>r.person_id,
 'canWithdraw',r.status='pending' AND r.revision<1000 AND m.person_id=r.author_person_id)
 FROM candidate_operations.completed_shift_corrections r JOIN candidate_identity.memberships m ON m.id=p_actor
 WHERE r.id=p_id AND candidate_operations.correction_allowed(p_actor,r.restaurant_id,r.department);
$$;

CREATE OR REPLACE FUNCTION candidate_operations.completed_shift_correction_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships; rec candidate_operations.completed_shift_corrections; previous candidate_operations.completed_shift_corrections;
 source candidate_operations.shift_references; receipt candidate_operations.command_receipts; input jsonb; action text; result jsonb; summary jsonb;
 creating boolean; proposing boolean; applying boolean:=false; at timestamptz; first_instant timestamptz; last_instant timestamptz; note text; actor_name text; recipients uuid[]; workspace_revision integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 actor:=candidate_operations.correction_actor(p_subject,p_member,p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_command'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.completed_shift_corrections WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT candidate_operations.correction_allowed(actor.id,p_restaurant,rec.department)
   OR NOT EXISTS(SELECT 1 FROM candidate_operations.completed_shift_correction_events WHERE correction_id=rec.id AND revision=(receipt.result->>'revision')::integer AND actor_person_id=actor.person_id)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 action:=p_payload->>'action';input:=p_payload->'input';proposing:=action='correction.propose';at:=clock_timestamp();SELECT name INTO actor_name FROM candidate_identity.people WHERE id=actor.person_id;
 IF action IS NULL OR action NOT IN ('correction.propose','correction.approve','correction.reject','correction.withdraw') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_command'; END IF;
 IF proposing THEN
  IF p_payload ?| ARRAY['recordId','expectedRevision'] OR NOT input ?& ARRAY['shiftId','shiftRevision','expectedCorrectionRevision','start','end','position','reason']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('shiftId','shiftRevision','expectedCorrectionRevision','start','end','position','reason')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_fields'; END IF;
  SELECT * INTO source FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.correction_allowed(actor.id,p_restaurant,source.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_denied'; END IF;
  IF NOT source.published OR source.cancelled OR source.ends_at>at THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_source_ineligible'; END IF;
  IF jsonb_typeof(input->'shiftRevision') IS DISTINCT FROM 'number' OR input->>'shiftRevision' !~ '^[1-9][0-9]{0,9}$'
   OR jsonb_typeof(input->'expectedCorrectionRevision') IS DISTINCT FROM 'number' OR input->>'expectedCorrectionRevision' !~ '^(0|[1-9][0-9]{0,3})$'
   OR (input->>'expectedCorrectionRevision')::integer>1000 OR (input->>'shiftRevision')::bigint>2147483646 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF (input->>'shiftRevision')::bigint<>source.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.completed_shift_corrections WHERE shift_id=source.id AND restaurant_id=p_restaurant FOR UPDATE;
  creating:=NOT FOUND;
  IF (input->>'expectedCorrectionRevision')::integer<>(CASE WHEN creating THEN 0 ELSE rec.revision END) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF creating THEN
   rec.id:=gen_random_uuid();rec.restaurant_id:=p_restaurant;rec.shift_id:=source.id;rec.source_revision:=source.revision;rec.member_id:=source.member_id;rec.department:=source.department;
   SELECT m.person_id,p.name INTO rec.person_id,rec.employee_name_at_entry FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE m.id=source.member_id;
   rec.original_snapshot:=to_jsonb(source);rec.source_key:=candidate_operations.correction_source_key(rec.original_snapshot);SELECT timezone INTO rec.timezone FROM candidate_identity.restaurants WHERE id=p_restaurant;rec.shift_local_date:=(source.starts_at AT TIME ZONE rec.timezone)::date;
   rec.effective_summary:=jsonb_build_object('start',source.starts_at,'end',source.ends_at,'position',source.position);rec.applied_revision:=0;rec.revision:=0;
  ELSE
   previous:=rec;
   IF NOT candidate_operations.correction_source_matches(rec) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_source_conflict'; END IF;
   IF rec.status='pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_pending'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['start','end']) k WHERE jsonb_typeof(input->k) IS DISTINCT FROM 'string' OR input->>k !~ '^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$')
   OR jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'position')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(input->'reason') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'reason')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_value'; END IF;
  IF NOT candidate_operations.correction_position_allowed(p_restaurant,rec.original_snapshot->>'position',candidate_operations.attendance_text(input->>'position')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='correction_position_unknown'; END IF;
  first_instant:=(input->>'start')::timestamptz;last_instant:=(input->>'end')::timestamptz;
  IF last_instant<=first_instant OR last_instant-first_instant>interval '24 hours' OR last_instant>at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_period'; END IF;
  summary:=jsonb_build_object('start',first_instant,'end',last_instant,'position',candidate_operations.attendance_text(input->>'position'));
  IF summary=rec.effective_summary THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_no_change'; END IF;
  rec.proposal_summary:=summary;rec.proposal_base_revision:=rec.applied_revision;rec.author_id:=actor.id;rec.author_person_id:=actor.person_id;rec.author_name_at_entry:=actor_name;
  rec.reason:=candidate_operations.attendance_text(input->>'reason');rec.decision_note:='';note:=rec.reason;
  applying:=actor.person_id<>rec.person_id;rec.status:=CASE WHEN applying THEN 'applied' ELSE 'pending' END;
 ELSE
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision'] OR NOT input ? 'note' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note')
   OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(candidate_operations.attendance_text(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_fields'; END IF;
  SELECT * INTO rec FROM candidate_operations.completed_shift_corrections WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR NOT candidate_operations.correction_allowed(actor.id,p_restaurant,rec.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_denied'; END IF;previous:=rec;creating:=false;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]{0,3}$' OR (p_payload->>'expectedRevision')::integer>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF (p_payload->>'expectedRevision')::integer<>rec.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_not_pending'; END IF;
  IF action='correction.withdraw' THEN
   IF actor.person_id<>rec.author_person_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_author_required'; END IF;rec.status:='withdrawn';
  ELSE
   IF actor.person_id=rec.author_person_id OR actor.person_id=rec.person_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_independent_required'; END IF;
   IF action='correction.approve' THEN
    IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships a WHERE a.id=rec.author_id AND a.person_id=rec.author_person_id AND candidate_operations.correction_allowed(a.id,p_restaurant,rec.department)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='correction_author_denied'; END IF;
    IF NOT candidate_operations.correction_source_matches(rec) OR rec.proposal_base_revision<>rec.applied_revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_source_conflict'; END IF;
    IF NOT candidate_operations.correction_position_allowed(p_restaurant,rec.original_snapshot->>'position',rec.proposal_summary->>'position') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='correction_position_unknown'; END IF;
    IF (rec.proposal_summary->>'end')::timestamptz>at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_period'; END IF;rec.status:='applied';applying:=true;
   ELSE rec.status:='rejected';END IF;
  END IF;
  note:=candidate_operations.attendance_text(input->>'note');rec.decision_note:=note;
 END IF;
 IF rec.revision>=1000 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='correction_history_limit'; END IF;
 rec.revision:=rec.revision+1;rec.updated_at:=at;
 IF applying THEN
  recipients:=candidate_operations.correction_notice_recipients(p_restaurant);
  IF recipients IS NULL OR cardinality(recipients)=0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ownership_notice_unresolved'; END IF;
  rec.effective_summary:=rec.proposal_summary;rec.applied_revision:=rec.revision;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 IF creating THEN INSERT INTO candidate_operations.completed_shift_corrections SELECT rec.*;
 ELSE UPDATE candidate_operations.completed_shift_corrections SET effective_summary=rec.effective_summary,applied_revision=rec.applied_revision,proposal_summary=rec.proposal_summary,
  proposal_base_revision=rec.proposal_base_revision,author_id=rec.author_id,author_person_id=rec.author_person_id,author_name_at_entry=rec.author_name_at_entry,reason=rec.reason,decision_note=rec.decision_note,status=rec.status,revision=rec.revision,updated_at=at WHERE id=rec.id;END IF;
 INSERT INTO candidate_operations.completed_shift_correction_events VALUES(rec.id,p_restaurant,rec.revision,actor.id,actor.person_id,actor_name,action,note,CASE WHEN creating THEN NULL ELSE to_jsonb(previous) END,to_jsonb(rec),at);
 IF applying THEN INSERT INTO candidate_operations.completed_shift_correction_outbox SELECT rec.id,rec.revision,p_restaurant,person,
  jsonb_build_object('kind','completed-shift-correction','correctionId',rec.id,'shiftId',rec.shift_id,'revision',rec.revision) FROM unnest(recipients) person;END IF;
 UPDATE candidate_operations.scope_coordination SET correction_revision=correction_revision+1 WHERE restaurant_id=p_restaurant;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO workspace_revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',workspace_revision,'requestId',p_request,'appliedAt',at,'replayed',false,'correctionStatus',rec.status,'effectiveRevision',rec.applied_revision);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION candidate_operations.completed_correction_json(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('id',r.id,'kind','shift-correction','locationId',r.restaurant_id,'ownerId',r.member_id,'area',r.department,'revision',r.revision,'updatedAt',r.updated_at,
 'data',jsonb_build_object('shiftId',r.shift_id,'sourceRevision',r.source_revision,'currentSourceRevision',(SELECT revision FROM candidate_operations.shift_references WHERE id=r.shift_id),'employeeName',p.name,'employeeNameAtEntry',r.employee_name_at_entry,'historicalNameLabel','name at time of entry',
 'original',r.original_snapshot,'timezone',r.timezone,'shiftLocalDate',r.shift_local_date,'effectiveLocalDate',((r.effective_summary->>'start')::timestamptz AT TIME ZONE r.timezone)::date,'effectiveSummary',r.effective_summary,'appliedRevision',r.applied_revision,
 'proposal',r.proposal_summary,'proposalBaseRevision',r.proposal_base_revision,'authorId',r.author_id,'authorName',a.name,'authorNameAtEntry',r.author_name_at_entry,
 'reason',r.reason,'decisionNote',r.decision_note,'status',r.status,'actions',candidate_operations.correction_actions(p_actor,r.id),
 'warnings',jsonb_build_object('sourceChanged',NOT candidate_operations.correction_source_matches(r),
 'hasOriginalTasks',EXISTS(SELECT 1 FROM candidate_operations.tasks t WHERE t.shift_id=r.shift_id),
 'hasOriginalClosings',EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=r.shift_id))))
 FROM candidate_operations.completed_shift_corrections r JOIN candidate_identity.people p ON p.id=r.person_id JOIN candidate_identity.people a ON a.id=r.author_person_id WHERE r.id=p_id;
$$;

CREATE OR REPLACE FUNCTION candidate_operations.completed_shift_review_json(p_actor uuid,p_shift uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('shiftId',s.id,'sourceRevision',coalesce(r.source_revision,s.revision),'currentSourceRevision',s.revision,'ownerId',coalesce(r.member_id,s.member_id),'area',coalesce(r.department,s.department),'employeeName',(SELECT name FROM candidate_identity.people WHERE id=coalesce(r.person_id,m.person_id)),
 'originalSummary',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('start',r.original_snapshot->'starts_at','end',r.original_snapshot->'ends_at','position',r.original_snapshot->'position') ELSE jsonb_build_object('start',s.starts_at,'end',s.ends_at,'position',s.position) END,
 'effectiveSummary',coalesce(r.effective_summary,jsonb_build_object('start',s.starts_at,'end',s.ends_at,'position',s.position)),
 'effectiveLocalDate',(coalesce((r.effective_summary->>'start')::timestamptz,s.starts_at) AT TIME ZONE coalesce(r.timezone,scope.timezone))::date,
 'timezone',coalesce(r.timezone,scope.timezone),'recordRevision',coalesce(r.revision,0),'correction',candidate_operations.completed_correction_json(p_actor,r.id),
 'canPropose',CASE WHEN r.id IS NOT NULL THEN (candidate_operations.correction_actions(p_actor,r.id)->>'canPropose')::boolean ELSE s.published AND NOT s.cancelled AND s.ends_at<=statement_timestamp() AND (actor.person_id=m.person_id OR candidate_operations.correction_notice_recipients(s.restaurant_id) IS NOT NULL) END)
 FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id JOIN candidate_identity.people p ON p.id=m.person_id
 JOIN candidate_identity.restaurants scope ON scope.id=s.restaurant_id JOIN candidate_identity.memberships actor ON actor.id=p_actor
 LEFT JOIN candidate_operations.completed_shift_corrections r ON r.shift_id=s.id WHERE s.id=p_shift;
$$;
COMMIT;
