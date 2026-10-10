BEGIN;
CREATE TABLE candidate_operations.staffing_needs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),department text NOT NULL,owner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),position text NOT NULL CHECK(length(position) BETWEEN 1 AND 100),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 minimum integer NOT NULL CHECK(minimum BETWEEN 1 AND 100),source text NOT NULL CHECK(length(source) BETWEEN 1 AND 2000),
 status text NOT NULL CHECK(status IN ('draft','approved','retired')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),copied_from jsonb,
 CHECK(ends_at>starts_at AND ends_at-starts_at<=interval '24 hours'),FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.staffing_events(
 staffing_id uuid NOT NULL REFERENCES candidate_operations.staffing_needs(id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),action text NOT NULL,note text NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(staffing_id,revision)
);
REVOKE ALL ON candidate_operations.staffing_needs,candidate_operations.staffing_events FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.staffing_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; rec candidate_operations.staffing_needs; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 input jsonb; action text; department_name text; cap text; result jsonb; note text; creating boolean;
BEGIN
 action:=p_payload->>'action';input:=p_payload->'input';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(action,'') NOT IN ('staffing.save','staffing.approve','staffing.retire') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.staffing_needs WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  cap:=CASE WHEN action='staffing.save' THEN 'schedule.manage' ELSE 'schedule.publish' END;
  IF NOT FOUND OR NOT (candidate_operations.goal_authorized(actor.id,rec.department,cap)) THEN
   -- Retirement replay uses the immutable prior event, never caller-provided status.
   IF action<>'staffing.retire' OR NOT EXISTS(SELECT 1 FROM candidate_operations.staffing_events e WHERE e.staffing_id=rec.id AND e.revision=(receipt.result->>'revision')::integer-1 AND e.data->>'status'='draft') OR NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  END IF;
  IF action='staffing.save' AND NOT candidate_operations.goal_authorized(actor.id,receipt.payload->'input'->>'area','schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 creating:=action='staffing.save' AND NOT p_payload ? 'recordId';
 IF NOT creating THEN
  SELECT * INTO rec FROM candidate_operations.staffing_needs WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='staffing_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 END IF;
 IF action='staffing.save' THEN
  IF NOT input ?& ARRAY['area','title','position','start','end','minimum','source'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('area','title','position','start','end','minimum','source','note')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_fields'; END IF;
  department_name:=btrim(input->>'area');
  IF NOT candidate_operations.goal_authorized(actor.id,department_name,'schedule.manage') OR NOT creating AND NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF NOT creating AND rec.status<>'draft' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF creating AND p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND department=department_name AND (active OR schedule_only)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_department'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(input) e WHERE e.key<>'minimum' AND jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR length(btrim(input->>'position')) NOT BETWEEN 1 AND 100 OR length(btrim(input->>'source')) NOT BETWEEN 1 AND 2000 OR length(btrim(coalesce(input->>'note','')))>2000
  OR jsonb_typeof(input->'minimum') IS DISTINCT FROM 'number' OR input->>'minimum' !~ '^[1-9][0-9]*$' OR (input->>'minimum')::integer NOT BETWEEN 1 AND 100
  OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_value'; END IF;
  note:=coalesce(nullif(btrim(input->>'note'),''),'Awaiting publisher approval.');
  IF creating THEN
   INSERT INTO candidate_operations.staffing_needs(restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES(p_restaurant,department_name,actor.id,btrim(input->>'title'),btrim(input->>'position'),(input->>'start')::timestamptz,(input->>'end')::timestamptz,(input->>'minimum')::integer,btrim(input->>'source'),'draft') RETURNING * INTO rec;
  ELSE
   UPDATE candidate_operations.staffing_needs SET department=department_name,title=btrim(input->>'title'),position=btrim(input->>'position'),starts_at=(input->>'start')::timestamptz,ends_at=(input->>'end')::timestamptz,minimum=(input->>'minimum')::integer,source=btrim(input->>'source'),revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
  END IF;
 ELSE
  IF NOT input ? 'note' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('note','confirmed')) OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 OR action='staffing.retire' AND input ? 'confirmed' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_review'; END IF;
  IF NOT (candidate_operations.goal_authorized(actor.id,rec.department,'schedule.publish') OR action='staffing.retire' AND rec.status='draft' AND candidate_operations.goal_authorized(actor.id,rec.department,'schedule.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF action='staffing.approve' AND rec.status<>'draft' OR action='staffing.retire' AND rec.status='retired' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF action='staffing.approve' THEN
   IF input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='staffing_confirmation_required'; END IF;
   IF EXISTS(SELECT 1 FROM candidate_operations.staffing_needs n WHERE n.id<>rec.id AND n.restaurant_id=p_restaurant AND n.department=rec.department AND n.position=rec.position AND n.status='approved' AND n.starts_at<rec.ends_at AND n.ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staffing_overlap'; END IF;
  END IF;
  note:=btrim(input->>'note');UPDATE candidate_operations.staffing_needs SET status=CASE WHEN action='staffing.approve' THEN 'approved' ELSE 'retired' END,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.staffing_events VALUES(rec.id,rec.revision,actor.id,action,note,to_jsonb(rec),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.staffing_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.staffing_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
ALTER TABLE candidate_operations.publication_reviews DROP CONSTRAINT publication_reviews_no_closing_check;
CREATE FUNCTION candidate_operations.closing_publication_issues(p_shift uuid,p_restaurant text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
DECLARE s candidate_operations.shift_references; c candidate_operations.closes; standard candidate_operations.standard_references; issues jsonb:='[]';
BEGIN
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=s.id AND phase<>'cancelled' ORDER BY id LOOP
  SELECT * INTO standard FROM candidate_operations.standard_references WHERE id=c.standard_id AND restaurant_id=p_restaurant;
  IF NOT FOUND OR standard.status<>'approved' OR standard.revision<>c.standard_revision THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_instruction_changed')); END IF;
  IF c.shift_revision<>s.revision OR c.owner_id<>s.member_id OR c.department<>s.department OR c.due<s.starts_at OR c.due>s.ends_at OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=s.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher') OR NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id AND standard_id=c.standard_id AND active) OR (s.station_id IS NULL AND standard.position IS DISTINCT FROM s.position) OR (s.station_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_operations.station_references t WHERE t.id=s.station_id AND t.status='active' AND (t.setup_data->'standardIds' @> to_jsonb(ARRAY[c.standard_id::text]) OR lower(btrim(standard.position))=lower(btrim(t.title))))) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_assignment_changed')); END IF;
  IF c.manager_id=s.member_id OR NOT candidate_operations.closing_manager(c.manager_id,p_restaurant,s.department,'close.confirm') OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=c.manager_id AND capability='location.manage' AND active) AND NOT EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE member_id=c.manager_id AND restaurant_id=p_restaurant AND department=s.department AND active AND starts_at<=c.due AND ends_at>=c.due) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_manager_unavailable')); END IF;
  IF c.standard_snapshot->>'verification'='senior-then-manager' AND (c.verifier_id IS NULL OR c.verifier_id IN (s.member_id,c.manager_id) OR NOT candidate_operations.closing_manager(c.verifier_id,p_restaurant,s.department,'close.verify')) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_verifier_unavailable')); END IF;
 END LOOP;
 RETURN issues;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.closing_publication_issues(uuid,text) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.read_publication_review(p_subject text,p_member uuid,p_restaurant text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; s candidate_operations.shift_references; scope_revision integer; needs jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.change')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'position',n.position,'minimum',n.minimum) ORDER BY n.id),'[]') INTO needs FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=s.department AND n.starts_at<s.ends_at AND n.ends_at>s.starts_at AND (n.status='approved' OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=s.position);
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('shiftId',s.id,'revision',s.revision,'workspaceRevision',scope_revision,'staffing',needs,'closingIssues',candidate_operations.closing_publication_issues(s.id,p_restaurant),'coverage','candidate-publication-review-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.read_publication_review(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.read_publication_review(text,uuid,text,uuid) TO candidate_runtime;
CREATE FUNCTION candidate_operations.list_staffing(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; scope_revision integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT n.id FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND (p_after IS NULL OR n.id>p_after) AND (candidate_operations.goal_authorized(actor.id,n.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.change')) ORDER BY n.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind','staffing','locationId',n.restaurant_id,'area',n.department,'ownerId',n.owner_id,'revision',n.revision,'data',jsonb_build_object('title',n.title,'position',n.position,'start',n.starts_at,'end',n.ends_at,'minimum',n.minimum,'source',n.source,'status',n.status,'history',(SELECT jsonb_agg(jsonb_build_object('actorId',e.actor_id,'action',CASE e.action WHEN 'staffing.save' THEN 'drafted' WHEN 'staffing.approve' THEN 'approved' ELSE 'retired' END,'note',e.note,'at',e.recorded_at) ORDER BY e.revision) FROM candidate_operations.staffing_events e WHERE e.staffing_id=n.id))||CASE WHEN n.copied_from IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('copiedFrom',n.copied_from) END) ORDER BY n.id),'[]') INTO items FROM candidate_operations.staffing_needs n WHERE n.id=ANY(selected[1:p_limit]);
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN cardinality(selected)>p_limit THEN selected[p_limit] ELSE NULL END,'workspaceRevision',scope_revision);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_staffing(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_staffing(text,uuid,text,uuid,integer) TO candidate_runtime;
CREATE OR REPLACE FUNCTION candidate_operations.publish_shift(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.shift_references; station candidate_operations.station_references; guide candidate_operations.standard_references;
 scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; goal candidate_operations.employee_goals;
 template jsonb; note text; result jsonb; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object' OR NOT (p_payload->'input') ? 'note'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'input') k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_publication_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
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
 IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.publication_reviews WHERE shift_id=rec.id AND shift_revision=rec.revision AND workspace_revision=scope.revision AND no_staffing AND no_closing=NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled'))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=rec.department AND n.starts_at<rec.ends_at AND n.ends_at>rec.starts_at AND (n.status='approved' OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=rec.position)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staffing_publication_review_required'; END IF;
 IF jsonb_array_length(candidate_operations.closing_publication_issues(rec.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_linked_work_held'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=rec.member_id AND restaurant_id=p_restaurant AND department=rec.department AND (active OR schedule_only) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=rec.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND id<>rec.id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND status='approved' AND starts_at<rec.ends_at AND ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
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
$body$;
REVOKE ALL ON FUNCTION candidate_operations.publish_shift(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.publish_shift(text,uuid,text,uuid,jsonb) TO candidate_runtime;

COMMIT;
