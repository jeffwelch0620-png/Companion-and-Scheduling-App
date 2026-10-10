-- Generated from fresh PostgreSQL 17 candidate migrations; review evidence, not a deployment manifest.
CREATE OR REPLACE FUNCTION candidate_operations.assign_close(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; manager candidate_identity.memberships; verifier candidate_identity.memberships;
 shift candidate_operations.shift_references; standard candidate_operations.standard_references; assigned candidate_operations.closes;
 receipt candidate_operations.command_receipts; input jsonb; due_at timestamptz; note text; result jsonb; scope_revision integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.assign_dish_cycle(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; person candidate_identity.memberships; cycle candidate_operations.dish_cycles;
 receipt candidate_operations.command_receipts; input jsonb; participants uuid[]; checkout_date date; due_at timestamptz; task_id uuid;
 title text; detail text; scope_revision integer; result jsonb; slot integer;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR NOT candidate_operations.dish_manager(p_member,p_restaurant) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'task.dish-cycle' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt'))
 OR NOT input ?& ARRAY['amOwnerId','pmOwnerIds','businessDate','title','detail','due']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('amOwnerId','pmOwnerIds','businessDate','title','detail','due'))
 OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE f.key<>'pmOwnerIds' AND jsonb_typeof(f.value)<>'string')
 OR jsonb_typeof(input->'pmOwnerIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_cycle'; END IF;
 IF jsonb_array_length(input->'pmOwnerIds')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'pmOwnerIds') v WHERE jsonb_typeof(v)<>'string')
 OR input->>'businessDate' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_cycle'; END IF;
 participants:=ARRAY[(input->>'amOwnerId')::uuid,(input->'pmOwnerIds'->>0)::uuid,(input->'pmOwnerIds'->>1)::uuid];
 IF (SELECT count(DISTINCT id) FROM unnest(participants) id)<>3 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='distinct_dishwashers_required'; END IF;
 checkout_date:=(input->>'businessDate')::date;due_at:=(input->>'due')::timestamptz;title:=btrim(input->>'title');detail:=btrim(input->>'detail');
 IF length(title) NOT BETWEEN 1 AND 180 OR length(detail) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_text'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 FOREACH task_id IN ARRAY participants LOOP
  SELECT * INTO person FROM candidate_identity.memberships WHERE id=task_id AND restaurant_id=p_restaurant AND department='BOH' AND position='Dishwasher' AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dishwasher_denied'; END IF;
  PERFORM 1 FROM candidate_identity.auth_links WHERE person_id=person.person_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='sign_in_required'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM candidate_operations.dish_cycles c WHERE c.restaurant_id=p_restaurant AND c.business_date=checkout_date) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_cycle_conflict'; END IF;
 INSERT INTO candidate_operations.dish_cycles(restaurant_id,business_date,title,detail,due,created_by) VALUES(p_restaurant,checkout_date,title,detail,due_at,p_member) RETURNING * INTO cycle;
 FOR slot IN 0..2 LOOP
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind)
  VALUES(p_restaurant,participants[slot+1],'BOH',(CASE WHEN slot=0 THEN 'AM' ELSE 'PM' END)||' checkout: '||title,detail,due_at,'open',1,'task') RETURNING id INTO task_id;
  INSERT INTO candidate_operations.dish_participants(cycle_id,restaurant_id,slot,member_id,task_id) VALUES(cycle.id,p_restaurant,slot,participants[slot+1],task_id);
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task_id,p_restaurant,1,p_member,'assigned',detail,'open',participants[slot+1]);
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) VALUES(p_restaurant,participants[slot+1],task_id,1,'Dishwasher checkout assigned: '||title);
 END LOOP;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',cycle.id,'revision',1,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.availability_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
<<availability_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.availability_references;
 old candidate_operations.availability_references; receipt candidate_operations.command_receipts; scope candidate_identity.restaurants;
 input jsonb; data jsonb; result jsonb; creating boolean; approve boolean; first_date date; last_date date; note text; n integer; key text;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' NOT IN ('availability.save','availability.review')
 OR p_payload->>'action' IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_availability_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.availability_period_conflict(p_data jsonb, p_start timestamp with time zone, p_end timestamp with time zone, p_timezone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM generate_series(date_trunc('minute',p_start),p_end-interval '1 microsecond',interval '1 minute') t
 CROSS JOIN LATERAL (SELECT t AT TIME ZONE p_timezone AS wall) w CROSS JOIN generate_series(-1,1) offset_day
 CROSS JOIN LATERAL (SELECT wall::date+offset_day AS anchor,
  extract(hour FROM wall)::integer*60+extract(minute FROM wall)::integer-offset_day*1440 AS minute) a
 WHERE anchor BETWEEN (p_data->>'startDate')::date AND (p_data->>'endDate')::date
 AND p_data->'days' @> jsonb_build_array(extract(dow FROM anchor)::integer)
 AND NOT coalesce(p_data->'excludedDates','[]') @> to_jsonb(ARRAY[anchor::text])
 AND minute >= (p_data->>'startMinute')::integer-(p_data->>'beforeMinutes')::integer
 AND minute < (p_data->>'endMinute')::integer+(p_data->>'afterMinutes')::integer);
$function$

CREATE OR REPLACE FUNCTION candidate_operations.change_schedule(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; rec candidate_operations.shift_references; updated candidate_operations.shift_references; target candidate_operations.shift_references; station candidate_operations.station_references; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 c candidate_operations.closes; mapping jsonb; input jsonb; result jsonb; cancelling boolean; structural boolean; note text; original_owner uuid; old_helper uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 cancelling:=p_payload->>'action'='shift.cancel';input:=p_payload->'input';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(p_payload->>'action','') NOT IN ('shift.save','shift.cancel') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_change'; END IF;
 IF jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR p_payload->>'recordId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_record'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 IF rec.published AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at) OR NOT rec.published AND NOT candidate_operations.goal_authorized(actor.id,rec.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF NOT cancelling AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,rec.department,rec.starts_at,rec.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF cancelling AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) t WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=(t->>'shiftId')::uuid AND s.restaurant_id=p_restaurant AND (s.published AND candidate_operations.published_change_allowed(actor.id,p_restaurant,s.department,s.starts_at,s.ends_at) OR NOT s.published AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage')))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.schedule_change_events e WHERE e.shift_id=rec.id AND e.revision=(receipt.result->>'revision')::integer AND (e.data->'before'->>'published')::boolean AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,e.data->'before'->>'department',(e.data->'before'->>'starts_at')::timestamptz,(e.data->'before'->>'ends_at')::timestamptz)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
 IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF rec.cancelled OR rec.released_at IS NOT NULL OR NOT cancelling AND NOT rec.published THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 -- Current server time after scope/row coordination; receipt replay above does not mutate.
 IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='schedule_change_note_required'; END IF;
 note:=btrim(input->>'note');original_owner:=rec.member_id;updated:=rec;updated.revision:=rec.revision+1;
 IF cancelling THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('note','closeTransfers')) OR input ? 'closeTransfers' AND jsonb_typeof(input->'closeTransfers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
  FOR mapping IN SELECT value FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) LOOP
   IF jsonb_typeof(mapping) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
   IF NOT mapping ?& ARRAY['closeId','closingRevision','shiftId','expectedRevision'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(mapping) k WHERE k NOT IN ('closeId','closingRevision','shiftId','expectedRevision')) OR jsonb_typeof(mapping->'closeId') IS DISTINCT FROM 'string' OR mapping->>'closeId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(mapping->'shiftId') IS DISTINCT FROM 'string' OR mapping->>'shiftId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR jsonb_typeof(mapping->'closingRevision') IS DISTINCT FROM 'number' OR mapping->>'closingRevision' !~ '^[1-9][0-9]*$' OR jsonb_typeof(mapping->'expectedRevision') IS DISTINCT FROM 'number' OR mapping->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_close_transfers'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id AND phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_task_pending'; END IF;
  IF jsonb_array_length(coalesce(input->'closeTransfers','[]'))<>(SELECT count(*) FROM candidate_operations.closes WHERE shift_id=rec.id AND phase NOT IN ('closed','cancelled')) OR (SELECT count(DISTINCT t->>'closeId') FROM jsonb_array_elements(coalesce(input->'closeTransfers','[]')) t)<>jsonb_array_length(coalesce(input->'closeTransfers','[]')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
  FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=rec.id AND phase NOT IN ('closed','cancelled') ORDER BY id FOR UPDATE LOOP
   SELECT t INTO mapping FROM jsonb_array_elements(input->'closeTransfers') t WHERE t->>'closeId'=c.id::text;
   IF mapping IS NULL OR c.revision<>(mapping->>'closingRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
   SELECT * INTO target FROM candidate_operations.shift_references WHERE id=(mapping->>'shiftId')::uuid AND restaurant_id=p_restaurant AND id<>rec.id AND NOT cancelled AND released_at IS NULL FOR UPDATE;
   IF NOT FOUND OR target.revision<>(mapping->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_transfer_selection_conflict'; END IF;
   IF rec.published AND NOT target.published OR target.department<>c.department OR c.due<target.starts_at OR c.due>target.ends_at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='closing_covering_shift_denied'; END IF;
   IF target.published AND NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,target.department,target.starts_at,target.ends_at) OR NOT target.published AND NOT candidate_operations.goal_authorized(actor.id,target.department,'schedule.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=target.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
   IF NOT FOUND OR owner_member.id IN (c.manager_id,c.verifier_id) OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_restaurant AND active AND position=c.standard_snapshot->>'position') OR NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=target.id AND standard_id=c.standard_id AND active) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_covering_employee_denied'; END IF;
   IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=target.id AND phase<>'cancelled' AND zone=c.zone) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_zone_conflict'; END IF;
   old_helper:=c.helper_id;
   UPDATE candidate_operations.closes SET shift_id=target.id,shift_revision=target.revision,owner_id=owner_member.id,phase='open',answers='[]',helper_id=NULL,correction=NULL,revision=revision+1 WHERE id=c.id RETURNING * INTO c;
   IF jsonb_array_length(candidate_operations.closing_publication_issues(target.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
   INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note) VALUES(c.id,p_restaurant,c.revision,actor.id,'reassigned',rec.id::text||' -> '||target.id::text);
   INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message) SELECT c.id,p_restaurant,c.revision,id,'Closing work reassigned; complete and submit the work' FROM (SELECT DISTINCT unnest(ARRAY[c.owner_id,c.manager_id,old_helper]) id) recipients WHERE id IS NOT NULL;
  END LOOP;
  updated.cancelled:=true;
 ELSE
  IF NOT input ?& ARRAY['personId','start','end','position','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','start','end','position','note','stationId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_fields'; END IF;
  SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND (active OR schedule_only) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_fields'; END IF;
  updated.member_id:=owner_member.id;updated.department:=owner_member.department;updated.starts_at:=(input->>'start')::timestamptz;updated.ends_at:=(input->>'end')::timestamptz;updated.position:=btrim(input->>'position');
  IF updated.ends_at<=updated.starts_at OR updated.ends_at-updated.starts_at>interval '24 hours' OR length(updated.position) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_duration'; END IF;
  IF rec.starts_at<=clock_timestamp() AND (updated.starts_at>rec.starts_at OR updated.ends_at<clock_timestamp())
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='active_shift_time_conflict'; END IF;
  IF NOT candidate_operations.published_change_allowed(actor.id,p_restaurant,updated.department,updated.starts_at,updated.ends_at) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
  IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=updated.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND s.member_id=owner_member.id AND s.id<>rec.id AND NOT s.cancelled AND s.starts_at<updated.ends_at AND s.ends_at>updated.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
  IF candidate_operations.person_time_off_conflict(owner_member.id,updated.starts_at,updated.ends_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=owner_member.id AND status='approved' AND candidate_operations.availability_period_conflict(data,updated.starts_at,updated.ends_at,scope.timezone)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
  IF input ? 'stationId' THEN updated.station_id:=nullif(input->>'stationId','')::uuid; END IF;
  IF updated.station_id IS DISTINCT FROM rec.station_id AND EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_close_protected'; END IF;
  IF updated.station_id IS NOT NULL THEN
   IF NOT candidate_operations.station_assignment_allowed(updated.station_id,p_restaurant,owner_member.id,updated.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_assignment_denied'; END IF;
   SELECT * INTO station FROM candidate_operations.station_references WHERE id=updated.station_id;
   IF NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) THEN updated.station_name:=station.title;updated.station_revision:=station.revision; END IF;
  ELSE updated.station_name:=NULL;updated.station_revision:=NULL; END IF;
  structural:=ROW(updated.member_id,updated.department,updated.position,updated.starts_at,updated.ends_at) IS DISTINCT FROM ROW(rec.member_id,rec.department,rec.position,rec.starts_at,rec.ends_at);
  IF structural AND EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
  FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled' ORDER BY id FOR UPDATE LOOP
   IF structural AND c.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='completed_close_protected'; END IF;
   IF structural AND (owner_member.id IN (c.manager_id,c.verifier_id) OR owner_member.position='Dishwasher' OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=owner_member.id AND restaurant_id=p_restaurant AND active AND position=c.standard_snapshot->>'position') OR c.due<updated.starts_at OR c.due>updated.ends_at OR updated.department<>c.department) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_covering_employee_denied'; END IF;
   old_helper:=c.helper_id;
   UPDATE candidate_operations.closes SET owner_id=owner_member.id,shift_revision=updated.revision,phase=CASE WHEN structural THEN 'open' ELSE phase END,answers=CASE WHEN structural THEN '[]'::jsonb ELSE answers END,helper_id=CASE WHEN structural THEN NULL ELSE helper_id END,correction=CASE WHEN structural THEN NULL ELSE correction END,revision=revision+1 WHERE id=c.id RETURNING * INTO c;
   INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note) VALUES(c.id,p_restaurant,c.revision,actor.id,CASE WHEN structural THEN 'schedule-changed' ELSE 'shift-link-updated' END,note);
   IF structural THEN INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message) SELECT c.id,p_restaurant,c.revision,id,'Closing responsibility changed; complete and submit the work' FROM (SELECT DISTINCT unnest(ARRAY[c.owner_id,c.manager_id,c.verifier_id,old_helper]) id) recipients WHERE id IS NOT NULL; END IF;
  END LOOP;
 END IF;
 INSERT INTO candidate_operations.shift_change_permits VALUES(rec.id,txid_current(),encode(sha256(convert_to(to_jsonb(rec)::text,'UTF8')),'hex'),encode(sha256(convert_to(to_jsonb(updated)::text,'UTF8')),'hex'));
 UPDATE candidate_operations.shift_references SET member_id=updated.member_id,department=updated.department,position=updated.position,starts_at=updated.starts_at,ends_at=updated.ends_at,station_id=updated.station_id,station_name=updated.station_name,station_revision=updated.station_revision,revision=updated.revision,cancelled=updated.cancelled WHERE id=rec.id RETURNING * INTO updated;
 DELETE FROM candidate_operations.shift_change_permits WHERE shift_id=rec.id;
 IF NOT cancelling THEN
  UPDATE candidate_operations.tasks SET shift_revision=updated.revision WHERE shift_id=rec.id;
  IF jsonb_array_length(candidate_operations.closing_publication_issues(rec.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
  PERFORM candidate_operations.propose_changed_shift_goals(actor.id,p_restaurant,updated.id);
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.schedule_change_events VALUES(updated.id,updated.revision,actor.id,p_payload->>'action',jsonb_build_object('before',to_jsonb(rec),'after',to_jsonb(updated)),note,clock_timestamp());
 IF rec.published THEN INSERT INTO candidate_operations.schedule_change_outbox SELECT updated.id,updated.revision,id,CASE WHEN cancelling THEN 'Shift cancelled' ELSE 'Your schedule changed' END,NULL FROM (SELECT DISTINCT unnest(ARRAY[original_owner,updated.member_id]) id) recipients; END IF;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',updated.id,'revision',updated.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.check_person_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 -- Hold the membership key stable through projection insertion. Coordinate scope
 -- first (aa_coordinate_policy); never acquire another location's scope here.
 PERFORM 1 FROM candidate_identity.memberships WHERE id=NEW.member_id AND restaurant_id=NEW.restaurant_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT NEW.cancelled AND candidate_operations.person_shift_conflict(NEW.member_id,NEW.starts_at,NEW.ends_at,NEW.id)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.check_time_off_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND OLD.restaurant_id<>NEW.restaurant_id THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=OLD.restaurant_id;
 END IF;
 IF TG_OP<>'DELETE' THEN
  -- Managed commands write exact audit snapshots in this transaction.
  IF EXISTS(SELECT 1 FROM candidate_operations.time_off_events WHERE request_id=NEW.id AND revision=NEW.revision AND data=to_jsonb(NEW)) THEN RETURN NULL; END IF;
  -- Reconciliation archives the final target representation before commit.
  IF EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews g JOIN candidate_operations.schedule_reconciliation_receipts r ON r.batch_id=g.evidence_batch_id AND r.restaurant_id=g.restaurant_id
   WHERE g.restaurant_id=NEW.restaurant_id AND g.time_off_complete AND r.target_time_off @> jsonb_build_array(to_jsonb(NEW))) THEN RETURN NULL; END IF;
 END IF;
 UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=CASE WHEN TG_OP='DELETE' THEN OLD.restaurant_id ELSE NEW.restaurant_id END;
 IF TG_OP='UPDATE' AND OLD.restaurant_id<>NEW.restaurant_id THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=OLD.restaurant_id;
 END IF;
 RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.closing_manager(p_member uuid, p_restaurant text, p_department text, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[];
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 RETURN p_capability=ANY(caps) AND (actor.department=p_department OR 'location.manage'=ANY(caps)
  OR 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND p_department IN ('FOH','BOH'));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.closing_manager_read(p_member uuid, p_restaurant text, p_department text, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[];
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant AND active AND NOT schedule_only;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 RETURN p_capability=ANY(caps) AND (actor.department=p_department OR 'location.manage'=ANY(caps)
  OR 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND p_department IN ('FOH','BOH'));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.closing_publication_issues(p_shift uuid, p_restaurant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.closing_publication_issues_read(p_shift uuid, p_restaurant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s candidate_operations.shift_references; c candidate_operations.closes; standard candidate_operations.standard_references; issues jsonb:='[]';
BEGIN
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 FOR c IN SELECT * FROM candidate_operations.closes WHERE shift_id=s.id AND phase<>'cancelled' ORDER BY id LOOP
  SELECT * INTO standard FROM candidate_operations.standard_references WHERE id=c.standard_id AND restaurant_id=p_restaurant;
  IF NOT FOUND OR standard.status<>'approved' OR standard.revision<>c.standard_revision THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_instruction_changed')); END IF;
  IF c.shift_revision<>s.revision OR c.owner_id<>s.member_id OR c.department<>s.department OR c.due<s.starts_at OR c.due>s.ends_at OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=s.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher') OR NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id AND standard_id=c.standard_id AND active) OR (s.station_id IS NULL AND standard.position IS DISTINCT FROM s.position) OR (s.station_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_operations.station_references t WHERE t.id=s.station_id AND t.status='active' AND (t.setup_data->'standardIds' @> to_jsonb(ARRAY[c.standard_id::text]) OR lower(btrim(standard.position))=lower(btrim(t.title))))) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_assignment_changed')); END IF;
  IF c.manager_id=s.member_id OR NOT candidate_operations.closing_manager_read(c.manager_id,p_restaurant,s.department,'close.confirm') OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=c.manager_id AND capability='location.manage' AND active) AND NOT EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE member_id=c.manager_id AND restaurant_id=p_restaurant AND department=s.department AND active AND starts_at<=c.due AND ends_at>=c.due) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_manager_unavailable')); END IF;
  IF c.standard_snapshot->>'verification'='senior-then-manager' AND (c.verifier_id IS NULL OR c.verifier_id IN (s.member_id,c.manager_id) OR NOT candidate_operations.closing_manager_read(c.verifier_id,p_restaurant,s.department,'close.verify')) THEN issues:=issues||jsonb_build_array(jsonb_build_object('closeId',c.id,'code','closing_verifier_unavailable')); END IF;
 END LOOP;
 RETURN issues;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_payload->>'action'='task.create' AND p_payload->'input'->>'kind'='handoff' AND p_payload->'input' ? 'shiftId'
 OR p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND kind='handoff' AND shift_id IS NOT NULL) THEN
  RETURN candidate_operations.manager_handoff_command(p_subject,p_member,p_restaurant,p_request,p_payload);
 END IF;
 IF p_payload ? 'recordId' AND (EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE task_id=(p_payload->>'recordId')::uuid) OR EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs WHERE task_id=(p_payload->>'recordId')::uuid)) THEN
  RETURN candidate_operations.dish_command(p_subject,p_member,p_restaurant,p_request,p_payload);
 END IF;
 IF p_payload->>'action'='task.dish-pass' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_task_required'; END IF;
 RETURN candidate_operations.command_before_dish(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.command_before_dish(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 actor candidate_identity.memberships;
 target candidate_identity.memberships; incoming candidate_identity.memberships;
 task candidate_operations.tasks;
 receipt candidate_operations.command_receipts;
 scope_revision integer; result jsonb; next_phase text; verb text; note text;
 action text; input jsonb; old_revision integer; target_id uuid; due_at timestamptz; previous_assignee uuid; linked candidate_operations.shift_references;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 -- The subject is trusted backend input, never a browser-selected actor.
 IF p_subject IS NULL OR p_member IS NULL OR p_restaurant IS NULL OR p_request IS NULL
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command';
 END IF;
 -- Scope coordination serializes commands. Identity administration must use the same
 -- scope-first ordering; member SHARE locks also prevent revocation during this commit.
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants
 WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND a.subject=p_subject AND m.active AND NOT m.schedule_only
 FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts
 WHERE restaurant_id=p_restaurant AND actor_id=actor.id AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict';
  END IF;
  -- Recheck receipt visibility after grants or responsibility change.
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT (task.assignee_id=actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id)) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF receipt.payload->>'action'='task.transition' AND receipt.payload->'input'->>'step'='ready' AND task.assignee_id<>actor.id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
  END IF;
  IF receipt.payload->>'action'='task.transition' AND receipt.payload->'input'->>'step' IN ('accept','dispute')
   AND (task.kind<>'handoff' OR task.incoming_id IS DISTINCT FROM actor.id OR actor.position='Dishwasher') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
  END IF;
  IF receipt.payload->>'action' IN ('task.create','task.reassign') OR receipt.payload->'input'->>'step' IN ('verify','fix') THEN
   SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
   IF NOT FOUND OR NOT candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  END IF;
  RETURN receipt.result || jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
  WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unexpected_field';
 END IF;
 action:=p_payload->>'action'; input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_input';
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_capture_time';
  END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 IF action='task.create' THEN
  IF NOT candidate_operations.task_reviewer(actor.id,p_restaurant,actor.department,CASE WHEN input ? 'shiftId' THEN (input->>'shiftId')::uuid ELSE NULL END) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision'
   OR (input->>'kind') IS NULL OR (input->>'kind') NOT IN ('task','issue','handoff')
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','due','incomingId','shiftId'))
   OR NOT input ?& ARRAY['title','detail','kind','ownerId','due']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_creation';
  END IF;
  IF (input->>'kind'='handoff')<>(input ? 'incomingId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_creation'; END IF;
  target_id:=(input->>'ownerId')::uuid; due_at:=(input->>'due')::timestamptz;
  SELECT * INTO target FROM candidate_identity.memberships
   WHERE id=target_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.task_reviewer(actor.id,p_restaurant,target.department,CASE WHEN action='task.reassign' THEN task.shift_id WHEN input ? 'shiftId' THEN (input->>'shiftId')::uuid ELSE NULL END) OR target.position='Dishwasher' AND input->>'kind'<>'task' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='assignee_denied';
  END IF;
  IF input ? 'shiftId' THEN
   IF input->>'kind'='handoff' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='linked_handoff_not_supported'; END IF;
   SELECT * INTO linked FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant FOR SHARE;
   IF NOT FOUND OR linked.member_id<>target.id OR linked.department<>target.department OR linked.position='Dishwasher'
    OR NOT linked.published OR linked.cancelled OR linked.released_at IS NOT NULL OR due_at<linked.starts_at OR due_at>linked.ends_at THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied';
   END IF;
  END IF;
  IF input->>'kind'='handoff' THEN
   SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
   IF NOT FOUND OR incoming.id=target.id OR incoming.position='Dishwasher' OR NOT candidate_operations.task_manager(actor.id,p_restaurant,incoming.department) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied';
   END IF;
  END IF;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind,incoming_id,shift_id,shift_revision)
  VALUES(p_restaurant,target.id,target.department,btrim(input->>'title'),btrim(input->>'detail'),due_at,'open',1,input->>'kind',incoming.id,linked.id,linked.revision)
  RETURNING * INTO task;
  verb:='assigned'; note:=task.detail; old_revision:=0;
 ELSIF action='task.reassign' THEN
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision']
   OR jsonb_typeof(p_payload->'recordId')<>'string' OR jsonb_typeof(p_payload->'expectedRevision')<>'number'
   OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
   OR NOT input ?& ARRAY['ownerId','note']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('ownerId','note'))
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_reassignment';
  END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND OR NOT candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF task.shift_id IS NOT NULL AND NOT candidate_operations.linked_task_current(task.restaurant_id,task.shift_id,task.assignee_id,task.department,task.due,task.shift_revision) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict';
  END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  SELECT * INTO target FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR target.department<>task.department OR NOT candidate_operations.task_reviewer(actor.id,p_restaurant,target.department,CASE WHEN action='task.reassign' THEN task.shift_id WHEN input ? 'shiftId' THEN (input->>'shiftId')::uuid ELSE NULL END)
   OR target.position='Dishwasher' AND task.kind<>'task' OR target.id=task.incoming_id THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='assignee_denied';
  END IF;
  IF task.shift_id IS NOT NULL AND target.id<>task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='linked_reassignment_denied'; END IF;
  note:=btrim(input->>'note');
  IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
  previous_assignee:=task.assignee_id;old_revision:=task.revision;verb:='reassigned';
  note:=previous_assignee::text||' → '||target.id::text||': '||note;
  UPDATE candidate_operations.tasks SET assignee_id=target.id,phase='open',revision=revision+1 WHERE id=task.id RETURNING * INTO task;
 ELSIF action='task.transition' THEN
  IF NOT p_payload ?& ARRAY['recordId','expectedRevision']
   OR jsonb_typeof(p_payload->'recordId')<>'string'
   OR jsonb_typeof(p_payload->'expectedRevision')<>'number'
   OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note'))
   OR NOT input ?& ARRAY['step','note']
   OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_transition'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks
  WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF NOT (task.assignee_id=actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR (candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id))) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
  END IF;
  IF task.shift_id IS NOT NULL AND NOT candidate_operations.linked_task_current(task.restaurant_id,task.shift_id,task.assignee_id,task.department,task.due,task.shift_revision) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict';
  END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict';
  END IF;
  verb:=input->>'step'; note:=btrim(input->>'note'); old_revision:=task.revision;
  IF length(note) NOT BETWEEN 1 AND 8000 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note';
  END IF;
  IF verb='ready' THEN
   IF actor.position='Dishwasher' AND task.kind<>'task' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   IF task.assignee_id<>actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:='verification';
  ELSIF verb IN ('verify','fix') THEN
   IF NOT candidate_operations.task_reviewer(actor.id,p_restaurant,task.department,task.shift_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
   END IF;
   IF verb='verify' THEN
    IF actor.id=task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='self_verification_denied'; END IF;
    IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
    next_phase:=CASE WHEN task.kind='handoff' THEN 'acceptance' ELSE 'closed' END;
   ELSE
    IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
    next_phase:='correction';
   END IF;
  ELSIF verb IN ('accept','dispute') THEN
   IF task.kind<>'handoff' OR task.incoming_id IS DISTINCT FROM actor.id OR actor.position='Dishwasher' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied';
   END IF;
   IF task.phase<>'acceptance' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:=CASE WHEN verb='accept' THEN 'closed' ELSE 'correction' END;
  ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_step'; END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1
  WHERE id=task.id RETURNING * INTO task;
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_action'; END IF;
 INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,previous_assignee_id,assignee_id)
 VALUES(task.id,p_restaurant,task.revision,actor.id,verb,note,task.phase,previous_assignee,task.assignee_id);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant
 RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',task.id,'revision',task.revision,
  'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result)
 VALUES(p_restaurant,actor.id,p_request,p_payload,
  encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF verb='reassigned' THEN
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  SELECT p_restaurant,recipient,task.id,task.revision,task.title||': responsibility changed'
  FROM (SELECT DISTINCT unnest(ARRAY[previous_assignee,task.assignee_id]) AS recipient) recipients;
 ELSIF verb='ready' THEN
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  SELECT p_restaurant,id,task.id,task.revision,task.title||': '||task.phase
  FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND active
   AND candidate_operations.task_reviewer(id,p_restaurant,task.department,task.shift_id) AND id<>task.assignee_id;
 ELSE
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message)
  VALUES(p_restaurant,CASE WHEN task.phase='acceptance' THEN task.incoming_id ELSE task.assignee_id END,task.id,task.revision,task.title||': '||task.phase);
 END IF;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.coordinate_person_time_off()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE old_member uuid;new_member uuid;store text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_member:=OLD.member_id; END IF;
 IF TG_OP<>'DELETE' THEN new_member:=NEW.member_id; END IF;
 FOR store IN SELECT DISTINCT m.restaurant_id FROM candidate_identity.memberships m
 WHERE m.person_id IN (SELECT person_id FROM candidate_identity.memberships WHERE id IN (old_member,new_member))
 ORDER BY m.restaurant_id LOOP PERFORM candidate_operations.lock_scope(store,true); END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.coordinate_policy_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE before_row jsonb;after_row jsonb;scopes text[];scope text;
BEGIN
 before_row:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
 after_row:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
 scopes:=candidate_operations.coordination_scope_keys(TG_TABLE_NAME,before_row,after_row);
 -- A row trigger may already own its source tuple. Never wait for coordination in this order.
 -- Abort with a retryable serialization error if another command owns the scope.
 FOREACH scope IN ARRAY scopes LOOP PERFORM candidate_operations.lock_scope(scope,true); END LOOP;
 IF scopes IS DISTINCT FROM candidate_operations.coordination_scope_keys(TG_TABLE_NAME,before_row,after_row)
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='scope_coordination_retry'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.coordination_scope_keys(p_table text, p_old jsonb, p_new jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE keys text[];
BEGIN
 IF p_table='restaurants' THEN
  keys:=ARRAY[p_old->>'id',p_new->>'id'];
 ELSIF p_table IN ('memberships','shift_references','standard_references','closes') THEN
  keys:=ARRAY[p_old->>'restaurant_id',p_new->>'restaurant_id'];
 ELSIF p_table IN ('membership_capabilities','schedule_eligibility') THEN
  SELECT array_agg(DISTINCT restaurant_id ORDER BY restaurant_id) INTO keys FROM candidate_identity.memberships
  WHERE id IN ((coalesce(p_old->>'membership_id',p_old->>'member_id'))::uuid,(coalesce(p_new->>'membership_id',p_new->>'member_id'))::uuid);
 ELSIF p_table IN ('auth_links','sessions') THEN
  SELECT array_agg(DISTINCT m.restaurant_id ORDER BY m.restaurant_id) INTO keys FROM candidate_identity.memberships m
  WHERE m.person_id IN ((p_old->>'person_id')::uuid,(p_new->>'person_id')::uuid)
   OR EXISTS(SELECT 1 FROM candidate_identity.auth_links a WHERE a.person_id=m.person_id AND a.subject IN (p_old->>'subject',p_new->>'subject'));
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unsupported_coordination_table'; END IF;
 RETURN ARRAY(SELECT DISTINCT k FROM unnest(keys) AS s(k) WHERE k IS NOT NULL ORDER BY k);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.dish_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
DECLARE actor candidate_identity.memberships; incoming candidate_identity.memberships; task candidate_operations.tasks; source candidate_operations.tasks;
 link candidate_operations.dish_handoffs; participant candidate_operations.dish_participants; receipt candidate_operations.command_receipts;
 input jsonb; action text; step text; note text; next_phase text; cycle_id uuid; child_id uuid; due_at timestamptz;
 manager boolean; scope_revision integer; result jsonb; targets uuid[];
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';step:=input->>'step';note:=btrim(input->>'note');
 IF action IS NULL OR action NOT IN ('task.dish-pass','task.transition') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(note) NOT BETWEEN 1 AND 8000
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 IF action='task.dish-pass' THEN
  IF NOT input ?& ARRAY['incomingId','due','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('incomingId','due','note')) OR jsonb_typeof(input->'incomingId') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'due') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 ELSE
  IF step IS NULL OR step NOT IN ('ready','verify','fix','accept') OR NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_dish_command'; END IF;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
 SELECT * INTO participant FROM candidate_operations.dish_participants WHERE task_id=task.id;
 SELECT * INTO link FROM candidate_operations.dish_handoffs WHERE task_id=task.id;
 cycle_id:=coalesce(participant.cycle_id,link.cycle_id);
 IF cycle_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_task_required'; END IF;
 manager:=candidate_operations.dish_manager(actor.id,p_restaurant);
 IF action='task.dish-pass' OR step IN ('ready','accept') THEN
  IF actor.id<>task.assignee_id OR actor.position<>'Dishwasher' OR actor.department<>'BOH' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='dish_owner_denied'; END IF;
 ELSE
  IF NOT manager OR actor.id=task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF NOT candidate_operations.dish_shape(cycle_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
 IF action='task.dish-pass' THEN
  IF participant.slot IS DISTINCT FROM 0 OR task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position='Dishwasher' AND department='BOH' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  PERFORM 1 FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=cycle_id AND p.slot IN (1,2) AND p.member_id=incoming.id AND t.phase IN ('open','correction') FOR SHARE OF p,t;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  due_at:=(input->>'due')::timestamptz;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind) VALUES(p_restaurant,incoming.id,'BOH',left('Unfinished AM work: '||task.title,200),note,due_at,'open',1,'task') RETURNING id INTO child_id;
  INSERT INTO candidate_operations.dish_handoffs(task_id,restaurant_id,cycle_id,source_id) VALUES(child_id,p_restaurant,cycle_id,task.id);
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(child_id,p_restaurant,1,actor.id,'passed',note,'open',incoming.id);
  UPDATE candidate_operations.tasks SET revision=revision+1 WHERE id=task.id RETURNING * INTO task;
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,'passed',note||' Linked work: '||child_id,task.phase,task.assignee_id);
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) VALUES(p_restaurant,incoming.id,child_id,1,'Unfinished AM work awaits acceptance: '||note);
  result:=jsonb_build_object('recordId',child_id,'revision',1);
 ELSE
  IF step='accept' THEN
   IF link.task_id IS NULL OR link.accepted_by IS NOT NULL OR task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   UPDATE candidate_operations.dish_handoffs SET accepted_by=actor.id,accepted_at=clock_timestamp() WHERE task_id=task.id;
   UPDATE candidate_operations.tasks SET revision=revision+1 WHERE id=link.source_id RETURNING * INTO source;
   INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(source.id,p_restaurant,source.revision,actor.id,'incoming-accepted',note||' Linked work: '||task.id,source.phase,source.assignee_id);
   next_phase:=task.phase;
  ELSIF step='ready' THEN
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF link.task_id IS NOT NULL AND link.accepted_by IS DISTINCT FROM actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='acceptance_required'; END IF;
   IF participant.slot IN (1,2) AND EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND t.assignee_id=actor.id AND t.phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
   next_phase:='verification';
  ELSIF step='verify' THEN
   IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='closed';
  ELSE
   IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
  END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1 WHERE id=task.id RETURNING * INTO task;
  INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,step,note,task.phase,task.assignee_id);
  IF step IN ('ready','accept') THEN
   SELECT array_agg(id) INTO targets FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND candidate_operations.dish_manager(id,p_restaurant);
  ELSE targets:=ARRAY[task.assignee_id]; END IF;
  INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) SELECT p_restaurant,id,task.id,task.revision,task.title||': '||step FROM (SELECT DISTINCT unnest(targets) id) recipients WHERE id IS NOT NULL;
  result:=jsonb_build_object('recordId',task.id,'revision',task.revision);
 END IF;
 UPDATE candidate_operations.dish_cycles SET revision=revision+1 WHERE id=cycle_id;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=result||jsonb_build_object('workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.dish_manager(p_member uuid, p_restaurant text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[];
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 RETURN 'location.manage'=ANY(caps) OR 'tasks.manage'=ANY(caps) AND (actor.department='BOH' OR 'operations.store'=ANY(caps));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.dish_manager_read(p_member uuid, p_restaurant text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[];
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant AND active AND NOT schedule_only;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 RETURN 'location.manage'=ANY(caps) OR 'tasks.manage'=ANY(caps) AND (actor.department='BOH' OR 'operations.store'=ANY(caps));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.dish_only_label(p_label text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT btrim(p_label) ~* '^(dish|dish\s*washer)(\s*(\((am|pm|morning|evening|night)\)|am|pm))?$';
$function$

CREATE OR REPLACE FUNCTION candidate_operations.dish_shape(p_cycle uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT (SELECT count(*) FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle)=3
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=p_cycle AND (t.assignee_id<>p.member_id OR t.department<>'BOH' OR t.kind<>'task' OR t.restaurant_id<>p.restaurant_id))
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=p_cycle AND
 (t.department<>'BOH' OR t.kind<>'task' OR t.restaurant_id<>h.restaurant_id OR NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p WHERE p.cycle_id=p_cycle AND p.slot=0 AND p.task_id=h.source_id)
 OR NOT EXISTS(SELECT 1 FROM candidate_operations.dish_participants p WHERE p.cycle_id=p_cycle AND p.slot IN (1,2) AND p.member_id=t.assignee_id)
 OR h.accepted_by IS NOT NULL AND h.accepted_by<>t.assignee_id));
$function$

CREATE OR REPLACE FUNCTION candidate_operations.goal_authorized(p_member uuid, p_department text, p_cap text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability=p_cap
 WHERE m.id=p_member AND m.active AND NOT m.schedule_only AND (m.department=p_department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage')));
$function$

CREATE OR REPLACE FUNCTION candidate_operations.goal_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.employee_goals; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 guide candidate_operations.standard_references; input jsonb; result jsonb; cap text; step text; note text; next_phase text; creating boolean; linked boolean;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(p_payload->>'action','') NOT IN ('goal.create','goal.transition')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.employee_goals WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  cap:=CASE WHEN rec.type='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF NOT FOUND OR (p_payload->>'action'='goal.transition' AND NOT (actor.id=rec.owner_id OR actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  IF p_payload->>'action'='goal.create' AND (rec.type='required-correction' OR actor.id<>rec.owner_id) AND NOT candidate_operations.goal_authorized(actor.id,rec.department,cap) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF p_payload->>'action'='goal.transition' AND p_payload->'input'->>'step' IN ('coach','verify','fix') AND (actor.id<>rec.manager_id OR NOT candidate_operations.goal_authorized(actor.id,rec.department,cap)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';creating:=p_payload->>'action'='goal.create';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_fields'; END IF;
 IF creating THEN
  IF p_payload ? 'recordId' OR p_payload ? 'expectedRevision' OR NOT input ?& ARRAY['ownerId','managerId','title','definition','type','due'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('ownerId','managerId','title','definition','type','due','standardId','standardRevision')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_fields'; END IF;
  IF coalesce(input->>'type','') NOT IN ('development','required-correction') OR jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(input->'definition') IS DISTINCT FROM 'string' OR length(btrim(input->>'definition')) NOT BETWEEN 1 AND 2000
   OR jsonb_typeof(input->'due') IS DISTINCT FROM 'string' OR input->>'due' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' OR NOT isfinite((input->>'due')::timestamptz) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_value'; END IF;
  SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  IF NOT FOUND OR owner_member.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_owner_denied'; END IF;
  cap:=CASE WHEN input->>'type'='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF (input->>'type'='required-correction' OR owner_member.id<>actor.id) AND NOT candidate_operations.goal_authorized(actor.id,owner_member.department,cap) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  SELECT * INTO reviewer FROM candidate_identity.memberships WHERE id=(input->>'managerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only FOR SHARE;
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=reviewer.id ORDER BY capability FOR SHARE;
  IF reviewer.id IS NULL OR reviewer.id=owner_member.id OR NOT candidate_operations.goal_authorized(reviewer.id,owner_member.department,cap) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='goal_reviewer_denied'; END IF;
  linked:=input->>'type'='required-correction' OR input ? 'standardId';
  IF linked THEN
   SELECT * INTO guide FROM candidate_operations.standard_references WHERE id=(input->>'standardId')::uuid AND restaurant_id=p_restaurant AND department=owner_member.department AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='goal_guide_denied'; END IF;
   IF input->>'type'='development' OR input ? 'standardRevision' THEN
    IF jsonb_typeof(input->'standardRevision') IS DISTINCT FROM 'number' OR input->>'standardRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_guide_revision'; END IF;
    IF guide.revision<>(input->>'standardRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='goal_guide_changed'; END IF;
   END IF;
  ELSIF input ? 'standardRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_guide_revision'; END IF;
  next_phase:=CASE WHEN input->>'type'='required-correction' OR owner_member.id=actor.id THEN 'active' ELSE 'proposed' END;
  step:=CASE WHEN input->>'type'='required-correction' THEN 'required-correction-assigned' WHEN next_phase='active' THEN 'employee-chosen' ELSE 'proposed' END;note:=btrim(input->>'definition');
  INSERT INTO candidate_operations.employee_goals(restaurant_id,department,owner_id,manager_id,title,definition,type,due,phase,standard_id,standard_revision)
   VALUES(p_restaurant,owner_member.department,owner_member.id,reviewer.id,btrim(input->>'title'),note,input->>'type',(input->>'due')::timestamptz,next_phase,guide.id,guide.revision) RETURNING * INTO rec;
 ELSE
  IF NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 OR coalesce(input->>'step','') NOT IN ('accept','decline','practice','coach','ready','verify','fix','cancel') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_goal_transition'; END IF;
  SELECT * INTO rec FROM candidate_operations.employee_goals WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  cap:=CASE WHEN rec.type='development' THEN 'people.manage' ELSE 'tasks.manage' END;
  IF NOT (actor.id=rec.owner_id OR actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='goal_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  step:=input->>'step';note:=btrim(input->>'note');next_phase:=rec.phase;
  IF step IN ('accept','decline','practice','ready') AND actor.id<>rec.owner_id OR step IN ('coach','verify','fix') AND (actor.id<>rec.manager_id OR NOT candidate_operations.goal_authorized(actor.id,rec.department,cap)) OR step='cancel' AND NOT (actor.id=rec.manager_id AND candidate_operations.goal_authorized(actor.id,rec.department,cap) OR actor.id=rec.owner_id AND rec.type='development') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF step IN ('accept','decline') THEN
   IF rec.type<>'development' OR rec.phase<>'proposed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:=CASE WHEN step='accept' THEN 'active' ELSE 'declined' END;
  ELSIF step IN ('practice','coach','ready') THEN
   IF rec.phase<>'active' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF step='ready' THEN next_phase:='verification'; END IF;
  ELSIF step IN ('verify','fix') THEN
   IF rec.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:=CASE WHEN step='verify' THEN 'closed' ELSE 'active' END;
  ELSE
   IF rec.phase NOT IN ('proposed','active','verification') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   next_phase:='cancelled';
  END IF;
  IF rec.standard_id IS NOT NULL AND step IN ('accept','practice','coach','ready','verify') THEN
   PERFORM 1 FROM candidate_operations.standard_references WHERE id=rec.standard_id AND restaurant_id=p_restaurant AND revision=rec.standard_revision AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='goal_guide_changed'; END IF;
  END IF;
  UPDATE candidate_operations.employee_goals SET phase=next_phase,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 INSERT INTO candidate_operations.goal_events VALUES(rec.id,rec.revision,actor.id,step,note,to_jsonb(rec),clock_timestamp());
 IF step<>'practice' THEN
  INSERT INTO candidate_operations.goal_outbox SELECT rec.id,rec.revision,target,rec.title||': '||rec.phase,NULL FROM (SELECT DISTINCT unnest(CASE WHEN step='coach' THEN ARRAY[rec.owner_id] ELSE ARRAY[rec.owner_id,rec.manager_id] END) target) recipients;
 END IF;
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.invalidate_offer_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM candidate_operations.invalidate_schedule_offers(to_jsonb(OLD)->>'restaurant_id'); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM candidate_operations.invalidate_schedule_offers(to_jsonb(NEW)->>'restaurant_id'); END IF;
 RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.invalidate_schedule_inputs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE scope_id text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='memberships' THEN
   IF ROW(OLD.restaurant_id,OLD.department,OLD.position,OLD.active,OLD.schedule_only,OLD.person_id)
    IS NOT DISTINCT FROM ROW(NEW.restaurant_id,NEW.department,NEW.position,NEW.active,NEW.schedule_only,NEW.person_id)
   THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME='schedule_eligibility' THEN
   IF ROW(OLD.member_id,OLD.job,OLD.source,OLD.active)
    IS NOT DISTINCT FROM ROW(NEW.member_id,NEW.job,NEW.source,NEW.active)
   THEN RETURN NULL; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='schedule_eligibility' THEN
  SELECT restaurant_id INTO scope_id FROM candidate_identity.memberships
   WHERE id=(CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'member_id' ELSE to_jsonb(NEW)->>'member_id' END)::uuid;
 ELSE scope_id:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD)->>'restaurant_id' ELSE to_jsonb(NEW)->>'restaurant_id' END; END IF;
 UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=scope_id;
 IF TG_TABLE_NAME='schedule_eligibility' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'member_id' IS DISTINCT FROM to_jsonb(NEW)->>'member_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL
   WHERE restaurant_id=(SELECT restaurant_id FROM candidate_identity.memberships WHERE id=(to_jsonb(OLD)->>'member_id')::uuid);
 END IF;
 IF TG_TABLE_NAME='memberships' AND TG_OP='UPDATE' AND to_jsonb(OLD)->>'restaurant_id' IS DISTINCT FROM to_jsonb(NEW)->>'restaurant_id' THEN
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=to_jsonb(OLD)->>'restaurant_id';
 END IF;
 RETURN NULL;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.invalidate_schedule_offers(p_restaurant text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE rec candidate_operations.schedule_offers;reason text;changed boolean:=false;
BEGIN
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.leadership_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships;target candidate_identity.memberships;rec candidate_operations.leadership_references;previous candidate_operations.leadership_references;scope candidate_identity.restaurants;receipt candidate_operations.command_receipts;input jsonb;action text;area text;result jsonb;updating boolean;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 action:=p_payload->>'action';input:=p_payload->'input';updating:=p_payload ? 'recordId';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('leadership.assign','leadership.revoke') OR jsonb_typeof(input) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR action='leadership.revoke' AND NOT updating THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_leadership_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.linked_task_current(p_restaurant text, p_shift uuid, p_member uuid, p_department text, p_due timestamp with time zone, p_revision integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE shift candidate_operations.shift_references;
BEGIN
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant FOR SHARE;
 RETURN FOUND AND shift.member_id=p_member AND shift.department=p_department AND shift.position<>'Dishwasher'
  AND shift.published AND NOT shift.cancelled AND shift.released_at IS NULL AND shift.revision=p_revision
  AND p_due BETWEEN shift.starts_at AND shift.ends_at;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_goals(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid; scope_revision integer;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT g.id FROM candidate_operations.employee_goals g WHERE g.restaurant_id=p_restaurant AND (p_after IS NULL OR g.id>p_after)
 AND (g.owner_id=actor.id OR g.manager_id=actor.id AND candidate_operations.goal_authorized(actor.id,g.department,CASE WHEN g.type='development' THEN 'people.manage' ELSE 'tasks.manage' END)) ORDER BY g.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'kind','goal','locationId',g.restaurant_id,'area',g.department,'ownerId',g.owner_id,'revision',g.revision,
 'data',(CASE WHEN g.station_learning IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationLearning',g.station_learning) END)||jsonb_build_object('title',g.title,'definition',g.definition,'type',g.type,'managerId',g.manager_id,'due',g.due,'phase',g.phase,'history',(SELECT jsonb_agg(jsonb_build_object('action',e.action,'note',e.note,'actorId',e.actor_id,'at',e.recorded_at) ORDER BY e.revision) FROM candidate_operations.goal_events e WHERE e.goal_id=g.id))||CASE WHEN g.standard_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('standardId',g.standard_id,'standardRevision',g.standard_revision) END) ORDER BY g.id),'[]') INTO items FROM candidate_operations.employee_goals g WHERE g.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope_revision,'coverage','manual-and-station-goals');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_context(p_subject text, p_member uuid, p_restaurant text, p_kind text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_kind IS NULL OR p_kind NOT IN ('roster','availability') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_schedule_context'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 IF p_kind='roster' THEN
  SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT id FROM candidate_identity.memberships
   WHERE restaurant_id=p_restaurant AND (active OR schedule_only) AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1) page;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'locationId',m.restaurant_id,'name',p.name,'area',m.department,'position',m.position,'active',m.active,'scheduleOnly',m.schedule_only,
    'qualifications',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_identity.schedule_eligibility WHERE member_id=m.id AND active AND source='qualification'),
    'scheduleJobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_identity.schedule_eligibility WHERE member_id=m.id AND active AND source='schedule-job')) ORDER BY m.id),'[]')
   INTO items FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE m.id=ANY(selected[1:p_limit]);
 ELSE
  SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT id FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant
   AND (p_after IS NULL OR a.id>p_after) AND (a.member_id=actor.id
    OR 'schedule.manage'=ANY(caps) AND (actor.department=a.department OR 'location.manage'=ANY(caps))
    OR a.status='approved' AND 'schedule.publish'=ANY(caps) AND (actor.department=a.department OR 'location.manage'=ANY(caps)))
   ORDER BY id LIMIT p_limit+1) page;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind','availability','locationId',a.restaurant_id,'ownerId',a.member_id,'area',a.department,'revision',a.revision,'updatedAt',a.updated_at,'data',a.data) ORDER BY a.id),'[]')
   INTO items FROM candidate_operations.availability_references a WHERE a.id=ANY(selected[1:p_limit]);
 END IF;
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','schedule-context-references-only');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_leadership(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_offers(p_subject text, p_member uuid, p_restaurant text, p_mode text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_shifts(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after) AND (s.published OR s.ends_at>statement_timestamp())
  AND (
   (caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)))
   OR s.published AND (s.member_id=actor.id
    OR actor.position<>'Dishwasher' AND ('location.manage'=ANY(caps) OR 'people.manage'=ANY(caps) AND actor.department=s.department)
    OR 'close.confirm'=ANY(caps) AND (actor.department=s.department OR 'location.manage'=ANY(caps)
      OR actor.position<>'Dishwasher' AND 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND s.department IN ('FOH','BOH')))
  ) ORDER BY s.id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','shift','locationId',s.restaurant_id,'area',s.department,'ownerId',s.member_id,'revision',s.revision,
  'data',jsonb_build_object('personId',s.member_id,'position',s.position,'start',s.starts_at,'end',s.ends_at,'published',s.published,'cancelled',s.cancelled,'releasedAt',s.released_at)||CASE WHEN s.station_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision) END||CASE WHEN caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) AND EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending') THEN jsonb_build_object('reviewFlags',(SELECT jsonb_agg(jsonb_build_object('reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.request_id) FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending')) ELSE '{}'::jsonb END) ORDER BY s.id),'[]')
 INTO items FROM candidate_operations.shift_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','shift-references-only');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_stations(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT s.id FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after)
 AND caps&&ARRAY['people.manage','schedule.manage','schedule.change','schedule.publish'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) ORDER BY s.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','station','locationId',s.restaurant_id,'area',s.department,'revision',s.revision,
 'data',jsonb_build_object('issuedGoals',(SELECT coalesce(jsonb_agg(jsonb_build_object('personId',r.member_id,'templateId',r.template_id,'goalId',r.goal_id) ORDER BY r.member_id,r.template_id),'[]') FROM candidate_operations.station_goal_receipts r WHERE r.station_id=s.id),'title',s.title,'status',s.status,'levels',s.levels,'independentLevel',s.independent_level,'definitionRevision',s.definition_revision,'setup',CASE WHEN NOT s.configured THEN NULL WHEN s.setup_data IS NOT NULL THEN s.setup_data ELSE jsonb_build_object('allJobMembers',s.all_job_members,
 'jobs',(SELECT coalesce(jsonb_agg(job ORDER BY job),'[]') FROM candidate_operations.station_jobs WHERE station_id=s.id),
 'memberIds',(SELECT coalesce(jsonb_agg(member_id ORDER BY member_id),'[]') FROM candidate_operations.station_members WHERE station_id=s.id)) END)) ORDER BY s.id),'[]') INTO items FROM candidate_operations.station_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','station-scheduling-references-only');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_staffing(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_tasks(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size';
 END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT id FROM candidate_operations.tasks WHERE restaurant_id=p_restaurant
   AND (assignee_id=actor.id OR outgoing_id IS NOT DISTINCT FROM actor.id OR incoming_id IS NOT DISTINCT FROM actor.id OR (candidate_operations.task_reviewer_read(actor.id,p_restaurant,department,shift_id)))
   AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(candidate_operations.read_task(p_subject,p_member,p_restaurant,id)
  ORDER BY ordinal),'[]'::jsonb) INTO items
 FROM unnest(selected) WITH ORDINALITY AS entry(id,ordinal) WHERE ordinal<=p_limit;
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.list_time_off(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  'flaggedShifts',CASE WHEN 'schedule.manage'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.shift_id,'revision',f.shift_revision,'reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.shift_id),'[]') FROM candidate_operations.time_off_shift_flags f WHERE f.request_id=r.id AND f.restaurant_id=p_restaurant) ELSE NULL END,
  'affectedShifts',CASE WHEN 'schedule.manage'=ANY(caps) AND (actor.department=r.department OR 'location.manage'=ANY(caps)) THEN
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision) ORDER BY s.starts_at,s.id),'[]') FROM candidate_operations.shift_references s WHERE s.restaurant_id=r.restaurant_id AND s.member_id=r.member_id AND NOT s.cancelled AND s.starts_at<r.ends_at AND s.ends_at>r.starts_at) ELSE NULL END) ORDER BY r.id),'[]') INTO items FROM candidate_operations.time_off_references r WHERE r.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','time-off-only');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.lock_scope(p_restaurant text, p_nowait boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_nowait THEN
  BEGIN
   PERFORM 1 FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='scope_coordination_retry';
  END;
 ELSE
  PERFORM 1 FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.manager_handoff_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; target candidate_identity.memberships; incoming candidate_identity.memberships;
 task candidate_operations.tasks; shift candidate_operations.shift_references; receipt candidate_operations.command_receipts;
 input jsonb; action text; step text; note text; next_phase text; scope_revision integer; result jsonb; previous_owner uuid; targets uuid[];
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';step:=input->>'step';
 IF action IS NULL OR action NOT IN ('task.create','task.transition') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','recordId','expectedRevision','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT(task.assignee_id=actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR task.outgoing_id IS NOT DISTINCT FROM actor.id OR candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF action='task.create' OR step IN ('verify','fix') THEN
   IF NOT candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
  ELSIF step IN ('accept','dispute') THEN
   IF actor.id IS DISTINCT FROM task.incoming_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  ELSIF step='ready' THEN
   IF actor.id<>task.assignee_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF action='task.create' THEN
  IF input->>'kind' IS DISTINCT FROM 'handoff' OR NOT input ?& ARRAY['title','detail','kind','ownerId','incomingId','shiftId','due']
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('title','detail','kind','ownerId','incomingId','shiftId','due'))
  OR EXISTS(SELECT 1 FROM jsonb_each(input) f WHERE jsonb_typeof(f.value)<>'string') OR p_payload ? 'recordId' OR p_payload ? 'expectedRevision'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
  SELECT * INTO target FROM candidate_identity.memberships WHERE id=(input->>'ownerId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,target.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
  SELECT * INTO incoming FROM candidate_identity.memberships WHERE id=(input->>'incomingId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR incoming.id=target.id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,incoming.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='incoming_denied'; END IF;
  SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(input->>'shiftId')::uuid AND restaurant_id=p_restaurant AND member_id=target.id AND department=target.department AND published AND NOT cancelled AND released_at IS NULL AND position<>'Dishwasher' FOR SHARE;
  IF NOT FOUND OR (input->>'due')::timestamptz NOT BETWEEN shift.starts_at AND shift.ends_at THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF length(btrim(input->>'title')) NOT BETWEEN 1 AND 200 OR length(btrim(input->>'detail')) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_text'; END IF;
  INSERT INTO candidate_operations.tasks(restaurant_id,assignee_id,department,title,detail,due,phase,revision,kind,incoming_id,shift_id,shift_revision)
  VALUES(p_restaurant,target.id,target.department,btrim(input->>'title'),btrim(input->>'detail'),(input->>'due')::timestamptz,'open',1,'handoff',incoming.id,shift.id,shift.revision) RETURNING * INTO task;
  note:=task.detail;step:='assigned';targets:=ARRAY[target.id];
 ELSE
  IF NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note')) OR step IS NULL OR step NOT IN ('ready','verify','fix','accept','dispute')
  OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_manager_handoff'; END IF;
  note:=btrim(input->>'note');IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
  SELECT * INTO task FROM candidate_operations.tasks WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant AND kind='handoff' AND shift_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied'; END IF;
  IF step='ready' AND actor.id<>task.assignee_id OR step IN ('accept','dispute') AND actor.id IS DISTINCT FROM task.incoming_id OR step IN ('verify','fix') AND (actor.id=task.assignee_id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,task.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF task.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=task.shift_id AND restaurant_id=p_restaurant AND member_id=coalesce(task.outgoing_id,task.assignee_id) AND published AND NOT cancelled AND released_at IS NULL FOR SHARE;
  IF NOT FOUND OR shift.revision<>task.shift_revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
  IF step='ready' THEN
   IF task.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='verification';
  ELSIF step='verify' THEN
   IF task.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:=CASE WHEN task.outgoing_id IS NULL THEN 'acceptance' ELSE 'closed' END;
  ELSIF step='fix' THEN
   IF task.phase='closed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
  ELSE
   IF task.phase<>'acceptance' OR task.outgoing_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
   IF step='dispute' THEN next_phase:='correction';ELSE previous_owner:=task.assignee_id;next_phase:='open';END IF;
  END IF;
  UPDATE candidate_operations.tasks SET phase=next_phase,revision=revision+1,outgoing_id=coalesce(outgoing_id,previous_owner),
   assignee_id=CASE WHEN previous_owner IS NOT NULL THEN actor.id ELSE assignee_id END,
   closing_handoff=CASE WHEN previous_owner IS NOT NULL THEN jsonb_build_object('outgoingId',previous_owner,'acceptedBy',actor.id,'acceptedAt',clock_timestamp()) ELSE closing_handoff END WHERE id=task.id RETURNING * INTO task;
  targets:=ARRAY[task.assignee_id,previous_owner];
  IF task.phase='verification' OR previous_owner IS NOT NULL THEN
   SELECT targets||coalesce(array_agg(id),'{}') INTO targets FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND candidate_operations.closing_manager(id,p_restaurant,task.department,'tasks.manage') AND id<>task.assignee_id;
  END IF;
  IF task.phase='acceptance' THEN targets:=ARRAY[task.incoming_id]; END IF;
 END IF;
 INSERT INTO candidate_operations.task_events(task_id,restaurant_id,revision,actor_id,action,note,phase,previous_assignee_id,assignee_id) VALUES(task.id,p_restaurant,task.revision,actor.id,step,note,task.phase,previous_owner,task.assignee_id);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',task.id,'revision',task.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,p_member,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.notification_outbox(restaurant_id,recipient_id,task_id,revision,message) SELECT p_restaurant,id,task.id,task.revision,task.title||': '||task.phase FROM (SELECT DISTINCT unnest(targets) id) recipients WHERE id IS NOT NULL;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.offer_coordinator(p_member uuid, p_department text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT candidate_operations.goal_authorized(p_member,p_department,'schedule.manage') OR candidate_operations.goal_authorized(p_member,p_department,'schedule.change');
$function$

CREATE OR REPLACE FUNCTION candidate_operations.offer_duties(p_shift uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'standardId',standard_id,'standardRevision',standard_revision,'title',standard_snapshot->>'title','zone',zone,'criteria',standard_snapshot->'criteria','source',standard_snapshot->'source','version',standard_snapshot->'version','due',to_char(due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY id),'[]') FROM candidate_operations.closes WHERE shift_id=p_shift AND phase<>'cancelled';
$function$

CREATE OR REPLACE FUNCTION candidate_operations.offer_eligible(p_offer candidate_operations.schedule_offers, p_member uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
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
 OR candidate_operations.person_shift_conflict(m.id,s.starts_at,s.ends_at,s.id)
 OR candidate_operations.person_time_off_conflict(m.id,s.starts_at,s.ends_at)
 OR EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND candidate_operations.availability_period_conflict(data,s.starts_at,s.ends_at,zone)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND (m.position='Dishwasher' OR m.id IN (c.manager_id,c.verifier_id) OR c.due<s.starts_at OR c.due>s.ends_at OR c.department<>m.department OR p_offer.mode='coverage' AND c.standard_snapshot->>'position'<>s.position OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=m.id AND restaurant_id=p_offer.restaurant_id AND active AND position=c.standard_snapshot->>'position'))) THEN RETURN false; END IF;
 RETURN true;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.offer_issue(p_offer candidate_operations.schedule_offers)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE s candidate_operations.shift_references;
BEGIN
 IF p_offer.status NOT IN ('open','pending','accepted-by-replacement') THEN RETURN 'offer_finished'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_offer.shift_id AND restaurant_id=p_offer.restaurant_id;
 IF NOT FOUND OR NOT s.published OR s.cancelled OR s.released_at IS NOT NULL THEN RETURN 'offer_shift_unavailable'; END IF;
 IF s.ends_at<=statement_timestamp() THEN RETURN 'offer_shift_ended'; END IF;
 IF ROW(s.member_id,s.revision,s.position,s.starts_at,s.ends_at,s.department) IS DISTINCT FROM ROW(p_offer.owner_id,p_offer.shift_revision,p_offer.position,p_offer.starts_at,p_offer.ends_at,p_offer.department) THEN RETURN 'offer_shift_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=p_offer.owner_id AND restaurant_id=p_offer.restaurant_id AND active AND NOT schedule_only) THEN RETURN 'offer_owner_inactive'; END IF;
 IF p_offer.mode='coverage' AND s.starts_at<=statement_timestamp() THEN RETURN 'offer_shift_started'; END IF;
 IF candidate_operations.offer_duties(s.id)<>p_offer.duties THEN RETURN 'offer_duties_changed'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c LEFT JOIN candidate_operations.standard_references g ON g.id=c.standard_id AND g.restaurant_id=p_offer.restaurant_id WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND g.status IS DISTINCT FROM 'approved') THEN RETURN 'offer_guide_unavailable'; END IF;
 RETURN '';
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.overnight_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; incoming candidate_identity.memberships; issue candidate_operations.overnight_issues; outgoing candidate_operations.leadership_references; opening candidate_operations.leadership_references;
 receipt candidate_operations.command_receipts; input jsonb; action text; step text; note text; scope_revision integer; result jsonb; targets uuid[]; escalation uuid[]; previous_owner uuid; previous_incoming uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
  PERFORM 1 FROM candidate_identity.membership_capabilities c JOIN candidate_identity.memberships m ON m.id=c.membership_id WHERE m.restaurant_id=p_restaurant ORDER BY c.membership_id,c.capability FOR SHARE OF c;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.permitted_shift_change(p_old candidate_operations.shift_references, p_new candidate_operations.shift_references)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.shift_change_permits WHERE shift_id=p_old.id AND transaction_id=txid_current() AND old_hash=encode(sha256(convert_to(to_jsonb(p_old)::text,'UTF8')),'hex') AND new_hash=encode(sha256(convert_to(to_jsonb(p_new)::text,'UTF8')),'hex'));
$function$

CREATE OR REPLACE FUNCTION candidate_operations.person_shift_conflict(p_member uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_exclude uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(
  SELECT 1 FROM candidate_identity.memberships target
  JOIN candidate_operations.person_shift_bookings booking ON booking.person_id=target.person_id
  WHERE target.id=p_member AND booking.shift_id IS DISTINCT FROM p_exclude
   AND booking.period && tstzrange(p_start,p_end,'[)')
 );
$function$

CREATE OR REPLACE FUNCTION candidate_operations.person_time_off_conflict(p_member uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships target
 JOIN candidate_identity.memberships peer ON peer.person_id=target.person_id
 JOIN candidate_operations.time_off_references leave_row ON leave_row.member_id=peer.id
 WHERE target.id=p_member AND leave_row.status='approved' AND leave_row.starts_at<p_end AND leave_row.ends_at>p_start);
$function$

CREATE OR REPLACE FUNCTION candidate_operations.propose_changed_shift_goals(p_actor uuid, p_restaurant text, p_shift uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE rec candidate_operations.shift_references; station candidate_operations.station_references; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships; scope candidate_identity.restaurants; template jsonb; guide candidate_operations.standard_references; goal candidate_operations.employee_goals; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT rec.published OR rec.cancelled THEN RETURN; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=rec.member_id;
 SELECT * INTO station FROM candidate_operations.station_references WHERE id=rec.station_id AND restaurant_id=p_restaurant AND status='active' FOR UPDATE;
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
   INSERT INTO candidate_operations.goal_events VALUES(goal.id,1,p_actor,'station-goal-proposed','Proposed from the published station shift. No training clearance granted.',to_jsonb(goal),applied_at);
   INSERT INTO candidate_operations.goal_outbox SELECT goal.id,1,target,'Station learning goal proposed: '||goal.title,NULL FROM unnest(ARRAY[owner_member.id,reviewer.id]) target;
   INSERT INTO candidate_operations.station_goal_receipts VALUES(station.id,owner_member.id,template->>'id',goal.id);issued:=true;
  END LOOP;
 END IF;
 IF issued THEN
  UPDATE candidate_operations.station_references SET revision=revision+1 WHERE id=station.id RETURNING * INTO station;
  INSERT INTO candidate_operations.station_events VALUES(station.id,station.revision,p_actor,to_jsonb(station),'Station learning goals proposed',applied_at);
 END IF;

END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.protect_closing_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id AND phase<>'cancelled') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_shift_protected'; END IF;
  IF ROW(NEW.member_id,NEW.department,NEW.position,NEW.starts_at,NEW.ends_at,NEW.restaurant_id) IS DISTINCT FROM ROW(OLD.member_id,OLD.department,OLD.position,OLD.starts_at,OLD.ends_at,OLD.restaurant_id) AND NOT candidate_operations.permitted_shift_change(OLD,NEW) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_shift_protected'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id AND phase NOT IN ('closed','cancelled')) AND (NEW.cancelled OR NEW.released_at IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_pending'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.protect_linked_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
  IF ROW(NEW.member_id,NEW.department,NEW.position,NEW.starts_at,NEW.ends_at,NEW.restaurant_id) IS DISTINCT FROM ROW(OLD.member_id,OLD.department,OLD.position,OLD.starts_at,OLD.ends_at,OLD.restaurant_id) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected';
  END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=OLD.id AND phase<>'closed') AND (NOT NEW.published OR NEW.cancelled OR NEW.released_at IS NOT NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_task_pending';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.protect_station_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF ROW(NEW.station_id,NEW.station_name,NEW.station_revision) IS DISTINCT FROM ROW(OLD.station_id,OLD.station_name,OLD.station_revision)
 AND (EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=OLD.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=OLD.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=OLD.id))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.publish_shift(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT candidate_operations.publish_shift_core(p_subject,p_member,p_restaurant,p_request,p_payload,false);
$function$

CREATE OR REPLACE FUNCTION candidate_operations.publish_shift_core(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb, p_batch boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_batch THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='batch_period_required'; END IF;
 RETURN candidate_operations.publish_shift_core(p_subject,p_member,p_restaurant,p_request,p_payload,false,NULL,NULL);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.publish_shift_core(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb, p_batch boolean, p_week_start timestamp with time zone, p_week_end timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; owner_member candidate_identity.memberships; reviewer candidate_identity.memberships;
 rec candidate_operations.shift_references; station candidate_operations.station_references; guide candidate_operations.standard_references;
 scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; goal candidate_operations.employee_goals;
 template jsonb; note text; result jsonb; issued boolean:=false; applied_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_batch AND (p_week_start IS NULL OR p_week_end IS NULL OR p_week_end<=p_week_start) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_batch_period'; END IF;
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR jsonb_typeof(p_payload->'input') IS DISTINCT FROM 'object' OR NOT (p_payload->'input') ? 'note'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'input') k WHERE k<>'note') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_publication_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
 IF p_batch AND (rec.starts_at<p_week_start OR rec.starts_at>=p_week_end) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
 IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
 IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
 IF NOT p_batch AND NOT EXISTS(SELECT 1 FROM candidate_operations.publication_reviews WHERE shift_id=rec.id AND shift_revision=rec.revision AND workspace_revision=scope.revision AND no_staffing AND no_closing=NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled'))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=rec.department AND n.starts_at<rec.ends_at AND n.ends_at>rec.starts_at AND (n.status='approved' AND NOT p_batch OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=rec.position)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='staffing_publication_review_required'; END IF;
 IF jsonb_array_length(candidate_operations.closing_publication_issues(rec.id,p_restaurant))>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_publication_review_required'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id) AND NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id AND phase<>'cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='publication_linked_work_held'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;
 SELECT * INTO owner_member FROM candidate_identity.memberships WHERE id=rec.member_id AND restaurant_id=p_restaurant AND department=rec.department AND (active OR schedule_only) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility WHERE member_id=owner_member.id AND active AND job=rec.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND id<>rec.id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF candidate_operations.person_time_off_conflict(rec.member_id,rec.starts_at,rec.ends_at) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.publish_week(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts; review jsonb; input jsonb; selection jsonb; closing jsonb;
 ids jsonb; result jsonb; effects jsonb:='[]'; effect jsonb; coverage_note text:=''; batch_id uuid:=gen_random_uuid(); selected_shift candidate_operations.shift_references;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.publish-batch' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_command'; END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['weekStart','drafts','planningReview','confirmed','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('weekStart','drafts','planningReview','confirmed','note','coverageAcknowledged','coverageNote')) OR input->'confirmed' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'drafts') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'drafts') NOT BETWEEN 1 AND 100 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_fields'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'drafts') d WHERE jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT d ?& ARRAY['id','revision','closing'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE k NOT IN ('id','revision','closing')) OR jsonb_typeof(d->'revision') IS DISTINCT FROM 'number' OR d->>'revision' !~ '^[1-9][0-9]*$' OR jsonb_typeof(d->'closing') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'drafts') d WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=(d->>'id')::uuid AND s.restaurant_id=p_restaurant AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 SELECT jsonb_agg(d->>'id') INTO ids FROM jsonb_array_elements(input->'drafts') d;
 review:=candidate_operations.weekly_review(p_subject,p_member,p_restaurant,input->>'weekStart',ids);
 IF jsonb_typeof(input->'planningReview') IS DISTINCT FROM 'string' OR input->>'planningReview'<>review->>'planningReview' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='planning_review_conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=p_restaurant AND workspace_revision=scope.revision) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='weekly_scope_review_required'; END IF;
 IF (review->>'plannedGapCount')::integer>0 THEN
  IF input->'coverageAcknowledged' IS DISTINCT FROM 'true'::jsonb OR jsonb_typeof(input->'coverageNote') IS DISTINCT FROM 'string' OR length(btrim(input->>'coverageNote')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='staffing_gap_plan_required'; END IF;
  coverage_note:=btrim(input->>'coverageNote');
 END IF;
 -- Exact closing selections are reviewed before any child publishes; later failure still rolls back all children.
 FOR selection IN SELECT value FROM jsonb_array_elements(input->'drafts') LOOP
  SELECT * INTO selected_shift FROM candidate_operations.shift_references WHERE id=(selection->>'id')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF selected_shift.revision<>(selection->>'revision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision) ORDER BY c.id),'[]') INTO closing FROM candidate_operations.closes c WHERE c.shift_id=selected_shift.id AND c.phase<>'cancelled';
  IF selection->'closing'<>closing THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='closing_selection_conflict'; END IF;
 END LOOP;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 FOR selection IN SELECT d FROM jsonb_array_elements(input->'drafts') d JOIN candidate_operations.shift_references s ON s.id=(d->>'id')::uuid ORDER BY s.starts_at,s.id LOOP
  effect:=candidate_operations.publish_shift_core(p_subject,p_member,p_restaurant,gen_random_uuid(),jsonb_build_object('action','shift.publish','recordId',selection->>'id','expectedRevision',selection->'revision','input',jsonb_build_object('note',btrim(input->>'note'))),true,(review->'period'->>'start')::timestamptz,(review->'period'->>'end')::timestamptz);
  effects:=effects||jsonb_build_array(effect);
  IF coverage_note<>'' THEN UPDATE candidate_operations.publication_events SET data=data||jsonb_build_object('staffingException',coverage_note) WHERE shift_id=(selection->>'id')::uuid AND revision=(effect->>'revision')::integer; END IF;
 END LOOP;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 result:=jsonb_build_object('recordId',batch_id,'revision',1,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false,'published',effects);
 INSERT INTO candidate_operations.publication_batches VALUES(batch_id,p_restaurant,actor.id,p_payload,result,review,coverage_note,clock_timestamp());
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.published_change_allowed(p_member uuid, p_restaurant text, p_department text, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT candidate_operations.goal_authorized(p_member,p_department,'schedule.change') AND
 (EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=p_member AND active AND capability='location.manage') OR EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE member_id=p_member AND restaurant_id=p_restaurant AND department=p_department AND active AND starts_at<=p_start AND ends_at>=p_end));
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_close(p_subject text, p_member uuid, p_restaurant text, p_close uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; assigned candidate_operations.closes; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=p_close AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (actor.id=assigned.owner_id OR actor.id IS NOT DISTINCT FROM assigned.helper_id OR actor.id=assigned.manager_id OR actor.id IS NOT DISTINCT FROM assigned.verifier_id OR candidate_operations.closing_manager_read(actor.id,p_restaurant,assigned.department,'tasks.manage')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at)||CASE WHEN answers IS NOT NULL THEN jsonb_build_object('answers',answers) ELSE '{}'::jsonb END||coalesce(details,'{}'::jsonb) ORDER BY revision),'[]') INTO history FROM candidate_operations.close_events WHERE close_id=assigned.id;
 RETURN jsonb_build_object('id',assigned.id,'kind','close','locationId',assigned.restaurant_id,'area',assigned.department,'ownerId',assigned.owner_id,'revision',assigned.revision,
  'data',jsonb_build_object('shiftId',assigned.shift_id,'standardId',assigned.standard_id,'standardRevision',assigned.standard_revision,'standard',assigned.standard_snapshot,'managerId',assigned.manager_id,'due',assigned.due,'phase',assigned.phase,'answers',assigned.answers,'history',history)||CASE WHEN assigned.correction IS NOT NULL THEN jsonb_build_object('correction',assigned.correction) ELSE '{}'::jsonb END||CASE WHEN assigned.attention IS NOT NULL THEN jsonb_build_object('attention',assigned.attention) ELSE '{}'::jsonb END||CASE WHEN assigned.verifier_id IS NOT NULL THEN jsonb_build_object('verifierId',assigned.verifier_id) ELSE '{}'::jsonb END);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_dish_cycle(p_subject text, p_member uuid, p_restaurant text, p_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE summary jsonb; records jsonb; manager boolean;
BEGIN
 summary:=candidate_operations.read_dish_cycle_summary(p_subject,p_member,p_restaurant,p_cycle);manager:=candidate_operations.dish_manager_read(p_member,p_restaurant);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'kind','task','locationId',p_restaurant,'area',t.department,'ownerId',t.assignee_id,'revision',t.revision,'data',
  jsonb_build_object('title',t.title,'detail',t.detail,'kind','task','phase',t.phase,'due',t.due,'history',
   (SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at) ORDER BY revision),'[]') FROM candidate_operations.task_events WHERE task_id=t.id))
  ||CASE WHEN p.task_id IS NOT NULL THEN jsonb_build_object('dishCheckout',jsonb_build_object('cycleId',p_cycle,'businessDate',summary->>'businessDate','shift',CASE WHEN p.slot=0 THEN 'AM' ELSE 'PM' END,'participantIds',summary->'participantIds')) ELSE jsonb_build_object('dishHandoff',jsonb_build_object('sourceId',h.source_id,'cycleId',p_cycle,'businessDate',summary->>'businessDate','acceptedBy',coalesce(h.accepted_by::text,''),'acceptedAt',h.accepted_at)) END
  ||CASE WHEN p.slot=0 THEN jsonb_build_object('dishHandoffs',(SELECT coalesce(jsonb_agg(task_id),'[]') FROM candidate_operations.dish_handoffs WHERE source_id=t.id),'dishHandoffReceiptView',NOT manager,'dishHandoffAcceptances',(SELECT coalesce(jsonb_agg(jsonb_build_object('handoffId',task_id,'acceptedBy',accepted_by,'acceptedAt',accepted_at)) FILTER(WHERE accepted_by IS NOT NULL),'[]') FROM candidate_operations.dish_handoffs WHERE source_id=t.id)) ELSE '{}'::jsonb END
 )),'[]') INTO records FROM candidate_operations.tasks t
 LEFT JOIN candidate_operations.dish_participants p ON p.task_id=t.id LEFT JOIN candidate_operations.dish_handoffs h ON h.task_id=t.id
 WHERE (p.cycle_id=p_cycle OR h.cycle_id=p_cycle) AND t.restaurant_id=p_restaurant AND (manager OR t.assignee_id=p_member);
 RETURN summary||jsonb_build_object('records',records);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_dish_cycle_basic(p_subject text, p_member uuid, p_restaurant text, p_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; cycle candidate_operations.dish_cycles; manager boolean; checkouts jsonb; participants jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO cycle FROM candidate_operations.dish_cycles WHERE id=p_cycle AND restaurant_id=p_restaurant;
 manager:=candidate_operations.dish_manager_read(p_member,p_restaurant);
 IF NOT FOUND OR NOT(manager OR EXISTS(SELECT 1 FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle AND member_id=p_member)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cycle_denied'; END IF;
 SELECT jsonb_agg(member_id ORDER BY slot) INTO participants FROM candidate_operations.dish_participants WHERE cycle_id=p_cycle;
 SELECT jsonb_agg(jsonb_build_object('id',t.id,'ownerId',p.member_id,'revision',t.revision,'phase',t.phase,'shift',CASE WHEN p.slot=0 THEN 'AM' ELSE 'PM' END,'title',t.title,'detail',t.detail,'due',t.due) ORDER BY p.slot)
 INTO checkouts FROM candidate_operations.dish_participants p JOIN candidate_operations.tasks t ON t.id=p.task_id WHERE p.cycle_id=p_cycle AND (manager OR p.member_id=p_member);
 RETURN jsonb_build_object('id',cycle.id,'revision',cycle.revision,'locationId',p_restaurant,'businessDate',cycle.business_date,'participantIds',participants,'checkouts',checkouts,'executionSupported',false);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_dish_cycle_summary(p_subject text, p_member uuid, p_restaurant text, p_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result jsonb; handoffs jsonb; receipts jsonb; manager boolean;
BEGIN
 result:=candidate_operations.read_dish_cycle_basic(p_subject,p_member,p_restaurant,p_cycle);manager:=candidate_operations.dish_manager_read(p_member,p_restaurant);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ownerId',t.assignee_id,'phase',t.phase,'revision',t.revision,'sourceId',h.source_id,'acceptedBy',h.accepted_by,'acceptedAt',h.accepted_at,'detail',t.detail)), '[]') INTO handoffs
 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=p_cycle AND (manager OR t.assignee_id=p_member);
 SELECT coalesce(jsonb_agg(jsonb_build_object('handoffId',h.task_id,'acceptedBy',h.accepted_by,'acceptedAt',h.accepted_at)),'[]') INTO receipts
 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.dish_participants p ON p.task_id=h.source_id WHERE h.cycle_id=p_cycle AND (manager OR p.member_id=p_member);
 RETURN result||jsonb_build_object('executionSupported',true,'handoffs',handoffs,'outgoingReceipts',receipts);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_overnight(p_subject text, p_member uuid, p_restaurant text, p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; issue candidate_operations.overnight_issues; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO issue FROM candidate_operations.overnight_issues WHERE id=p_issue AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT(actor.id IN (issue.owner_id,issue.outgoing_id,issue.incoming_id) OR candidate_operations.task_manager_read(actor.id,p_restaurant,issue.department)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='issue_denied'; END IF;
 SELECT jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,'at',recorded_at) ORDER BY revision) INTO history FROM candidate_operations.overnight_events WHERE issue_id=p_issue;
 RETURN jsonb_build_object('id',issue.id,'kind','handoff','locationId',p_restaurant,'area',issue.department,'ownerId',issue.owner_id,'revision',issue.revision,'data',jsonb_build_object('title',issue.title,'detail',issue.detail,'outgoingId',issue.outgoing_id,'incomingId',issue.incoming_id,'outgoingLeadershipId',issue.outgoing_leadership_id,'incomingLeadershipId',issue.incoming_leadership_id,'due',issue.due,'priority',issue.priority,'phase',issue.phase,'history',history));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_publication_review(p_subject text, p_member uuid, p_restaurant text, p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; s candidate_operations.shift_references; scope_revision integer; needs jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.change')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'position',n.position,'minimum',n.minimum) ORDER BY n.id),'[]') INTO needs FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=s.department AND n.starts_at<s.ends_at AND n.ends_at>s.starts_at AND (n.status='approved' OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=s.position);
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('shiftId',s.id,'revision',s.revision,'workspaceRevision',scope_revision,'staffing',needs,'closingIssues',candidate_operations.closing_publication_issues_read(s.id,p_restaurant),'coverage','candidate-publication-review-only');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_shift(p_subject text, p_member uuid, p_restaurant text, p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; shift candidate_operations.shift_references;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT(actor.id=shift.member_id OR candidate_operations.closing_manager_read(actor.id,p_restaurant,shift.department,'tasks.manage') OR candidate_operations.closing_manager_read(actor.id,p_restaurant,shift.department,'close.confirm')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 RETURN jsonb_build_object('id',shift.id,'kind','shift','locationId',p_restaurant,'area',shift.department,'ownerId',shift.member_id,'revision',shift.revision,'data',jsonb_build_object('personId',shift.member_id,'position',shift.position,'start',shift.starts_at,'end',shift.ends_at,'published',shift.published,'cancelled',shift.cancelled,'releasedAt',shift.released_at));
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.read_task(p_subject text, p_member uuid, p_restaurant text, p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; task candidate_operations.tasks; history jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO task FROM candidate_operations.tasks WHERE id=p_task AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (task.assignee_id=actor.id OR task.outgoing_id IS NOT DISTINCT FROM actor.id OR task.incoming_id IS NOT DISTINCT FROM actor.id OR (candidate_operations.task_reviewer_read(actor.id,p_restaurant,task.department,task.shift_id))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='task_denied';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'action',action,'note',note,
  'at',recorded_at,'revision',revision,'previousOwnerId',previous_assignee_id,'ownerId',assignee_id) ORDER BY revision),'[]'::jsonb) INTO history
 FROM candidate_operations.task_events WHERE task_id=task.id;
 RETURN jsonb_build_object('id',task.id,'locationId',task.restaurant_id,'ownerId',task.assignee_id,
  'area',task.department,'kind','task','revision',task.revision,'data',jsonb_build_object(
   'title',task.title,'detail',task.detail,'kind',task.kind,'phase',task.phase,'due',task.due,'history',history) || CASE WHEN task.incoming_id IS NOT NULL THEN jsonb_build_object('incomingId',task.incoming_id) ELSE '{}'::jsonb END || CASE WHEN task.shift_id IS NOT NULL THEN jsonb_build_object('shiftId',task.shift_id,'shiftRevision',task.shift_revision)||CASE WHEN task.closing_handoff IS NOT NULL THEN jsonb_build_object('closingHandoff',task.closing_handoff) ELSE '{}'::jsonb END ELSE '{}'::jsonb END);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.release_shift(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
DECLARE actor candidate_identity.memberships; shift candidate_operations.shift_references; receipt candidate_operations.command_receipts;
 input jsonb; note text; result jsonb; scope_revision integer; cycle_id uuid; checkout candidate_operations.dish_participants; checkout_date date; restaurant_timezone text;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'shift.release' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR NOT input ? 'note' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k<>'note')
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_shift_release'; END IF;
 note:=btrim(input->>'note');
 IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND OR actor.id=shift.member_id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,shift.department,'close.confirm') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='release_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND capability='location.manage' AND active;
 IF NOT FOUND THEN
  PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=actor.id AND restaurant_id=p_restaurant AND department=shift.department AND active AND starts_at<=shift.ends_at AND ends_at>=shift.ends_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF shift.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF NOT shift.published OR shift.cancelled OR shift.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
 IF shift.checkout_profile NOT IN ('ordinary','dishwasher','overnight-manager') OR (shift.checkout_profile IN ('ordinary','overnight-manager') AND shift.position='Dishwasher') OR (shift.checkout_profile='dishwasher' AND shift.position<>'Dishwasher') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checkout_profile_unsupported'; END IF;
 PERFORM 1 FROM candidate_identity.memberships WHERE id=shift.member_id AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND (position<>'Dishwasher' OR shift.checkout_profile='dishwasher' AND position='Dishwasher') AND department=shift.department FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF shift.checkout_profile='dishwasher' THEN
  SELECT timezone INTO restaurant_timezone FROM candidate_identity.restaurants WHERE id=p_restaurant;
  checkout_date:=(shift.starts_at AT TIME ZONE restaurant_timezone)::date;
  SELECT id INTO cycle_id FROM candidate_operations.dish_cycles WHERE restaurant_id=p_restaurant AND business_date=checkout_date FOR SHARE;
  IF NOT FOUND OR NOT candidate_operations.dish_shape(cycle_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
  SELECT * INTO checkout FROM candidate_operations.dish_participants WHERE dish_participants.cycle_id=cycle_id AND member_id=shift.member_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='dish_shape_conflict'; END IF;
  PERFORM 1 FROM candidate_operations.tasks WHERE id=checkout.task_id AND phase='closed' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  IF checkout.slot=0 THEN
   IF EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND (h.accepted_by IS DISTINCT FROM t.assignee_id OR h.accepted_at IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM candidate_operations.dish_handoffs h JOIN candidate_operations.tasks t ON t.id=h.task_id WHERE h.cycle_id=cycle_id AND t.assignee_id=shift.member_id AND t.phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
  END IF;
 END IF;
 -- Check actual authoritative candidate rows, never a browser summary/count.
 PERFORM 1 FROM candidate_operations.closes WHERE shift_id=shift.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=shift.id AND phase NOT IN ('closed','cancelled')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=shift.id AND phase='closed' AND attention IS NOT NULL AND attention->'acknowledgment'->>'by' IS DISTINCT FROM manager_id::text) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attention_pending'; END IF;
 PERFORM 1 FROM candidate_operations.tasks WHERE shift_id=shift.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=shift.id AND phase<>'closed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_pending'; END IF;
 UPDATE candidate_operations.shift_references SET released_at=clock_timestamp(),revision=revision+1 WHERE id=shift.id RETURNING * INTO shift;
 INSERT INTO candidate_operations.shift_events(shift_id,restaurant_id,revision,actor_id,action,note) VALUES(shift.id,p_restaurant,shift.revision,actor.id,'released',note);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',shift.id,'revision',shift.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',shift.released_at,'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.shift_notification_outbox(shift_id,restaurant_id,revision,recipient_id,message) VALUES(shift.id,p_restaurant,shift.revision,shift.member_id,note||' This does not change recorded work time.');
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.resolve_identity(p_subject text, p_session uuid, p_restaurant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE member candidate_identity.memberships;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 -- Consistent scope-first locking. Held through command/read by the HTTP transaction.
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 PERFORM 1 FROM candidate_identity.sessions WHERE id=p_session AND subject=p_subject
  AND active AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='session_denied'; END IF;
 SELECT m.* INTO member FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE a.subject=p_subject AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 RETURN jsonb_build_object('subject',p_subject,'membershipId',member.id);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.resolve_identity_read(p_subject text, p_session uuid, p_restaurant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE member candidate_identity.memberships;
BEGIN

 -- Read identity uses the request snapshot, without coordination or policy row locks.
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 PERFORM 1 FROM candidate_identity.sessions WHERE id=p_session AND subject=p_subject
  AND active AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='session_denied'; END IF;
 SELECT m.* INTO member FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE a.subject=p_subject AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 RETURN jsonb_build_object('subject',p_subject,'membershipId',member.id);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.save_schedule_draft(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
<<draft_work>>
DECLARE actor candidate_identity.memberships; owner candidate_identity.memberships; rec candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; scope candidate_identity.restaurants; input jsonb; result jsonb;
 creating boolean; first_instant timestamptz; last_instant timestamptz; job text; note text; station candidate_operations.station_references; selected_station uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'shift.save'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_input'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('personId','start','end','position','note','stationId'))
 OR NOT input ?& ARRAY['personId','start','end','position'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_fields'; END IF;
 SELECT * INTO owner FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND (active OR schedule_only) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='schedule.manage')
 OR actor.department<>owner.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR actor.department<>rec.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 creating:=NOT p_payload ? 'recordId';
 IF creating THEN
  IF p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_record'; END IF;
 ELSE
  SELECT * INTO rec FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  IF actor.department<>rec.department AND NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  IF rec.published OR rec.cancelled OR rec.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  IF rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
  IF rec.starts_at<=clock_timestamp() AND (jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='schedule_change_note_required'; END IF;
  -- Only command-created drafts have complete candidate metadata. Imported references remain protected.
  IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='draft_reference_only'; END IF;
  IF EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=rec.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=rec.id)
  OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=rec.id)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='linked_shift_protected'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=p_restaurant AND time_off_complete)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='schedule_inputs_incomplete'; END IF;

 IF jsonb_typeof(input->'position') IS DISTINCT FROM 'string' OR length(btrim(input->>'position')) NOT BETWEEN 1 AND 100
 OR input ? 'note' AND (jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note'))>2000)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_text'; END IF;
 job:=btrim(input->>'position'); note:=btrim(coalesce(input->>'note',''));
 selected_station:=CASE WHEN input ? 'stationId' THEN nullif(input->>'stationId','')::uuid ELSE rec.station_id END;
 IF selected_station IS NOT NULL THEN
  IF NOT candidate_operations.station_assignment_allowed(selected_station,p_restaurant,owner.id,job)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_assignment_denied'; END IF;
  SELECT * INTO station FROM candidate_operations.station_references WHERE id=selected_station AND restaurant_id=p_restaurant FOR SHARE;
 END IF;
 IF jsonb_typeof(input->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'end') IS DISTINCT FROM 'string'
 OR input->>'start' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
 OR input->>'end' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_time'; END IF;
 first_instant:=(input->>'start')::timestamptz; last_instant:=(input->>'end')::timestamptz;
 IF last_instant<=first_instant OR last_instant-first_instant>interval '24 hours'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_draft_duration'; END IF;
 IF NOT creating AND rec.starts_at<=clock_timestamp() AND (first_instant>rec.starts_at OR last_instant<clock_timestamp())
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='active_shift_time_conflict'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=owner.id AND e.active AND e.job=draft_work.job)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='schedule_job_denied'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND NOT cancelled
 AND id<>coalesce(rec.id,'00000000-0000-0000-0000-000000000000'::uuid) AND starts_at<last_instant AND ends_at>first_instant)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 IF candidate_operations.person_time_off_conflict(owner.id,first_instant,last_instant)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='approved_time_off_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_restaurant AND member_id=owner.id AND status='approved'
 AND candidate_operations.availability_period_conflict(data,first_instant,last_instant,scope.timezone))
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='availability_shift_conflict'; END IF;
 IF creating THEN
  INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published)
  VALUES(gen_random_uuid(),p_restaurant,owner.id,owner.department,job,first_instant,last_instant,1,false) RETURNING * INTO rec;
 ELSE
  UPDATE candidate_operations.shift_references SET member_id=owner.id,department=owner.department,position=job,starts_at=first_instant,ends_at=last_instant,revision=revision+1 WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 UPDATE candidate_operations.shift_references SET station_id=station.id,station_name=station.title,station_revision=station.revision WHERE id=rec.id RETURNING * INTO rec;
 INSERT INTO candidate_operations.schedule_draft_events VALUES(rec.id,rec.revision,actor.id,
  jsonb_build_object('personId',owner.id,'start',first_instant,'end',last_instant,'position',job,'note',note,'published',false,'stationId',station.id,'stationName',station.title,'stationRevision',station.revision),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.save_shift(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant AND published) THEN RETURN candidate_operations.change_schedule(p_subject,p_member,p_restaurant,p_request,p_payload); END IF;
 RETURN candidate_operations.save_schedule_draft(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.save_station(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; rec candidate_operations.station_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; setup_json jsonb; rubric jsonb; goal jsonb; goals jsonb:='[]';
 result jsonb; department_name text; station_title text; reason text; key text; n integer; threshold integer; reviewer uuid; creating boolean; rubric_changed boolean;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS DISTINCT FROM 'station.save'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  SELECT * INTO rec FROM candidate_operations.station_references WHERE id=(receipt.result->>'recordId')::uuid AND restaurant_id=p_restaurant;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='people.manage' AND (actor.department=rec.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 input:=p_payload->'input';
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR NOT input ?& ARRAY['title','levels','status','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('area','title','levels','independentLevel','status','note','setup')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_fields'; END IF;
 creating:=NOT p_payload ? 'recordId';
 IF creating THEN
  IF p_payload ? 'expectedRevision' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_record'; END IF;
  department_name:=coalesce(input->>'area',actor.department);
 ELSE
  SELECT * INTO rec FROM candidate_operations.station_references WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='station_denied'; END IF;
  IF jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR p_payload->>'expectedRevision' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_revision'; END IF;
  IF rec.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
  department_name:=rec.department;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='people.manage' AND (actor.department=department_name OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 IF length(btrim(department_name)) NOT BETWEEN 1 AND 50 OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE restaurant_id=p_restaurant AND department=department_name AND (active OR schedule_only)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_department'; END IF;
 IF jsonb_typeof(input->'title') IS DISTINCT FROM 'string' OR length(btrim(input->>'title')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR length(btrim(input->>'note')) NOT BETWEEN 1 AND 2000 OR input->>'status' IS NULL OR input->>'status' NOT IN ('active','archived') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_text'; END IF;
 station_title:=btrim(input->>'title');reason:=btrim(input->>'note');
 IF NOT creating AND station_title<>rec.title THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_name_immutable'; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant AND s.department=department_name AND lower(s.title)=lower(station_title) AND s.id<>coalesce(rec.id,'00000000-0000-0000-0000-000000000000'::uuid)) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_title_conflict'; END IF;
 IF jsonb_typeof(input->'levels') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 n:=jsonb_array_length(input->'levels');IF n<>0 AND n NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'levels') l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object' OR jsonb_typeof(l->'label') IS DISTINCT FROM 'string' OR length(btrim(l->>'label')) NOT BETWEEN 1 AND 80 OR l ? 'definition' AND (jsonb_typeof(l->'definition') IS DISTINCT FROM 'string' OR length(btrim(l->>'definition'))>500)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_levels'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('value',ordinality,'label',btrim(l->>'label'),'definition',btrim(coalesce(l->>'definition',''))) ORDER BY ordinality),'[]') INTO rubric FROM jsonb_array_elements(input->'levels') WITH ORDINALITY e(l,ordinality);
 IF (SELECT count(DISTINCT lower(l->>'label')) FROM jsonb_array_elements(rubric) l)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_levels'; END IF;
 IF input ? 'independentLevel' AND input->'independentLevel'<>'null'::jsonb THEN
  IF jsonb_typeof(input->'independentLevel') IS DISTINCT FROM 'number' OR input->>'independentLevel' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_threshold'; END IF;
  threshold:=(input->>'independentLevel')::integer;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rubric) l WHERE (l->>'value')::integer=threshold AND length(l->>'definition')>0) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_threshold'; END IF;
 END IF;
 IF input ? 'setup' THEN
  setup_json:=input->'setup';
  IF jsonb_typeof(setup_json) IS DISTINCT FROM 'object' OR NOT setup_json ?& ARRAY['jobs','memberIds','standardIds','goals'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(setup_json) k WHERE k NOT IN ('jobs','memberIds','standardIds','goals','allJobMembers','managerId')) OR setup_json ? 'allJobMembers' AND jsonb_typeof(setup_json->'allJobMembers') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_setup'; END IF;
  FOREACH key IN ARRAY ARRAY['jobs','memberIds','standardIds'] LOOP
   IF jsonb_typeof(setup_json->key) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_selection'; END IF;
   n:=jsonb_array_length(setup_json->key);
   IF n>(CASE WHEN key='memberIds' THEN 500 ELSE 40 END) OR EXISTS(SELECT 1 FROM jsonb_array_elements(setup_json->key) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_selection'; END IF;
   IF key='jobs' THEN
    IF (SELECT count(DISTINCT btrim(v)) FROM jsonb_array_elements_text(setup_json->key) v)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_selection'; END IF;
    setup_json:=jsonb_set(setup_json,ARRAY[key],(SELECT coalesce(jsonb_agg(btrim(v) ORDER BY ordinality),'[]') FROM jsonb_array_elements_text(setup_json->key) WITH ORDINALITY e(v,ordinality)));
   ELSE
    IF (SELECT count(DISTINCT btrim(v)::uuid) FROM jsonb_array_elements_text(setup_json->key) v)<>n THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_selection'; END IF;
    setup_json:=jsonb_set(setup_json,ARRAY[key],(SELECT coalesce(jsonb_agg(btrim(v)::uuid ORDER BY ordinality),'[]') FROM jsonb_array_elements_text(setup_json->key) WITH ORDINALITY e(v,ordinality)));
   END IF;
  END LOOP;
  setup_json:=setup_json||jsonb_build_object('allJobMembers',coalesce((setup_json->>'allJobMembers')::boolean,false));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'jobs') j WHERE candidate_operations.dish_only_label(j) OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.schedule_eligibility e ON e.member_id=m.id AND e.active AND e.job=j WHERE m.restaurant_id=p_restaurant AND m.department=department_name AND (m.active OR m.schedule_only))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_job_selection_denied'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'memberIds') v WHERE NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE m.id=v::uuid AND m.restaurant_id=p_restaurant AND m.department=department_name AND (m.active OR m.schedule_only) AND NOT candidate_operations.dish_only_label(m.position) AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND setup_json->'jobs' @> to_jsonb(ARRAY[e.job])))) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_member_selection_denied'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(setup_json->'standardIds') v WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.standard_references s WHERE s.id=v::uuid AND s.restaurant_id=p_restaurant AND s.department=department_name AND s.status<>'retired')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_guide_selection_denied'; END IF;
  IF jsonb_typeof(setup_json->'goals') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goals'; END IF;
  IF jsonb_array_length(setup_json->'goals')>5 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goals'; END IF;
  FOR goal IN SELECT value FROM jsonb_array_elements(setup_json->'goals') LOOP
   IF jsonb_typeof(goal) IS DISTINCT FROM 'object' OR NOT goal ?& ARRAY['id','title','definition','dueDays'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   FOREACH key IN ARRAY ARRAY['id','title','definition'] LOOP
    IF jsonb_typeof(goal->key) IS DISTINCT FROM 'string' OR length(btrim(goal->>key)) NOT BETWEEN 1 AND (CASE key WHEN 'id' THEN 100 WHEN 'title' THEN 200 ELSE 2000 END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   END LOOP;
   IF jsonb_typeof(goal->'dueDays') IS DISTINCT FROM 'number' OR goal->>'dueDays' !~ '^[1-9][0-9]*$' OR (goal->>'dueDays')::integer NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_goal'; END IF;
   IF coalesce(goal->>'standardId','')<>'' AND NOT setup_json->'standardIds' @> to_jsonb(ARRAY[(goal->>'standardId')::uuid::text]) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_goal_guide_denied'; END IF;
   goals:=goals||jsonb_build_array(jsonb_build_object('id',btrim(goal->>'id'),'title',btrim(goal->>'title'),'definition',btrim(goal->>'definition'),'dueDays',(goal->>'dueDays')::integer)||CASE WHEN coalesce(goal->>'standardId','')='' THEN '{}'::jsonb ELSE jsonb_build_object('standardId',(goal->>'standardId')::uuid) END);
  END LOOP;
  IF (SELECT count(DISTINCT g->>'id') FROM jsonb_array_elements(goals) g)<>jsonb_array_length(goals) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_station_goals'; END IF;
  IF setup_json ? 'managerId' AND jsonb_typeof(setup_json->'managerId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_station_reviewer'; END IF;
  reviewer:=nullif(setup_json->>'managerId','')::uuid;
  IF jsonb_array_length(goals)>0 AND (reviewer IS NULL OR NOT EXISTS(SELECT 1 FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='people.manage' WHERE m.id=reviewer AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND NOT candidate_operations.dish_only_label(m.position) AND (m.department=department_name OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage'))) OR NOT (setup_json->>'allJobMembers')::boolean AND setup_json->'memberIds' @> to_jsonb(ARRAY[reviewer::text])) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='station_goal_reviewer_denied'; END IF;
  setup_json:=setup_json||jsonb_build_object('managerId',coalesce(reviewer::text,''),'goals',goals);
 ELSE
  IF NOT creating AND rec.configured AND rec.setup_data IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='station_setup_reference_only'; END IF;
  setup_json:=rec.setup_data;
 END IF;
 IF p_payload ? 'clientCapturedAt' THEN PERFORM (p_payload->>'clientCapturedAt')::timestamptz; END IF;
 rubric_changed:=NOT creating AND (rec.levels<>rubric OR rec.independent_level IS DISTINCT FROM threshold OR rec.status<>input->>'status');
 IF creating THEN
  INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members,levels,independent_level,definition_revision,setup_data,owner_id)
  VALUES(gen_random_uuid(),p_restaurant,department_name,station_title,1,input->>'status',setup_json IS NOT NULL,coalesce((setup_json->>'allJobMembers')::boolean,false),rubric,threshold,1,setup_json,actor.id) RETURNING * INTO rec;
 ELSE
  UPDATE candidate_operations.station_references SET revision=revision+1,status=input->>'status',configured=setup_json IS NOT NULL,all_job_members=coalesce((setup_json->>'allJobMembers')::boolean,false),levels=rubric,independent_level=threshold,definition_revision=CASE WHEN rubric_changed THEN revision+1 ELSE definition_revision END,setup_data=setup_json WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 IF input ? 'setup' THEN
  DELETE FROM candidate_operations.station_jobs WHERE station_id=rec.id;DELETE FROM candidate_operations.station_members WHERE station_id=rec.id;
  INSERT INTO candidate_operations.station_jobs SELECT rec.id,j FROM jsonb_array_elements_text(setup_json->'jobs') j;
  INSERT INTO candidate_operations.station_members SELECT rec.id,v::uuid,p_restaurant FROM jsonb_array_elements_text(setup_json->'memberIds') v;
 END IF;
 INSERT INTO candidate_operations.station_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),reason,clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.schedule_consent_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships;rec candidate_operations.schedule_offers;s candidate_operations.shift_references;scope candidate_identity.restaurants;receipt candidate_operations.command_receipts;input jsonb;action text;creating boolean;target uuid;reason text;result jsonb;child_result jsonb;event_note text;recipients uuid[];
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 action:=p_payload->>'action';input:=p_payload->'input';creating:=action IN ('coverage.create','request.create');
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR action IS NULL OR action NOT IN ('coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve','request.create','request.consent','request.review') OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) OR jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_consent_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
  IF reason='offer_shift_ended' OR s.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
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
   reason:=candidate_operations.offer_issue(rec);
   IF reason='offer_shift_ended' OR rec.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_ended'; END IF;
   IF reason<>'' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='offer_changed'; END IF;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.schedule_plan_allowed(p_member uuid, p_department text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT candidate_operations.goal_authorized(p_member,p_department,'schedule.manage') OR candidate_operations.goal_authorized(p_member,p_department,'schedule.publish') OR candidate_operations.goal_authorized(p_member,p_department,'schedule.change');
$function$

CREATE OR REPLACE FUNCTION candidate_operations.schedule_request_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_payload->'input'->>'type'='swap' OR p_payload->>'action'='request.consent' OR p_payload ? 'recordId' AND EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant AND mode='swap') THEN RETURN candidate_operations.schedule_consent_command(p_subject,p_member,p_restaurant,p_request,p_payload); END IF;
 RETURN candidate_operations.time_off_command(p_subject,p_member,p_restaurant,p_request,p_payload);
END;
$function$

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
 RETURN jsonb_build_object('location',jsonb_build_object('id',scope.id,'name',scope.name,'timezone',scope.timezone,'revision',scope.revision),'me',me,'workspaceRevision',scope.revision);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.seed_scope_coordination()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 INSERT INTO candidate_operations.scope_coordination VALUES(NEW.id);
 RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.staffing_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; rec candidate_operations.staffing_needs; scope candidate_identity.restaurants; receipt candidate_operations.command_receipts;
 input jsonb; action text; department_name text; cap text; result jsonb; note text; creating boolean;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 action:=p_payload->>'action';input:=p_payload->'input';
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(action,'') NOT IN ('staffing.save','staffing.approve','staffing.retire') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
$function$

CREATE OR REPLACE FUNCTION candidate_operations.station_assignment_allowed(p_station uuid, p_restaurant text, p_member uuid, p_job text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.station_references s JOIN candidate_identity.memberships m ON m.id=p_member AND m.restaurant_id=s.restaurant_id AND m.department=s.department
 WHERE s.id=p_station AND s.restaurant_id=p_restaurant AND s.status='active' AND s.configured AND (m.active OR m.schedule_only)
 AND NOT candidate_operations.dish_only_label(m.position) AND NOT candidate_operations.dish_only_label(p_job)
 AND EXISTS(SELECT 1 FROM candidate_operations.station_jobs j WHERE j.station_id=s.id AND j.job=p_job)
 AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND e.job=p_job)
 AND (s.all_job_members OR EXISTS(SELECT 1 FROM candidate_operations.station_members sm WHERE sm.station_id=s.id AND sm.member_id=m.id)));
$function$

CREATE OR REPLACE FUNCTION candidate_operations.support_close(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; helper candidate_identity.memberships; assigned candidate_operations.closes;
 receipt candidate_operations.command_receipts; input jsonb; action text; note text; result jsonb; scope_revision integer; previous_helper uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';action:=p_payload->>'action';
 IF action IS NULL OR action NOT IN ('close.acknowledge','close.correction.assign') OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR NOT input ? 'note' OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('note','personId'))
 OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number' OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 OR (action='close.correction.assign') IS DISTINCT FROM (input ? 'personId')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_support'; END IF;
 note:=btrim(input->>'note');
 IF length(note) NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_note'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND OR actor.id<>assigned.manager_id OR NOT candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'close.confirm') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='manager_denied'; END IF;
 IF action='close.correction.assign' AND NOT candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'tasks.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND capability='location.manage' AND active;
 IF NOT FOUND THEN
  PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=actor.id AND restaurant_id=p_restaurant AND department=assigned.department AND active AND starts_at<=assigned.due AND ends_at>=assigned.due FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='leadership_denied'; END IF;
 END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF assigned.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 IF assigned.phase IN ('closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
 previous_helper:=assigned.helper_id;
 IF action='close.acknowledge' THEN
  IF assigned.attention IS NULL OR assigned.attention->'acknowledgment'->>'by'=assigned.manager_id::text THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attention_not_pending'; END IF;
  UPDATE candidate_operations.closes SET attention=attention||jsonb_build_object('acknowledgment',jsonb_build_object('by',actor.id,'at',clock_timestamp(),'note',note)),revision=revision+1 WHERE id=assigned.id RETURNING * INTO assigned;
 ELSE
  IF assigned.phase<>'correction' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  PERFORM 1 FROM candidate_operations.shift_references WHERE id=assigned.shift_id AND restaurant_id=p_restaurant AND published AND NOT cancelled AND released_at IS NULL AND revision=assigned.shift_revision FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
  PERFORM 1 FROM candidate_operations.standard_references WHERE id=assigned.standard_id AND restaurant_id=p_restaurant AND status='approved' AND revision=assigned.standard_revision FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='standard_denied'; END IF;
  IF jsonb_typeof(input->'personId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_helper'; END IF;
  SELECT * INTO helper FROM candidate_identity.memberships WHERE id=(input->>'personId')::uuid AND restaurant_id=p_restaurant AND active AND NOT schedule_only AND position<>'Dishwasher' AND department=assigned.department FOR SHARE;
  IF NOT FOUND OR helper.id=assigned.manager_id OR helper.id IS NOT DISTINCT FROM assigned.verifier_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='helper_denied'; END IF;
  PERFORM 1 FROM candidate_identity.station_clearances WHERE member_id=helper.id AND restaurant_id=p_restaurant AND position=assigned.standard_snapshot->>'position' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='clearance_denied'; END IF;
  UPDATE candidate_operations.closes SET helper_id=helper.id,correction=jsonb_build_object('personId',helper.id,'assignedBy',actor.id,'assignedAt',clock_timestamp(),'note',note),answers='[]',revision=revision+1 WHERE id=assigned.id RETURNING * INTO assigned;
 END IF;
 INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note,details)
 VALUES(assigned.id,p_restaurant,assigned.revision,actor.id,CASE action WHEN 'close.acknowledge' THEN 'manager-acknowledged' ELSE 'correction-assigned' END,note,
 jsonb_build_object('previousHelperId',previous_helper)||CASE action WHEN 'close.acknowledge' THEN jsonb_build_object('attention',assigned.attention) ELSE jsonb_build_object('correction',assigned.correction) END);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',assigned.id,'revision',assigned.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result) VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message)
 SELECT assigned.id,p_restaurant,assigned.revision,id,(assigned.standard_snapshot->>'title')||': '||action
 FROM (SELECT DISTINCT unnest(CASE action WHEN 'close.acknowledge' THEN ARRAY[assigned.owner_id,(assigned.attention->>'raisedBy')::uuid,assigned.helper_id]
 ELSE ARRAY[assigned.owner_id,assigned.helper_id,assigned.manager_id,previous_helper] END) id) targets WHERE id IS NOT NULL;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.sync_person_shift_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE person uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM candidate_operations.person_shift_bookings WHERE shift_id=OLD.id;RETURN OLD;
 END IF;
 IF NEW.cancelled THEN
  DELETE FROM candidate_operations.person_shift_bookings WHERE shift_id=NEW.id;RETURN NEW;
 END IF;
 SELECT person_id INTO person FROM candidate_identity.memberships WHERE id=NEW.member_id AND restaurant_id=NEW.restaurant_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 INSERT INTO candidate_operations.person_shift_bookings VALUES(NEW.id,NEW.member_id,person,tstzrange(NEW.starts_at,NEW.ends_at,'[)'))
 ON CONFLICT(shift_id) DO UPDATE SET member_id=excluded.member_id,person_id=excluded.person_id,period=excluded.period;
 RETURN NEW;
EXCEPTION WHEN exclusion_violation THEN
 -- A concurrent write can be invisible to the earlier person check. Translate
 -- this final database guard to the same sanitized HTTP conflict, without IDs.
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap';
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.task_manager(p_member uuid, p_restaurant text, p_department text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; task_access boolean; location_access boolean;
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant
  AND active AND NOT schedule_only FOR SHARE;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 -- Lock grants through commit: a concurrent downgrade must wait for this authorized transaction.
 -- Grant administrators must use restaurant-first coordination before changing policy rows.
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability FOR SHARE;
 SELECT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='tasks.manage'),
  EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
 INTO task_access,location_access;
 RETURN task_access AND (actor.department=p_department OR location_access);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.task_manager_read(p_member uuid, p_restaurant text, p_department text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; task_access boolean; location_access boolean;
BEGIN
 SELECT * INTO actor FROM candidate_identity.memberships WHERE id=p_member AND restaurant_id=p_restaurant
  AND active AND NOT schedule_only;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RETURN false; END IF;
 -- Read authorization uses the statement snapshot; writes retain the original lock-aware helper.
 -- Grant administrators must use restaurant-first coordination before changing policy rows.
 PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id ORDER BY capability;
 SELECT EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='tasks.manage'),
  EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active AND capability='location.manage')
 INTO task_access,location_access;
 RETURN task_access AND (actor.department=p_department OR location_access);
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.task_reviewer(p_member uuid, p_restaurant text, p_department text, p_shift uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_shift IS NULL THEN RETURN candidate_operations.task_manager(p_member,p_restaurant,p_department); END IF;
 RETURN candidate_operations.closing_manager(p_member,p_restaurant,p_department,'tasks.manage');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.task_reviewer_read(p_member uuid, p_restaurant text, p_department text, p_shift uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
 IF p_shift IS NULL THEN RETURN candidate_operations.task_manager_read(p_member,p_restaurant,p_department); END IF;
 RETURN candidate_operations.closing_manager_read(p_member,p_restaurant,p_department,'tasks.manage');
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.time_off_command(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; rec candidate_operations.time_off_references; scope candidate_identity.restaurants;
 receipt candidate_operations.command_receipts; input jsonb; result jsonb; affected uuid[]; s candidate_operations.shift_references; approve boolean; flagged jsonb:='[]';
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('request.create','request.review')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_command'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
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
   PERFORM candidate_operations.lock_scope(m.restaurant_id,true) FROM candidate_identity.memberships m
    WHERE m.person_id=(SELECT person_id FROM candidate_identity.memberships WHERE id=rec.member_id) ORDER BY m.restaurant_id;
   IF jsonb_typeof(input->'affectedShifts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'affectedShifts') v WHERE jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['id','revision'])
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time_off_impact'; END IF;
   SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO affected FROM candidate_operations.shift_references WHERE restaurant_id=p_restaurant AND member_id=rec.member_id AND NOT cancelled AND starts_at<rec.ends_at AND ends_at>rec.starts_at;
   IF cardinality(affected)<>jsonb_array_length(input->'affectedShifts') OR EXISTS(SELECT 1 FROM candidate_operations.shift_references shift_row WHERE shift_row.id=ANY(affected)
    AND (SELECT count(*) FROM jsonb_array_elements(input->'affectedShifts') v WHERE v->>'id'=shift_row.id::text AND v->'revision'=to_jsonb(shift_row.revision))<>1)
   THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_impact_conflict'; END IF;
   FOR s IN SELECT * FROM candidate_operations.shift_references WHERE id=ANY(affected) ORDER BY id FOR UPDATE LOOP
    IF s.ends_at<=clock_timestamp() THEN
     INSERT INTO candidate_operations.time_off_shift_flags(request_id,shift_id,restaurant_id,shift_revision,before_snapshot,reason)
      VALUES(rec.id,s.id,s.restaurant_id,s.revision,to_jsonb(s),'ended_shift');
     flagged:=flagged||jsonb_build_array(jsonb_build_object('id',s.id,'revision',s.revision,'reason','ended_shift','reviewStatus','pending'));
     CONTINUE;
    END IF;
    IF s.published OR s.released_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id) OR EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id)
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='time_off_cancellation_not_migrated'; END IF;
    UPDATE candidate_operations.shift_references SET cancelled=true,revision=revision+1 WHERE id=s.id RETURNING * INTO s;
    INSERT INTO candidate_operations.schedule_draft_events VALUES(s.id,s.revision,actor.id,jsonb_build_object('personId',s.member_id,'start',s.starts_at,'end',s.ends_at,'position',s.position,'published',false,'cancelled',true,'action','time-off-approved','requestId',rec.id,'note',btrim(input->>'note'),'stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision),clock_timestamp());
   END LOOP;
  END IF;
  IF approve THEN
   FOR s IN SELECT shift_row.* FROM candidate_operations.shift_references shift_row JOIN candidate_identity.memberships peer ON peer.id=shift_row.member_id
    WHERE peer.person_id=(SELECT person_id FROM candidate_identity.memberships WHERE id=rec.member_id)
     AND shift_row.restaurant_id<>p_restaurant AND NOT shift_row.cancelled AND shift_row.starts_at<rec.ends_at AND shift_row.ends_at>rec.starts_at ORDER BY shift_row.id LOOP
    INSERT INTO candidate_operations.time_off_shift_flags(request_id,shift_id,restaurant_id,shift_revision,before_snapshot,reason)
     VALUES(rec.id,s.id,s.restaurant_id,s.revision,to_jsonb(s),'cross_store_review');
   END LOOP;
  END IF;
  UPDATE candidate_operations.time_off_references SET status=CASE WHEN approve THEN 'approved' ELSE 'declined' END,decision=btrim(input->>'note'),revision=revision+1,updated_at=clock_timestamp() WHERE id=rec.id RETURNING * INTO rec;
 END IF;
 INSERT INTO candidate_operations.time_off_conflict_outbox
 SELECT flag.request_id,flag.shift_id,m.id,'Approved leave overlaps scheduled work; manager review required',NULL
 FROM candidate_operations.time_off_shift_flags flag JOIN candidate_identity.memberships m ON m.restaurant_id=flag.restaurant_id
 WHERE flag.request_id=rec.id AND m.active AND NOT m.schedule_only
 AND EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities cap WHERE cap.membership_id=m.id AND cap.active AND cap.capability IN ('schedule.manage','schedule.publish'))
 AND candidate_operations.goal_authorized(m.id,flag.before_snapshot->>'department','schedule.manage')
 ON CONFLICT DO NOTHING;
 INSERT INTO candidate_operations.time_off_events VALUES(rec.id,rec.revision,actor.id,to_jsonb(rec),clock_timestamp());
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope.revision;
 result:=jsonb_build_object('recordId',rec.id,'revision',rec.revision,'workspaceRevision',scope.revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 result:=result||jsonb_build_object('flaggedShifts',flagged);
 INSERT INTO candidate_operations.command_receipts VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 IF p_payload->>'action'='request.review' THEN INSERT INTO candidate_operations.time_off_outbox VALUES(rec.id,rec.revision,rec.member_id,'Time off '||rec.status,NULL);
 ELSE
  INSERT INTO candidate_operations.time_off_outbox SELECT rec.id,rec.revision,m.id,'Time-off request review',NULL FROM candidate_identity.memberships m JOIN candidate_identity.membership_capabilities c ON c.membership_id=m.id AND c.active AND c.capability='schedule.manage'
  WHERE m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.id<>actor.id AND (m.department=actor.department OR EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=m.id AND active AND capability='location.manage'));
 END IF;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.transition_close(p_subject text, p_member uuid, p_restaurant text, p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; assigned candidate_operations.closes; shift candidate_operations.shift_references;
 receipt candidate_operations.command_receipts; input jsonb; step text; note text; next_phase text; result jsonb; scope_revision integer;
 is_manager boolean:=false; is_verifier boolean:=false; required_count integer; performer uuid; previous_helper uuid;
BEGIN
 PERFORM candidate_operations.lock_scope(p_restaurant);
 IF p_request IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_command'; END IF;
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND m.position<>'Dishwasher' AND a.subject=p_subject FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 input:=p_payload->'input';
 IF p_payload->>'action' IS DISTINCT FROM 'close.transition' OR jsonb_typeof(input) IS DISTINCT FROM 'object'
 OR NOT p_payload ?& ARRAY['recordId','expectedRevision','input']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('action','recordId','expectedRevision','input','clientCapturedAt'))
 OR NOT input ?& ARRAY['step','note'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(input) k WHERE k NOT IN ('step','note','answers','managerAttention'))
 OR jsonb_typeof(input->'step') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'note') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'recordId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'number'
 OR (p_payload->>'expectedRevision') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_transition'; END IF;
 step:=input->>'step';note:=btrim(input->>'note');
 IF input ? 'managerAttention' AND (step<>'fix' OR jsonb_typeof(input->'managerAttention') IS DISTINCT FROM 'string' OR input->>'managerAttention' NOT IN ('repeated','serious','unresolved')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_attention_reason'; END IF;
 IF step NOT IN ('ready','verify','confirm','fix') OR length(note) NOT BETWEEN 1 AND 8000
 OR step<>'ready' AND input ? 'answers' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_closing_transition'; END IF;
 IF p_payload ? 'clientCapturedAt' THEN
  IF jsonb_typeof(p_payload->'clientCapturedAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_time'; END IF;
  PERFORM (p_payload->>'clientCapturedAt')::timestamptz;
 END IF;
 SELECT * INTO assigned FROM candidate_operations.closes WHERE id=(p_payload->>'recordId')::uuid AND restaurant_id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='closing_denied'; END IF;
 performer:=coalesce(assigned.helper_id,assigned.owner_id);previous_helper:=assigned.helper_id;
 IF step='ready' AND assigned.helper_id IS NOT NULL THEN
  IF actor.department<>assigned.department THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='helper_denied'; END IF;
  PERFORM 1 FROM candidate_identity.station_clearances WHERE member_id=actor.id AND restaurant_id=p_restaurant AND position=assigned.standard_snapshot->>'position' AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='clearance_denied'; END IF;
 END IF;
 -- Recheck actor authorization even when returning an already committed receipt.
 IF actor.id=assigned.manager_id AND candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'close.confirm') THEN
  PERFORM 1 FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND capability='location.manage' AND active;
  IF FOUND THEN is_manager:=true; ELSE
   PERFORM 1 FROM candidate_operations.leadership_references WHERE member_id=actor.id AND restaurant_id=p_restaurant AND department=assigned.department
    AND active AND starts_at<=assigned.due AND ends_at>=assigned.due FOR SHARE;
   is_manager:=FOUND;
  END IF;
 END IF;
 IF actor.id IS NOT DISTINCT FROM assigned.verifier_id THEN
  is_verifier:=candidate_operations.closing_manager(actor.id,p_restaurant,assigned.department,'close.verify');
 END IF;
 IF step='ready' AND actor.id<>performer OR step='verify' AND NOT is_verifier
 OR step='confirm' AND NOT is_manager OR step='fix' AND NOT (is_verifier OR is_manager)
 OR step IN ('verify','confirm','fix') AND actor.id=performer THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='checker_denied'; END IF;
 SELECT * INTO receipt FROM candidate_operations.command_receipts WHERE restaurant_id=p_restaurant AND actor_id=p_member AND request_id=p_request;
 IF FOUND THEN
  IF receipt.payload<>p_payload THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request_payload_conflict'; END IF;
  RETURN receipt.result||jsonb_build_object('replayed',true);
 END IF;
 IF assigned.revision<>(p_payload->>'expectedRevision')::integer THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='revision_conflict'; END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=assigned.shift_id AND restaurant_id=p_restaurant FOR SHARE;
 IF NOT FOUND OR NOT shift.published OR shift.cancelled OR shift.released_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 IF shift.revision<>assigned.shift_revision THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_conflict'; END IF;
 PERFORM 1 FROM candidate_operations.standard_references WHERE id=assigned.standard_id AND restaurant_id=p_restaurant AND status='approved' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='standard_denied'; END IF;
 IF step='ready' THEN
  IF assigned.phase NOT IN ('open','correction') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;
  required_count:=jsonb_array_length(assigned.standard_snapshot->'criteria');
  IF jsonb_typeof(input->'answers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='required_conditions_missing'; END IF;
  IF jsonb_array_length(input->'answers')<>required_count OR EXISTS(
   SELECT 1 FROM generate_series(0,required_count-1) n WHERE NOT (input->'answers' @> jsonb_build_array(n))
  ) OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'answers') a WHERE jsonb_typeof(a)<>'number' OR a::text !~ '^(0|[1-9][0-9]*)$')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='required_conditions_missing'; END IF;
  next_phase:=CASE WHEN assigned.verifier_id IS NULL THEN 'manager-confirmation' ELSE 'verification' END;
 ELSIF step='verify' THEN
  IF assigned.phase<>'verification' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='manager-confirmation';
 ELSIF step='confirm' THEN
  IF assigned.attention IS NOT NULL AND assigned.attention->'acknowledgment'->>'by' IS DISTINCT FROM assigned.manager_id::text THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='attention_pending'; END IF;
  IF assigned.phase<>'manager-confirmation' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='closed';
 ELSE
  IF assigned.phase IN ('closed','cancelled') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='phase_conflict'; END IF;next_phase:='correction';
 END IF;
 UPDATE candidate_operations.closes SET phase=next_phase,revision=revision+1,
  answers=CASE WHEN step='ready' THEN input->'answers' WHEN step='fix' THEN '[]'::jsonb ELSE answers END
  ,helper_id=CASE WHEN step='fix' THEN NULL ELSE helper_id END,
  correction=CASE WHEN step='fix' THEN NULL ELSE correction END,
  attention=CASE WHEN step='fix' AND input ? 'managerAttention' THEN jsonb_build_object('reason',input->>'managerAttention','raisedBy',actor.id,'raisedAt',clock_timestamp(),'note',note) ELSE attention END
 WHERE id=assigned.id RETURNING * INTO assigned;
 INSERT INTO candidate_operations.close_events(close_id,restaurant_id,revision,actor_id,action,note,answers,details)
 VALUES(assigned.id,p_restaurant,assigned.revision,actor.id,step,note,CASE WHEN step='ready' THEN assigned.answers ELSE NULL END,
  jsonb_build_object('previousHelperId',previous_helper)||CASE WHEN step='fix' AND input ? 'managerAttention' THEN jsonb_build_object('attention',assigned.attention) ELSE '{}'::jsonb END);
 UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=p_restaurant RETURNING revision INTO scope_revision;
 result:=jsonb_build_object('recordId',assigned.id,'revision',assigned.revision,'workspaceRevision',scope_revision,'requestId',p_request,'appliedAt',clock_timestamp(),'replayed',false);
 INSERT INTO candidate_operations.command_receipts(restaurant_id,actor_id,request_id,payload,fingerprint,result)
 VALUES(p_restaurant,actor.id,p_request,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),result);
 INSERT INTO candidate_operations.close_notification_outbox(close_id,restaurant_id,revision,recipient_id,message)
 SELECT assigned.id,p_restaurant,assigned.revision,id,(assigned.standard_snapshot->>'title')||': '||next_phase
 FROM (SELECT DISTINCT unnest(CASE next_phase WHEN 'verification' THEN ARRAY[assigned.verifier_id]
  WHEN 'manager-confirmation' THEN ARRAY[assigned.manager_id] WHEN 'correction' THEN ARRAY[assigned.owner_id,assigned.manager_id,previous_helper] ELSE ARRAY[assigned.owner_id] END||ARRAY[previous_helper]) id) targets WHERE id IS NOT NULL;
 RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION candidate_operations.weekly_review(p_subject text, p_member uuid, p_restaurant text, p_week text, p_selected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; week_start timestamptz; week_end timestamptz; tz text; scope_revision integer; ids uuid[]; snapshot jsonb; needs jsonb; stamp text;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR actor.position='Dishwasher' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_week IS NULL OR p_week !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(p_week::date,'YYYY-MM-DD')<>p_week OR jsonb_typeof(p_selected) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO ids FROM jsonb_array_elements_text(p_selected);
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_shift_selection'; END IF;
 SELECT timezone,revision INTO tz,scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 week_start:=p_week::date::timestamp AT TIME ZONE tz;week_end:=(p_week::date+7)::timestamp AT TIME ZONE tz;
 IF EXISTS(SELECT 1 FROM unnest(ids) AS sel(shift_id) WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=sel.shift_id AND s.restaurant_id=p_restaurant AND NOT s.published AND NOT s.cancelled AND s.released_at IS NULL AND s.ends_at>statement_timestamp() AND s.starts_at>=week_start AND s.starts_at<week_end AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
 -- The conservative snapshot also detects privileged fixture changes that did not advance a scope revision.
 SELECT jsonb_build_object('week',p_week,'selected',to_jsonb(ids),'workspaceRevision',scope_revision,
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM candidate_identity.memberships m WHERE m.restaurant_id=p_restaurant),
 'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.member_id,e.job,e.source),'[]') FROM candidate_identity.schedule_eligibility e JOIN candidate_identity.memberships m ON m.id=e.member_id WHERE m.restaurant_id=p_restaurant),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.membership_id,c.capability),'[]') FROM candidate_identity.membership_capabilities c JOIN candidate_identity.memberships m ON m.id=c.membership_id WHERE m.restaurant_id=p_restaurant),
 'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant),
 'needs',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant),
 'stations',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.station_references s WHERE s.restaurant_id=p_restaurant),
 'stationJobs',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.station_id,j.job),'[]') FROM candidate_operations.station_jobs j JOIN candidate_operations.station_references s ON s.id=j.station_id WHERE s.restaurant_id=p_restaurant),
 'stationMembers',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.station_id,m.member_id),'[]') FROM candidate_operations.station_members m WHERE m.restaurant_id=p_restaurant),
 'availability',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant),
 'timeOff',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM candidate_operations.time_off_references t JOIN candidate_identity.memberships peer ON peer.id=t.member_id WHERE EXISTS(SELECT 1 FROM candidate_identity.memberships local_member WHERE local_member.restaurant_id=p_restaurant AND local_member.person_id=peer.person_id)),
 'closes',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM candidate_operations.closes c WHERE c.restaurant_id=p_restaurant),
 'standards',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM candidate_operations.standard_references s WHERE s.restaurant_id=p_restaurant),
 'leadership',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM candidate_operations.leadership_references l WHERE l.restaurant_id=p_restaurant)) INTO snapshot;
 stamp:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 WITH planned AS (
 SELECT s.* FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id WHERE s.restaurant_id=p_restaurant AND NOT s.cancelled AND (s.published OR s.id=ANY(ids)) AND s.starts_at<week_end AND s.ends_at>week_start
 AND m.department=s.department AND (m.active OR m.schedule_only) AND candidate_operations.schedule_plan_allowed(actor.id,s.department)
 AND EXISTS(SELECT 1 FROM candidate_identity.schedule_eligibility e WHERE e.member_id=m.id AND e.active AND e.job=s.position)
 AND (s.station_id IS NULL OR candidate_operations.station_assignment_allowed(s.station_id,p_restaurant,m.id,s.position))
 AND NOT candidate_operations.person_time_off_conflict(m.id,s.starts_at,s.ends_at)
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.availability_references a WHERE a.restaurant_id=p_restaurant AND a.member_id=m.id AND a.status='approved' AND candidate_operations.availability_period_conflict(a.data,s.starts_at,s.ends_at,tz))
 AND NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references other WHERE other.restaurant_id=p_restaurant AND other.member_id=m.id AND other.id<>s.id AND NOT other.cancelled AND (other.published OR other.id=ANY(ids)) AND other.starts_at<s.ends_at AND other.ends_at>s.starts_at)
 ), staffing AS (SELECT n.*,greatest(n.starts_at,week_start) first_at,least(n.ends_at,week_end) last_at FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.status='approved' AND n.starts_at<week_end AND n.ends_at>week_start AND candidate_operations.schedule_plan_allowed(actor.id,n.department)),
 boundaries AS (SELECT n.id,n.first_at point FROM staffing n UNION SELECT n.id,n.last_at FROM staffing n UNION SELECT n.id,greatest(s.starts_at,n.first_at) FROM staffing n JOIN planned s ON s.department=n.department AND s.position=n.position AND s.starts_at<n.last_at AND s.ends_at>n.first_at UNION SELECT n.id,least(s.ends_at,n.last_at) FROM staffing n JOIN planned s ON s.department=n.department AND s.position=n.position AND s.starts_at<n.last_at AND s.ends_at>n.first_at),
 segments AS (SELECT id,point first_at,lead(point) OVER(PARTITION BY id ORDER BY point) last_at FROM boundaries),
 counts AS (SELECT b.*,n.minimum,(SELECT count(DISTINCT s.member_id)::integer FROM planned s WHERE s.department=n.department AND s.position=n.position AND s.starts_at<=b.first_at AND s.ends_at>=b.last_at) scheduled FROM segments b JOIN staffing n ON n.id=b.id WHERE b.last_at>b.first_at),
 gaps AS (SELECT *,CASE WHEN lag(last_at) OVER(PARTITION BY id ORDER BY first_at)=first_at AND lag(scheduled) OVER(PARTITION BY id ORDER BY first_at)=scheduled THEN 0 ELSE 1 END boundary FROM counts WHERE scheduled<minimum),
 grouped AS (SELECT *,sum(boundary) OVER(PARTITION BY id ORDER BY first_at) grp FROM gaps),
 merged AS (SELECT id,min(first_at) first_at,max(last_at) last_at,minimum,scheduled FROM grouped GROUP BY id,grp,minimum,scheduled)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'required',n.minimum,'gaps',coalesce((SELECT jsonb_agg(jsonb_build_object('start',g.first_at,'end',g.last_at,'required',g.minimum,'scheduled',g.scheduled) ORDER BY g.first_at) FROM merged g WHERE g.id=n.id),'[]')) ORDER BY n.id),'[]') INTO needs FROM staffing n;
 RETURN jsonb_build_object('weekStart',p_week,'period',jsonb_build_object('start',week_start,'end',week_end),'planningReview',stamp,'staffing',needs,'plannedGapCount',(SELECT coalesce(sum(jsonb_array_length(n->'gaps')),0) FROM jsonb_array_elements(needs) n),'workspaceRevision',scope_revision,'coverage','candidate-planned-staffing-gaps');
END;
$function$
