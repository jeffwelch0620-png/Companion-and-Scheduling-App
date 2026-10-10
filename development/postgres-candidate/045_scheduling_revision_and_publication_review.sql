-- Scheduling freshness and bounded publication review. Published 001-044 remain immutable.
BEGIN;
ALTER TABLE candidate_operations.scope_coordination ADD COLUMN schedule_revision bigint NOT NULL DEFAULT 0 CHECK(schedule_revision>=0);
-- Old evidence is deliberately stale until a privileged source reviewer attests the new revision.
ALTER TABLE candidate_operations.weekly_scope_reviews ADD COLUMN schedule_revision bigint NOT NULL DEFAULT -1 CHECK(schedule_revision>=-1);
CREATE OR REPLACE FUNCTION candidate_operations.seed_scope_coordination() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 INSERT INTO candidate_operations.scope_coordination(restaurant_id) VALUES(NEW.id);
 RETURN NEW;
END;
$body$;

-- Project actual planning inputs. Closing progress and global revision increments are excluded.
CREATE FUNCTION candidate_operations.schedule_input_projection(p_table text,p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $body$
DECLARE fields text[];
BEGIN
 IF p_row IS NULL THEN RETURN NULL; END IF;
 CASE p_table
 WHEN 'restaurants' THEN fields:=ARRAY['id','timezone','operating_departments','dish_department','dish_position','dish_aliases'];
 WHEN 'memberships' THEN fields:=ARRAY['id','restaurant_id','department','position','active','schedule_only','person_id'];
 WHEN 'schedule_eligibility' THEN fields:=ARRAY['member_id','job','source','active'];
 WHEN 'closes' THEN
  fields:=ARRAY['id','restaurant_id','shift_id','shift_revision','owner_id','department','standard_id','standard_revision','standard_snapshot','zone','manager_id','verifier_id','due'];
  RETURN (SELECT jsonb_object_agg(k,p_row->k) FROM unnest(fields) k)||jsonb_build_object('cancelled',p_row->>'phase'='cancelled');
 WHEN 'schedule_input_reviews' THEN fields:=ARRAY['restaurant_id','time_off_complete'];
 ELSE RETURN p_row-ARRAY['updated_at'];
 END CASE;
 RETURN (SELECT jsonb_object_agg(k,p_row->k) FROM unnest(fields) k);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.schedule_input_projection(text,jsonb) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.advance_schedule_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE before_row jsonb;after_row jsonb;keys text[];people uuid[];scope text;
BEGIN
 before_row:=CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
 after_row:=CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
 IF TG_OP='UPDATE' AND candidate_operations.schedule_input_projection(TG_TABLE_NAME,before_row)
  IS NOT DISTINCT FROM candidate_operations.schedule_input_projection(TG_TABLE_NAME,after_row) THEN RETURN NULL; END IF;
 keys:=ARRAY[before_row->>'restaurant_id',after_row->>'restaurant_id'];
 IF TG_TABLE_NAME='restaurants' THEN keys:=ARRAY[before_row->>'id',after_row->>'id'];
 ELSIF TG_TABLE_NAME='memberships' THEN people:=ARRAY[(before_row->>'person_id')::uuid,(after_row->>'person_id')::uuid];
 ELSIF TG_TABLE_NAME IN ('time_off_references','shift_references') THEN
  SELECT array_agg(DISTINCT person_id) INTO people FROM candidate_identity.memberships
  WHERE id IN ((before_row->>'member_id')::uuid,(after_row->>'member_id')::uuid);
 ELSIF TG_TABLE_NAME IN ('schedule_eligibility','membership_capabilities') THEN
  SELECT array_agg(DISTINCT restaurant_id) INTO keys FROM candidate_identity.memberships
  WHERE id IN ((coalesce(before_row->>'member_id',before_row->>'membership_id'))::uuid,(coalesce(after_row->>'member_id',after_row->>'membership_id'))::uuid);
 ELSIF TG_TABLE_NAME='station_jobs' THEN
  SELECT array_agg(DISTINCT restaurant_id) INTO keys FROM candidate_operations.station_references
  WHERE id IN ((before_row->>'station_id')::uuid,(after_row->>'station_id')::uuid);
 END IF;
 -- Person-wide leave and booking changes invalidate every affected location's evidence.
 keys:=keys||ARRAY(SELECT DISTINCT restaurant_id FROM candidate_identity.memberships WHERE person_id=ANY(people));
 FOR scope IN SELECT DISTINCT k FROM unnest(keys) k WHERE k IS NOT NULL ORDER BY k LOOP
  -- Preserve the existing whole-transaction 40001 retry contract; never invert row/store waits.
  PERFORM candidate_operations.lock_scope(scope,true);
  UPDATE candidate_operations.scope_coordination SET schedule_revision=schedule_revision+1 WHERE restaurant_id=scope;
 END LOOP;
 IF TG_WHEN='BEFORE' THEN RETURN OLD; END IF;
 RETURN NULL;
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.advance_schedule_revision() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE ON candidate_identity.restaurants FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE ON candidate_identity.memberships FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_identity.schedule_eligibility FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_identity.membership_capabilities FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_identity.station_clearances FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.time_off_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.availability_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.staffing_needs FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.closes FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.standard_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.shift_standard_links FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.station_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.station_jobs FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.station_members FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.leadership_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.schedule_input_reviews FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE TRIGGER zz_schedule_revision_delete BEFORE DELETE ON candidate_identity.memberships FOR EACH ROW EXECUTE FUNCTION candidate_operations.advance_schedule_revision();
CREATE OR REPLACE FUNCTION candidate_operations.read_publication_review(p_subject text, p_member uuid, p_restaurant text, p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; s candidate_operations.shift_references; scope_revision integer; scheduling_revision bigint; needs jsonb; closing jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(actor.restaurant_id,actor.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.change')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'position',n.position,'minimum',n.minimum) ORDER BY n.id),'[]') INTO needs FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=s.department AND n.starts_at<s.ends_at AND n.ends_at>s.starts_at AND (n.status='approved' OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=s.position);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'due',c.due,'ownerId',c.owner_id,'managerId',c.manager_id,'verifierId',c.verifier_id,'standardId',c.standard_id,'standardRevision',c.standard_revision,'standard',jsonb_build_object('title',c.standard_snapshot->>'title','version',c.standard_snapshot->'version','position',c.standard_snapshot->>'position')) ORDER BY c.id),'[]') INTO closing FROM candidate_operations.closes c WHERE c.restaurant_id=p_restaurant AND c.shift_id=s.id AND c.phase<>'cancelled';
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT schedule_revision INTO scheduling_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant;
 RETURN jsonb_build_object('shiftId',s.id,'revision',s.revision,'workspaceRevision',scope_revision,'scheduleRevision',scheduling_revision,'staffing',needs,'closing',closing,'closingIssues',candidate_operations.closing_publication_issues_read(s.id,p_restaurant),'sourceReviewComplete',EXISTS(SELECT 1 FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=p_restaurant AND schedule_revision=scheduling_revision),'coverage','candidate-publication-review-only');
END;
$function$;
CREATE OR REPLACE FUNCTION candidate_operations.weekly_review(p_subject text, p_member uuid, p_restaurant text, p_week text, p_selected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; week_start timestamptz; week_end timestamptz; tz text; scope_revision integer; scheduling_revision bigint; drafts jsonb; ids uuid[]; snapshot jsonb; needs jsonb; stamp text;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(actor.restaurant_id,actor.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_week IS NULL OR p_week !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(p_week::date,'YYYY-MM-DD')<>p_week OR jsonb_typeof(p_selected) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selected) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_week_selection'; END IF;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO ids FROM jsonb_array_elements_text(p_selected);
 IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='duplicate_shift_selection'; END IF;
 SELECT timezone,revision INTO tz,scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT schedule_revision INTO scheduling_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant;
 week_start:=p_week::date::timestamp AT TIME ZONE tz;week_end:=(p_week::date+7)::timestamp AT TIME ZONE tz;
 IF EXISTS(SELECT 1 FROM unnest(ids) AS sel(shift_id) WHERE NOT EXISTS(SELECT 1 FROM candidate_operations.shift_references s WHERE s.id=sel.shift_id AND s.restaurant_id=p_restaurant AND NOT s.published AND NOT s.cancelled AND s.released_at IS NULL AND s.ends_at>statement_timestamp() AND s.starts_at>=week_start AND s.starts_at<week_end AND candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish'))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='week_selection_denied'; END IF;
 -- The private counter tracks relevant inputs, including person-wide effects and no-op rules.
 snapshot:=jsonb_build_object('restaurant',p_restaurant,'week',p_week,'selected',to_jsonb(ids),'scheduleRevision',scheduling_revision);
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'required',n.minimum,'record',jsonb_build_object('id',n.id,'kind','staffing','locationId',n.restaurant_id,'area',n.department,'ownerId',n.owner_id,'revision',n.revision,'data',jsonb_build_object('title',n.title,'position',n.position,'start',n.starts_at,'end',n.ends_at,'minimum',n.minimum,'source',n.source,'status',n.status)),'gaps',coalesce((SELECT jsonb_agg(jsonb_build_object('start',g.first_at,'end',g.last_at,'required',g.minimum,'scheduled',g.scheduled) ORDER BY g.first_at) FROM merged g WHERE g.id=n.id),'[]')) ORDER BY n.id),'[]') INTO needs FROM staffing n;
 -- All selected details share this stable SQL snapshot; there are no per-draft HTTP reads.
 SELECT jsonb_agg(candidate_operations.read_publication_review(p_subject,p_member,p_restaurant,id) ORDER BY id) INTO drafts FROM unnest(ids) id;
 RETURN jsonb_build_object('weekStart',p_week,'period',jsonb_build_object('start',week_start,'end',week_end),'planningReview',stamp,'staffing',needs,'plannedGapCount',(SELECT coalesce(sum(jsonb_array_length(n->'gaps')),0) FROM jsonb_array_elements(needs) n),'workspaceRevision',scope_revision,'scheduleRevision',scheduling_revision,'drafts',drafts,'coverage','candidate-planned-staffing-gaps');
END;
$function$;
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
 IF NOT FOUND OR candidate_operations.is_dish_position(actor.restaurant_id,actor.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
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
 IF NOT EXISTS(SELECT 1 FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=p_restaurant AND schedule_revision=(review->>'scheduleRevision')::bigint) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='weekly_scope_review_required'; END IF;
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
 RETURN jsonb_build_object('location',jsonb_build_object('id',scope.id,'name',scope.name,'timezone',scope.timezone,'revision',scope.revision,'configuration',jsonb_build_object('operatingDepartments',scope.operating_departments,'dishDepartment',scope.dish_department,'dishPosition',scope.dish_position,'dishAliases',scope.dish_aliases)),'me',me,'workspaceRevision',scope.revision,'scheduleRevision',(SELECT schedule_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
END;
$function$;
COMMIT;
