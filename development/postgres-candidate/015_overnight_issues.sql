BEGIN;
ALTER TABLE candidate_operations.leadership_references ADD UNIQUE(id,restaurant_id);
CREATE TABLE candidate_operations.overnight_issues(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL,department text NOT NULL,title text NOT NULL,detail text NOT NULL,
 owner_id uuid NOT NULL,outgoing_id uuid NOT NULL,incoming_id uuid NOT NULL,outgoing_leadership_id uuid NOT NULL,incoming_leadership_id uuid NOT NULL,
 due timestamptz NOT NULL,priority text NOT NULL CHECK(priority IN ('routine','urgent')),phase text NOT NULL CHECK(phase IN ('offered','disputed','accepted','resolved','cancelled')),
 revision integer NOT NULL DEFAULT 1,recovered boolean NOT NULL DEFAULT false,UNIQUE(id,restaurant_id),
 FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),FOREIGN KEY(outgoing_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),FOREIGN KEY(incoming_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(outgoing_leadership_id,restaurant_id) REFERENCES candidate_operations.leadership_references(id,restaurant_id),FOREIGN KEY(incoming_leadership_id,restaurant_id) REFERENCES candidate_operations.leadership_references(id,restaurant_id)
);
CREATE TABLE candidate_operations.overnight_events(issue_id uuid NOT NULL REFERENCES candidate_operations.overnight_issues(id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),action text NOT NULL,note text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(issue_id,revision));
CREATE TABLE candidate_operations.overnight_outbox(issue_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),message text NOT NULL,PRIMARY KEY(issue_id,revision,recipient_id),FOREIGN KEY(issue_id,revision) REFERENCES candidate_operations.overnight_events(issue_id,revision));
REVOKE ALL ON candidate_operations.overnight_issues,candidate_operations.overnight_events,candidate_operations.overnight_outbox FROM PUBLIC;
CREATE FUNCTION candidate_operations.overnight_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; incoming candidate_identity.memberships; issue candidate_operations.overnight_issues; outgoing candidate_operations.leadership_references; opening candidate_operations.leadership_references;
 receipt candidate_operations.command_receipts; input jsonb; action text; step text; note text; scope_revision integer; result jsonb; targets uuid[]; escalation uuid[]; previous_owner uuid; previous_incoming uuid;
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';step:=input->>'step';
 IF action IS NULL OR action NOT IN ('handoff.create','handoff.transition') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','recordId','expectedRevision','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_overnight_command'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 IF action='handoff.transition' THEN
  IF NOT input ?& ARRAY['step','note'] OR step IS NULL OR step NOT IN ('accept','dispute','offer','recover','resolve','cancel') OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note','incomingId','incomingLeadershipId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_overnight_command'; END IF;
  SELECT * INTO issue FROM candidate_operations.overnight_issues WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='issue_denied'; END IF;
  IF NOT candidate_operations.task_manager(actor.id,p_restaurant,issue.department) OR step IN ('accept','dispute') AND actor.id<>issue.incoming_id OR step IN ('offer','resolve','cancel') AND actor.id<>issue.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 ELSE
  IF NOT candidate_operations.task_manager(actor.id,p_restaurant,actor.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF action='handoff.create' THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR NOT input ?& ARRAY['title','detail','outgoingLeadershipId','incomingLeadershipId','incomingId','priority','safeToDefer'] OR input->'safeToDefer' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','outgoingLeadershipId','incomingLeadershipId','incomingId','priority','safeToDefer'))
  OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE f.key<>'safeToDefer' AND jsonb_typeof(f.value)<>'string') OR input->>'priority' NOT IN ('routine','urgent') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_safe_deferral'; END IF;
  SELECT * INTO outgoing FROM candidate_operations.leadership_references WHERE id=(input->>'outgoingLeadershipId')::uuid AND restaurant_id=p_restaurant AND member_id=actor.id AND department=actor.department AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
  issue.department:=actor.department;issue.outgoing_id:=actor.id;issue.owner_id:=actor.id;issue.outgoing_leadership_id:=outgoing.id;issue.priority:=input->>'priority';step:='offered';note:=btrim(input->>'detail');
  IF length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR length(note) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_text'; END IF;
 ELSE
  IF issue.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  note:=btrim(input->>'note');IF length(note) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
 END IF;
 previous_owner:=issue.owner_id;previous_incoming:=issue.incoming_id;
 IF action='handoff.create' OR step IN ('offer','recover') THEN
  SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR incoming.id=actor.id OR NOT candidate_operations.task_manager(incoming.id,p_restaurant,issue.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  SELECT * INTO opening FROM candidate_operations.leadership_references WHERE id=(input->>'incomingLeadershipId')::uuid AND restaurant_id=p_restaurant AND member_id=incoming.id AND department=issue.department AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
  IF step='recover' THEN
   IF issue.phase<>'accepted' OR incoming.id=issue.owner_id OR opening.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;issue.owner_id:=actor.id;issue.recovered:=true;
  ELSE
   IF action<>'handoff.create' AND issue.phase NOT IN ('offered','disputed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF action<>'handoff.create' THEN SELECT * INTO outgoing FROM candidate_operations.leadership_references WHERE id=issue.outgoing_leadership_id; END IF;
   IF opening.starts_at<outgoing.ends_at OR issue.recovered AND opening.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
  END IF;
  issue.incoming_id:=incoming.id;issue.incoming_leadership_id:=opening.id;issue.due:=opening.starts_at;issue.phase:='offered';
 ELSIF step IN ('accept','dispute') THEN
  SELECT * INTO opening FROM candidate_operations.leadership_references WHERE id=issue.incoming_leadership_id AND restaurant_id=p_restaurant AND member_id=actor.id AND department=issue.department AND active FOR SHARE;
  IF NOT FOUND OR issue.recovered AND opening.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
  IF issue.phase<>'offered' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF step='accept' THEN issue.phase:='accepted';issue.owner_id:=actor.id;ELSE issue.phase:='disputed';END IF;
 ELSE
  IF step='resolve' AND issue.phase<>'accepted' OR step='cancel' AND issue.phase NOT IN ('offered','disputed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;issue.phase:=CASE step WHEN 'resolve' THEN 'resolved' ELSE 'cancelled' END;
 END IF;
 IF issue.priority='urgent' AND (action='handoff.create' OR step='recover') THEN
  PERFORM 1 FROM candidate_identity.membership_capabilities ORDER BY membership_id,capability FOR SHARE;
  SELECT array_agg(m.id) INTO escalation FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND (m.department=issue.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND capability='location.manage' AND active)) AND EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND capability='operations.escalation' AND active);
  IF escalation IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='escalation_recipient_required'; END IF;
 END IF;
 IF action='handoff.create' THEN
  INSERT INTO candidate_operations.overnight_issues(restaurant_id,department,title,detail,owner_id,outgoing_id,incoming_id,outgoing_leadership_id,incoming_leadership_id,due,priority,phase) VALUES(p_restaurant,issue.department,btrim(input->>'title'),note,issue.owner_id,issue.outgoing_id,issue.incoming_id,issue.outgoing_leadership_id,issue.incoming_leadership_id,issue.due,issue.priority,issue.phase) RETURNING * INTO issue;
 ELSE UPDATE candidate_operations.overnight_issues SET owner_id=issue.owner_id,incoming_id=issue.incoming_id,incoming_leadership_id=issue.incoming_leadership_id,due=issue.due,phase=issue.phase,recovered=issue.recovered,revision=revision+1 WHERE id=issue.id RETURNING * INTO issue;END IF;
 INSERT INTO candidate_operations.overnight_events(issue_id,revision,actor_id,action,note) VALUES(issue.id,issue.revision,actor.id,step,note);
 targets:=ARRAY[issue.outgoing_id,issue.incoming_id,previous_owner,previous_incoming,issue.owner_id]||coalesce(escalation,'{}');
 INSERT INTO candidate_operations.overnight_outbox(issue_id,revision,recipient_id,message) SELECT issue.id,issue.revision,id,issue.title||': '||issue.phase FROM (SELECT DISTINCT unnest(targets) id) recipients WHERE id IS NOT NULL;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',issue.id,'revision',issue.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$body$;
CREATE FUNCTION candidate_operations.read_overnight(p_subject text,p_member uuid,p_restaurant text,p_issue uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; issue candidate_operations.overnight_issues; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO issue FROM candidate_operations.overnight_issues WHERE id=p_issue AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT(actor.id IN (issue.owner_id,issue.outgoing_id,issue.incoming_id) OR candidate_operations.task_manager(actor.id,p_restaurant,issue.department)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='issue_denied'; END IF;
 SELECT jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at) ORDER BY revision) INTO history FROM candidate_operations.overnight_events WHERE issue_id=p_issue;
 RETURN jsonb_build_object('id',issue.id,'kind','handoff','locationId',p_restaurant,'area',issue.department,'ownerId',issue.owner_id,'revision',issue.revision,'data',jsonb_build_object('title',issue.title,'detail',issue.detail,'outgoingId',issue.outgoing_id,'incomingId',issue.incoming_id,'outgoingLeadershipId',issue.outgoing_leadership_id,'incomingLeadershipId',issue.incoming_leadership_id,'due',issue.due,'priority',issue.priority,'phase',issue.phase,'history',history));
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.overnight_command(text,uuid,text,uuid,jsonb),candidate_operations.read_overnight(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.overnight_command(text,uuid,text,uuid,jsonb),candidate_operations.read_overnight(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
