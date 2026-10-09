-- Candidate only. Reference inputs are fictional, not production standard/schedule ingestion.
BEGIN;
CREATE TABLE candidate_operations.standard_references(
 id uuid PRIMARY KEY,restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),department text NOT NULL,
 title text NOT NULL,zone text NOT NULL,position text NOT NULL,revision integer NOT NULL CHECK(revision>0),version integer NOT NULL CHECK(version>0),
 verification text NOT NULL CHECK(verification IN ('manager','senior-then-manager')),status text NOT NULL CHECK(status IN ('draft','approved','retired')),
 criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='array' AND jsonb_array_length(criteria) BETWEEN 1 AND 100),UNIQUE(id,restaurant_id)
);
CREATE TABLE candidate_operations.shift_standard_links(
 shift_id uuid NOT NULL,standard_id uuid NOT NULL,restaurant_id text NOT NULL,active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(shift_id,standard_id),FOREIGN KEY(shift_id,restaurant_id) REFERENCES candidate_operations.shift_references(id,restaurant_id),
 FOREIGN KEY(standard_id,restaurant_id) REFERENCES candidate_operations.standard_references(id,restaurant_id)
);
CREATE TABLE candidate_identity.station_clearances(
 member_id uuid NOT NULL,restaurant_id text NOT NULL,position text NOT NULL,active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(member_id,position),FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.leadership_references(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid NOT NULL,restaurant_id text NOT NULL,department text NOT NULL,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true,CHECK(ends_at>starts_at),
 FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.closes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL,shift_id uuid NOT NULL,shift_revision integer NOT NULL,
 owner_id uuid NOT NULL,department text NOT NULL,standard_id uuid NOT NULL,standard_revision integer NOT NULL,standard_snapshot jsonb NOT NULL,
 zone text NOT NULL,manager_id uuid NOT NULL,verifier_id uuid,due timestamptz NOT NULL,
 revision integer NOT NULL DEFAULT 1,phase text NOT NULL DEFAULT 'open' CHECK(phase IN ('open','correction','verification','manager-confirmation','closed','cancelled')),
 CHECK(manager_id<>owner_id),CHECK(verifier_id IS NULL OR verifier_id<>owner_id AND verifier_id<>manager_id),UNIQUE(id,restaurant_id),
 FOREIGN KEY(shift_id,restaurant_id) REFERENCES candidate_operations.shift_references(id,restaurant_id),
 FOREIGN KEY(standard_id,restaurant_id) REFERENCES candidate_operations.standard_references(id,restaurant_id),
 FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(manager_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(verifier_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE UNIQUE INDEX closing_shift_zone ON candidate_operations.closes(shift_id,zone) WHERE phase<>'cancelled';
CREATE TABLE candidate_operations.close_events(
 close_id uuid NOT NULL,restaurant_id text NOT NULL,revision integer NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,note text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(close_id,revision),
 FOREIGN KEY(close_id,restaurant_id) REFERENCES candidate_operations.closes(id,restaurant_id),FOREIGN KEY(actor_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
CREATE TABLE candidate_operations.close_notification_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),close_id uuid NOT NULL,restaurant_id text NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL,message text NOT NULL,
 UNIQUE(close_id,revision,recipient_id),FOREIGN KEY(close_id,revision) REFERENCES candidate_operations.close_events(close_id,revision),
 FOREIGN KEY(close_id,restaurant_id) REFERENCES candidate_operations.closes(id,restaurant_id),FOREIGN KEY(recipient_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA candidate_identity,candidate_operations FROM PUBLIC;
CREATE FUNCTION candidate_operations.assign_close(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; manager candidate_identity.memberships; verifier candidate_identity.memberships;
 shift candidate_operations.shift_references; standard candidate_operations.standard_references; assigned candidate_operations.closes;
 receipt candidate_operations.command_receipts; input jsonb; due_at timestamptz; note text; result jsonb; scope_revision integer;
BEGIN
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO assigned FROM candidate_operations.closes WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'close.assign' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt'))
  OR NOT input ?& ARRAY['shiftId','standardId','managerId','due','note']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('shiftId','standardId','managerId','verifierId','due','note'))
  OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_assignment'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant FOR SHARE;
 IF NOT FOUND OR shift.cancelled OR shift.released_at IS NOT NULL OR shift.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 IF NOT candidate_operations.closing_manager(actor.id,p_restaurant,shift.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO owner FROM candidate_identity.memberships WHERE id=shift.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR owner.position='Dishwasher' OR owner.department<>shift.department THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 SELECT * INTO standard FROM candidate_operations.standard_references WHERE id=(input->>'standardId')::uuid AND restaurant_id=p_restaurant AND department=shift.department AND status='approved' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='standard_denied'; END IF;
 PERFORM 1 FROM candidate_operations.shift_standard_links WHERE shift_id=shift.id AND standard_id=standard.id AND restaurant_id=p_restaurant AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_guide_denied'; END IF;
 PERFORM 1 FROM candidate_identity.station_clearances WHERE member_id=owner.id AND restaurant_id=p_restaurant AND position=standard.position AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='clearance_denied'; END IF;
 due_at:=(input->>'due')::timestamptz;note:=btrim(input->>'note');
 IF due_at<shift.starts_at OR due_at>shift.ends_at OR length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_due_or_note'; END IF;
 SELECT * INTO manager FROM candidate_identity.memberships WHERE id=(input->>'managerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR manager.id=owner.id OR NOT candidate_operations.closing_manager(manager.id,p_restaurant,shift.department,'close.confirm') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='manager_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=manager.id AND capability='location.manage' AND active;
 IF NOT FOUND THEN
  PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=manager.id AND restaurant_id=p_restaurant AND department=shift.department AND active AND starts_at<=due_at AND ends_at>=due_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
 END IF;
 IF standard.verification='senior-then-manager' THEN
  IF NOT input ? 'verifierId' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='verifier_required'; END IF;
  SELECT * INTO verifier FROM candidate_identity.memberships WHERE id=(input->>'verifierId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR verifier.id IN (owner.id,manager.id) OR NOT candidate_operations.closing_manager(verifier.id,p_restaurant,shift.department,'close.verify') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verifier_denied'; END IF;
 ELSIF input ? 'verifierId' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unexpected_verifier'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=shift.id AND zone=standard.zone AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_zone_conflict'; END IF;
 INSERT INTO candidate_operations.closes(restaurant_id,shift_id,shift_revision,owner_id,department,standard_id,standard_revision,standard_snapshot,zone,manager_id,verifier_id,due)
 VALUES(p_restaurant,shift.id,shift.revision,owner.id,shift.department,standard.id,standard.revision,
  jsonb_build_object('title',standard.title,'zone',standard.zone,'position',standard.position,'version',standard.version,'verification',standard.verification,'criteria',standard.criteria,'status','approved'),standard.zone,manager.id,verifier.id,due_at) RETURNING * INTO assigned;
 INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note) VALUES(assigned.id,p_restaurant,1,actor.id,'assigned',note);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',assigned.id,'revision',1,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF shift.published THEN
  INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message)
  SELECT assigned.id,p_restaurant,1,id,standard.title||': closing assignment' FROM (SELECT DISTINCT unnest(ARRAY[owner.id,manager.id,verifier.id]) id) recipients WHERE id IS NOT NULL;
 END IF;
 RETURN result;
END;
$body$;
CREATE FUNCTION candidate_operations.read_close(p_subject text,p_member uuid,p_restaurant text,p_close uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; assigned candidate_operations.closes; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=p_close AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (actor.id=assigned.owner_id OR actor.id=assigned.manager_id OR actor.id IS NOT DISTINCT FROM assigned.verifier_id OR candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at) ORDER BY revision),'[]') INTO history FROM candidate_operations.close_events WHERE close_id=assigned.id;
 RETURN jsonb_build_object('id',assigned.id,'kind','close','locationId',assigned.restaurant_id,'area',assigned.department,'ownerId',assigned.owner_id,'revision',assigned.revision,
  'data',jsonb_build_object('shiftId',assigned.shift_id,'standardId',assigned.standard_id,'standardRevision',assigned.standard_revision,'standard',assigned.standard_snapshot,'managerId',assigned.manager_id,'due',assigned.due,'phase',assigned.phase,'history',history)||CASE WHEN assigned.verifier_id IS NOT NULL THEN jsonb_build_object('verifierId',assigned.verifier_id) ELSE '{}'::jsonb END);
END;
$body$;
CREATE FUNCTION candidate_operations.protect_closing_shift() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id AND phase<>'cancelled') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_shift_protected'; END IF;
  IF ROW(NEW.member_id,NEW.department,NEW.position,NEW.starts_at,NEW.ends_at,NEW.restaurant_id) IS DISTINCT FROM ROW(OLD.member_id,OLD.department,OLD.position,OLD.starts_at,OLD.ends_at,OLD.restaurant_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_shift_protected'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id AND phase NOT IN ('closed','cancelled')) AND (NEW.cancelled OR NEW.released_at IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_pending'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END;
$body$;
CREATE TRIGGER protect_closing_shift BEFORE UPDATE OR DELETE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.protect_closing_shift();
REVOKE ALL ON FUNCTION candidate_operations.assign_close(text,uuid,text,uuid,jsonb),candidate_operations.read_close(text,uuid,text,uuid),candidate_operations.protect_closing_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.assign_close(text,uuid,text,uuid,jsonb),candidate_operations.read_close(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
