-- Isolated candidate: dated responsibility never grants membership permissions.
BEGIN;
ALTER TABLE candidate_operations.leadership_references ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),ADD COLUMN note text NOT NULL DEFAULT '',ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE candidate_operations.leadership_events(leadership_id uuid NOT NULL REFERENCES candidate_operations.leadership_references(id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),action text NOT NULL,note text NOT NULL,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(leadership_id,revision));
CREATE TABLE candidate_operations.leadership_outbox(leadership_id uuid NOT NULL,revision integer NOT NULL,recipient_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),message text NOT NULL,delivered_at timestamptz,PRIMARY KEY(leadership_id,revision,recipient_id),FOREIGN KEY(leadership_id,revision) REFERENCES candidate_operations.leadership_events(leadership_id,revision));
REVOKE ALL ON candidate_operations.leadership_events,candidate_operations.leadership_outbox FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.leadership_command(p_subject text,p_member uuid,p_restaurant text,p_request uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships;target candidate_identity.memberships;rec candidate_operations.leadership_references;previous candidate_operations.leadership_references;scope candidate_identity.restaurants;receipt candidate_operations.command_receipts;input jsonb;action text;area text;result jsonb;updating boolean;
BEGIN
 action:=p_payload->>'action';input:=p_payload->'input';updating:=p_payload ? 'recordId';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('leadership.assign','leadership.revoke') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR action='leadership.revoke' AND NOT updating THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 IF updating THEN
  SELECT * INTO rec FROM candidate_operations.leadership_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
  previous:=rec;
  IF NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.publish') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 ELSIF p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
 IF action='leadership.assign' THEN
  IF NOT input ?& ARRAY['personId','area','start','end','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','area','start','end','note')) OR jsonb_typeof(input->'area') IS DISTINCT FROM 'string' OR length(btrim(input->>'area')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_fields'; END IF;
  area:=btrim(input->>'area');
  IF NOT candidate_operations.goal_authorized(actor.id,area,'schedule.publish') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  SELECT * INTO target FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leader_denied'; END IF;
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=target.id ORDER BY capability FOR SHARE;
  IF target.department<>area AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=target.id AND active AND capability='location.manage') OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=target.id AND active AND capability IN ('schedule.change','close.confirm')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leader_capability_required'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_fields'; END IF;
 END IF;
 IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_note'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.leadership_events e WHERE e.leadership_id=(receipt.result->>'recordId')::uuid AND e.revision=(receipt.result->>'revision')::integer AND e.data->'before'->>'department' IS NOT NULL AND NOT candidate_operations.goal_authorized(actor.id,e.data->'before'->>'department','schedule.publish')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF updating THEN
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 END IF;
 IF action='leadership.assign' THEN
  IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string' OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_period'; END IF;
  rec.starts_at:=(input->>'start')::timestamptz;rec.ends_at:=(input->>'end')::timestamptz;
  IF rec.ends_at<=rec.starts_at OR rec.ends_at-rec.starts_at>interval '24 hours' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_period'; END IF;
  IF updating THEN
   UPDATE candidate_operations.leadership_references SET member_id=target.id,department=area,starts_at=rec.starts_at,ends_at=rec.ends_at,active=true,note=btrim(input->>'note'),revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
  ELSE
   INSERT INTO candidate_operations.leadership_references(member_id,restaurant_id,department,starts_at,ends_at,note) VALUES(target.id,p_restaurant,area,rec.starts_at,rec.ends_at,btrim(input->>'note')) RETURNING * INTO rec;
  END IF;
 ELSE
  UPDATE candidate_operations.leadership_references SET active=false,note=btrim(input->>'note'),revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.leadership_events VALUES(rec.id,rec.revision,actor.id,action,rec.note,jsonb_build_object('before',CASE WHEN updating THEN to_jsonb(previous) END,'after',to_jsonb(rec)),rec.updated_at);
 IF action='leadership.assign' THEN INSERT INTO candidate_operations.leadership_outbox VALUES(rec.id,rec.revision,target.id,'Dated shift leadership assigned',NULL); END IF;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING * INTO scope;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.leadership_command(text,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.leadership_command(text,uuid,text,uuid,jsonb) TO candidate_runtime;
CREATE FUNCTION candidate_operations.list_schedule_leadership(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;scope candidate_identity.restaurants;selected uuid[];items jsonb;next_cursor uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT r.id FROM candidate_operations.leadership_references r WHERE r.restaurant_id=p_restaurant AND (p_after IS NULL OR r.id>p_after) AND (r.member_id=actor.id OR candidate_operations.goal_authorized(actor.id,r.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,r.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,r.department,'tasks.manage') OR r.active AND r.department=actor.department AND EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.member_id=actor.id AND s.published AND NOT s.cancelled AND s.starts_at<r.ends_at AND s.ends_at>r.starts_at)) ORDER BY r.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind','leadership','ownerId',r.member_id,'locationId',r.restaurant_id,'area',r.department,'revision',r.revision,'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'data',jsonb_build_object('personId',r.member_id,'area',r.department,'start',to_char(r.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(r.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'active',r.active,'note',r.note)) ORDER BY r.id),'[]') INTO items FROM candidate_operations.leadership_references r WHERE r.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone);
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_leadership(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_leadership(text,uuid,text,uuid,integer) TO candidate_runtime;
COMMIT;
