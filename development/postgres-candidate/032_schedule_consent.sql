-- Isolated candidate: coverage volunteers and named replacement consent.
BEGIN;
CREATE TABLE candidate_operations.schedule_offers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 owner_id uuid NOT NULL,department text NOT NULL,mode text NOT NULL CHECK(mode IN ('coverage','swap')),
 shift_id uuid NOT NULL REFERENCES candidate_operations.shift_references(id),shift_revision integer NOT NULL CHECK(shift_revision>0),
 position text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,duties jsonb NOT NULL CHECK(jsonb_typeof(duties)='array'),
 note text NOT NULL,decision text NOT NULL DEFAULT '',replacement_id uuid,selected_id uuid,
 status text NOT NULL CHECK(status IN ('open','pending','accepted-by-replacement','approved','declined','withdrawn','invalidated')),
 volunteers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(volunteers)='array'),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(owner_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(replacement_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 FOREIGN KEY(selected_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id),
 CHECK((mode='swap')=(replacement_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_coverage ON candidate_operations.schedule_offers(shift_id) WHERE mode='coverage' AND status='open';
CREATE TABLE candidate_operations.schedule_offer_events(offer_id uuid NOT NULL REFERENCES candidate_operations.schedule_offers(id),revision integer NOT NULL,actor_id uuid REFERENCES candidate_identity.memberships(id),action text NOT NULL,note text NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(offer_id,revision));
CREATE TABLE candidate_operations.schedule_offer_outbox(offer_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),message text NOT NULL,delivered_at timestamptz,PRIMARY KEY(offer_id,revision,recipient_id),FOREIGN KEY(offer_id,revision) REFERENCES candidate_operations.schedule_offer_events(offer_id,revision));
REVOKE ALL ON candidate_operations.schedule_offers,candidate_operations.schedule_offer_events,candidate_operations.schedule_offer_outbox FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.offer_duties(p_shift uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'standardId',standard_id,'standardRevision',standard_revision,'title',standard_snapshot->>'title','zone',zone,'criteria',standard_snapshot->'criteria','source',standard_snapshot->'source','version',standard_snapshot->'version','due',to_char(due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY id),'[]') FROM candidate_operations.closes WHERE shift_id=p_shift AND phase<>'cancelled';
$$;
CREATE FUNCTION candidate_operations.offer_issue(p_offer candidate_operations.schedule_offers) RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE s candidate_operations.shift_references;
BEGIN
 IF p_offer.status NOT IN ('open','pending','accepted-by-replacement') THEN RETURN 'offer_finished'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_offer.shift_id AND restaurant_id=p_offer.restaurant_id;
 IF NOT FOUND OR NOT s.published OR s.cancelled OR s.released_at IS NOT NULL THEN RETURN 'offer_shift_unavailable'; END IF;
 IF ROW(s.member_id,s.revision,s.position,s.starts_at,s.ends_at,s.department) IS DISTINCT FROM ROW(p_offer.owner_id,p_offer.shift_revision,p_offer.position,p_offer.starts_at,p_offer.ends_at,p_offer.department) THEN RETURN 'offer_shift_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=p_offer.owner_id AND restaurant_id=p_offer.restaurant_id AND active AND NOT schedule_only) THEN RETURN 'offer_owner_inactive'; END IF;
 IF p_offer.mode='coverage' AND s.starts_at<=statement_timestamp() THEN RETURN 'offer_shift_started'; END IF;
 IF candidate_operations.offer_duties(s.id)<>p_offer.duties THEN RETURN 'offer_duties_changed'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c LEFT JOIN candidate_operations.standard_references g ON g.id=c.standard_id AND g.restaurant_id=p_offer.restaurant_id WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND g.status IS DISTINCT FROM 'approved') THEN RETURN 'offer_guide_unavailable'; END IF;
 RETURN '';
END;
$$;
CREATE FUNCTION candidate_operations.offer_eligible(p_offer candidate_operations.schedule_offers,p_member uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE m candidate_identity.memberships;s candidate_operations.shift_references;zone text;
BEGIN
 IF candidate_operations.offer_issue(p_offer)<>'' THEN RETURN false; END IF;
 SELECT * INTO m FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_offer.restaurant_id AND active AND NOT schedule_only AND id<>p_offer.owner_id;
 IF NOT FOUND OR p_offer.mode='coverage' AND m.department<>p_offer.department THEN RETURN false; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_offer.shift_id;
 SELECT timezone INTO zone FROM candidate_identity.restaurants WHERE id=p_offer.restaurant_id;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_offer.restaurant_id AND time_off_complete)
 OR NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=m.id AND active AND job=s.position)
 OR s.station_id IS NOT NULL AND NOT candidate_operations.station_assignment_allowed(s.station_id,p_offer.restaurant_id,m.id,s.position)
 OR EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND id<>s.id AND NOT cancelled AND starts_at<s.ends_at AND ends_at>s.starts_at)
 OR EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND starts_at<s.ends_at AND ends_at>s.starts_at)
 OR EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND candidate_operations.availability_period_conflict(data,s.starts_at,s.ends_at,zone)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND (m.position='Dishwasher' OR m.id IN (c.manager_id,c.verifier_id) OR c.due<s.starts_at OR c.due>s.ends_at OR c.department<>m.department OR p_offer.mode='coverage' AND c.standard_snapshot->>'position'<>s.position OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=m.id AND restaurant_id=p_offer.restaurant_id AND active AND position=c.standard_snapshot->>'position'))) THEN RETURN false; END IF;
 RETURN true;
END;
$$;
CREATE FUNCTION candidate_operations.offer_coordinator(p_member uuid,p_department text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT candidate_operations.goal_authorized(p_member,p_department,'schedule.manage') OR candidate_operations.goal_authorized(p_member,p_department,'schedule.change');
$$;
CREATE FUNCTION candidate_operations.invalidate_schedule_offers(p_restaurant text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE rec candidate_operations.schedule_offers;reason text;changed boolean:=false;
BEGIN
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 FOR rec IN SELECT * FROM candidate_operations.schedule_offers WHERE restaurant_id=p_restaurant AND status IN ('open','pending','accepted-by-replacement') ORDER BY id FOR UPDATE LOOP
  reason:=candidate_operations.offer_issue(rec);
  IF reason='' THEN CONTINUE; END IF;
  UPDATE candidate_operations.schedule_offers SET status='invalidated',revision=revision+1,decision=reason,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
  INSERT INTO candidate_operations.schedule_offer_events VALUES(rec.id,rec.revision,NULL,'invalidated',reason,to_jsonb(rec),rec.updated_at);
  INSERT INTO candidate_operations.schedule_offer_outbox SELECT rec.id,rec.revision,id,'Schedule consent invalidated: '||reason,NULL FROM (SELECT rec.owner_id id UNION SELECT rec.replacement_id UNION SELECT (value->>'personId')::uuid FROM jsonb_array_elements(rec.volunteers)) recipients WHERE id IS NOT NULL;
  changed:=true;
 END LOOP;
 IF changed THEN UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant; END IF;
END;
$$;
CREATE FUNCTION candidate_operations.invalidate_offer_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM candidate_operations.invalidate_schedule_offers(to_jsonb(OLD)->>'restaurant_id'); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM candidate_operations.invalidate_schedule_offers(to_jsonb(NEW)->>'restaurant_id'); END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_shift_offers AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_offer_trigger();
CREATE TRIGGER invalidate_closing_offers AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.closes FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_offer_trigger();
CREATE TRIGGER invalidate_guide_offers AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.standard_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_offer_trigger();
CREATE TRIGGER invalidate_owner_offers AFTER UPDATE OR DELETE ON candidate_identity.memberships FOR EACH ROW EXECUTE FUNCTION candidate_operations.invalidate_offer_trigger();
REVOKE ALL ON FUNCTION candidate_operations.offer_duties(uuid),candidate_operations.offer_issue(candidate_operations.schedule_offers),candidate_operations.offer_eligible(candidate_operations.schedule_offers,uuid),candidate_operations.offer_coordinator(uuid,text),candidate_operations.invalidate_schedule_offers(text),candidate_operations.invalidate_offer_trigger() FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.schedule_consent_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships;rec candidate_operations.schedule_offers;s candidate_operations.shift_references;scope candidate_identity.restaurants;receipt candidate_operations.command_receipts;input jsonb;action text;creating boolean;target uuid;reason text;result jsonb;child_result jsonb;event_note text;recipients uuid[];
BEGIN
 action:=p_payload->>'action';input:=p_payload->'input';creating:=action IN ('coverage.create','request.create');
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve','request.create','request.consent','request.review') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 IF NOT creating THEN
  SELECT * INTO rec FROM candidate_operations.schedule_offers WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR action LIKE 'coverage.%' AND rec.mode<>'coverage' OR action LIKE 'request.%' AND rec.mode<>'swap' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='offer_denied'; END IF;
  IF action='coverage.withdraw' AND actor.id<>rec.owner_id OR action='request.consent' AND actor.id<>rec.replacement_id OR action IN ('coverage.approve','request.review') AND (actor.id IN (rec.owner_id,rec.replacement_id) OR NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF action='coverage.approve' AND (input->>'personId')::uuid=actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='independent_reviewer_required'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF creating AND NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE id=(receipt.result->>'recordId')::uuid AND owner_id=actor.id AND restaurant_id=p_restaurant) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='offer_denied'; END IF;
  IF action IN ('coverage.volunteer','coverage.withdraw-volunteer') AND actor.id=rec.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF (action='coverage.approve' OR action='request.review' AND input->'approve'='true'::jsonb) AND NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.id=CASE WHEN action='coverage.approve' THEN (input->>'personId')::uuid ELSE rec.replacement_id END AND m.restaurant_id=p_restaurant AND candidate_operations.published_change_allowed(actor.id,p_restaurant,m.department,rec.starts_at,rec.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 event_note:=coalesce(input->>'note','');
 IF jsonb_typeof(input->'note') IS NOT NULL AND jsonb_typeof(input->'note')<>'string' OR length(event_note)>2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_note'; END IF;
 IF creating THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('shiftId','shiftRevision','note','type','start','end','replacementId')) OR NOT input ? 'shiftId' OR action='request.create' AND (input->>'type' IS DISTINCT FROM 'swap' OR NOT input ?& ARRAY['replacementId','start','end','note']) OR action='coverage.create' AND NOT input ? 'shiftRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
  SELECT * INTO s FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant AND member_id=actor.id AND published AND NOT cancelled AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF input ? 'shiftRevision' AND (jsonb_typeof(input->'shiftRevision') IS DISTINCT FROM 'number' OR input->>'shiftRevision' !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF input ? 'shiftRevision' AND (input->>'shiftRevision')::integer<>s.revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF action='request.create' THEN
   IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string' OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_period'; END IF;
   IF (input->>'end')::timestamptz<=(input->>'start')::timestamptz OR (input->>'end')::timestamptz-(input->>'start')::timestamptz>interval '60 days' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_period'; END IF;
   IF length(btrim(event_note))=0 OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id NOT IN (actor.id,(input->>'replacementId')::uuid) AND candidate_operations.published_change_allowed(m.id,p_restaurant,s.department,s.starts_at,s.ends_at)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='swap_reviewer_required'; END IF;
  END IF;
  PERFORM candidate_operations.invalidate_schedule_offers(p_restaurant);
  IF action='coverage.create' AND EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE shift_id=s.id AND mode='coverage' AND status='open') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='coverage_offer_exists'; END IF;
  INSERT INTO candidate_operations.schedule_offers(restaurant_id,owner_id,department,mode,shift_id,shift_revision,position,starts_at,ends_at,duties,note,status,replacement_id) VALUES(p_restaurant,actor.id,s.department,CASE WHEN action='coverage.create' THEN 'coverage' ELSE 'swap' END,s.id,s.revision,s.position,s.starts_at,s.ends_at,candidate_operations.offer_duties(s.id),btrim(event_note),CASE WHEN action='coverage.create' THEN 'open' ELSE 'pending' END,CASE WHEN action='request.create' THEN (input->>'replacementId')::uuid END) RETURNING * INTO rec;
  reason:=candidate_operations.offer_issue(rec);
  IF reason<>'' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='offer_changed'; END IF;
  IF rec.mode='swap' AND NOT candidate_operations.offer_eligible(rec,rec.replacement_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='replacement_ineligible'; END IF;
 ELSE
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.status NOT IN ('open','pending','accepted-by-replacement') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF action='coverage.withdraw-volunteer' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(input)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=actor.id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_missing'; END IF;
   SELECT coalesce(jsonb_agg(v),'[]') INTO rec.volunteers FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'<>actor.id::text;
  ELSIF action='coverage.withdraw' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_fields'; END IF;
   rec.status:='withdrawn';
  ELSE
   IF candidate_operations.offer_issue(rec)<>'' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='offer_changed'; END IF;
   IF action='coverage.volunteer' THEN
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'confirmed') OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='consent_confirmation_required'; END IF;
    IF NOT candidate_operations.offer_eligible(rec,actor.id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='replacement_ineligible'; END IF;
    IF jsonb_array_length(rec.volunteers)>=100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=actor.id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_conflict'; END IF;
    rec.volunteers:=rec.volunteers||jsonb_build_array(jsonb_build_object('personId',actor.id,'at',clock_timestamp()));
   ELSIF action='request.consent' THEN
    IF rec.status<>'pending' OR jsonb_typeof(input->'accept') IS DISTINCT FROM 'boolean' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'accept') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_consent'; END IF;
    rec.status:=CASE WHEN (input->>'accept')::boolean THEN 'accepted-by-replacement' ELSE 'declined' END;
    IF rec.status='declined' THEN rec.decision:='Replacement declined'; END IF;
   ELSE
    IF action='coverage.approve' THEN
     IF NOT input ?& ARRAY['personId','confirmed','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','confirmed','note')) OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='consent_confirmation_required'; END IF;
     target:=(input->>'personId')::uuid;
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec.volunteers) v WHERE v->>'personId'=target::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='volunteer_missing'; END IF;
    ELSE
     IF NOT input ?& ARRAY['approve','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('approve','note')) OR jsonb_typeof(input->'approve') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_swap_review'; END IF;
     target:=rec.replacement_id;
     IF (input->>'approve')::boolean AND rec.status<>'accepted-by-replacement' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replacement_consent_required'; END IF;
    END IF;
    IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(event_note))=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_note'; END IF;
    rec.decision:=btrim(event_note);
    IF action='request.review' AND NOT (input->>'approve')::boolean THEN rec.status:='declined'; ELSE
     IF target=actor.id OR target=rec.owner_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='independent_reviewer_required'; END IF;
     IF NOT candidate_operations.offer_eligible(rec,target) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='replacement_no_longer_eligible'; END IF;
     SELECT * INTO s FROM candidate_operations.shift_references WHERE id=rec.shift_id FOR UPDATE;
     -- Close this offer before shared shift/closing triggers inspect the changed assignment.
     UPDATE candidate_operations.schedule_offers SET status='approved' WHERE id=rec.id;
     child_result:=candidate_operations.change_schedule(p_subject,p_member,p_restaurant,md5('consent:'||p_request::text)::uuid,jsonb_build_object('action','shift.save','recordId',s.id,'expectedRevision',s.revision,'input',jsonb_build_object('personId',target,'start',s.starts_at,'end',s.ends_at,'position',s.position,'note',rec.decision)));
     rec.status:='approved';rec.selected_id:=target;
    END IF;
   END IF;
  END IF;
  UPDATE candidate_operations.schedule_offers SET status=rec.status,selected_id=rec.selected_id,decision=rec.decision,volunteers=rec.volunteers,revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.schedule_offer_events VALUES(rec.id,rec.revision,actor.id,action,event_note,to_jsonb(rec),rec.updated_at);
 IF creating AND rec.mode='swap' THEN recipients:=ARRAY[rec.replacement_id];
 ELSE
  SELECT array_agg(DISTINCT id) INTO recipients FROM (
   SELECT rec.owner_id id UNION SELECT rec.replacement_id UNION SELECT rec.selected_id UNION SELECT (v->>'personId')::uuid FROM jsonb_array_elements(rec.volunteers) v
   UNION SELECT m.id FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>rec.owner_id AND m.id IS DISTINCT FROM target AND candidate_operations.published_change_allowed(m.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at)
   UNION SELECT m.id FROM candidate_identity.memberships m WHERE creating AND rec.mode='coverage' AND m.restaurant_id=p_restaurant AND candidate_operations.offer_eligible(rec,m.id)
  ) targets WHERE id IS NOT NULL;
 END IF;
 INSERT INTO candidate_operations.schedule_offer_outbox SELECT rec.id,rec.revision,id,'Schedule consent: '||action,NULL FROM unnest(recipients) id;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING * INTO scope;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 IF child_result IS NOT NULL THEN result:=result||jsonb_build_object('shift',child_result); END IF;
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.schedule_consent_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.schedule_consent_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;

CREATE FUNCTION candidate_operations.schedule_request_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_payload->'input'->>'type'='swap' OR p_payload->>'action'='request.consent' OR p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant AND mode='swap') THEN RETURN candidate_operations.schedule_consent_command(p_subject,p_member,p_restaurant,p_request,p_payload); END IF;
 RETURN candidate_operations.time_off_command(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.schedule_request_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.schedule_request_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;

CREATE FUNCTION candidate_operations.list_schedule_offers(p_subject text,p_member uuid,p_restaurant text,p_mode text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;scope candidate_identity.restaurants;selected uuid[];items jsonb;next_cursor uuid;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('coverage','swap') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT array_agg(id) INTO selected FROM (SELECT r.id FROM candidate_operations.schedule_offers r WHERE r.restaurant_id=p_restaurant AND r.mode=p_mode AND (p_after IS NULL OR r.id>p_after) AND (actor.id IN (r.owner_id,r.replacement_id,r.selected_id) OR candidate_operations.offer_coordinator(actor.id,r.department) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.volunteers) v WHERE v->>'personId'=actor.id::text) OR r.mode='coverage' AND candidate_operations.offer_eligible(r,actor.id)) ORDER BY r.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',CASE WHEN r.mode='coverage' THEN 'coverage' ELSE 'request' END,'ownerId',r.owner_id,'locationId',r.restaurant_id,'area',r.department,'revision',r.revision,'updatedAt',r.updated_at,'data',jsonb_build_object('type',CASE WHEN r.mode='swap' THEN 'swap' END,'title',r.position||' shift coverage','shiftId',r.shift_id,'shiftRevision',r.shift_revision,'position',r.position,'start',r.starts_at,'end',r.ends_at,'duties',r.duties,'status',r.status,'replacementId',r.replacement_id,'note',CASE WHEN r.mode='swap' OR private_access THEN r.note ELSE '' END,'decision',CASE WHEN r.mode='swap' OR private_access THEN r.decision ELSE '' END,'selectedId',CASE WHEN private_access OR r.selected_id=actor.id THEN r.selected_id END,'volunteers',CASE WHEN private_access THEN r.volunteers ELSE (SELECT coalesce(jsonb_agg(v),'[]') FROM jsonb_array_elements(r.volunteers) v WHERE v->>'personId'=actor.id::text) END,'history',CASE WHEN private_access THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('action',e.action,'actorId',e.actor_id,'at',e.recorded_at,'note',e.note) ORDER BY e.revision),'[]') FROM candidate_operations.schedule_offer_events e WHERE e.offer_id=r.id) ELSE '[]'::jsonb END,'unavailableReason',candidate_operations.offer_issue(r),'eligible',candidate_operations.offer_eligible(r,actor.id))) ORDER BY r.id),'[]') INTO items FROM candidate_operations.schedule_offers r CROSS JOIN LATERAL (SELECT actor.id=r.owner_id OR candidate_operations.offer_coordinator(actor.id,r.department) private_access) access WHERE r.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage',p_mode);
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_offers(text,uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_offers(text,uuid,text,text,uuid,integer) TO candidate_runtime;
COMMIT;
