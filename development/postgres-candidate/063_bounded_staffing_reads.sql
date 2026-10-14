-- Corrective candidate reads only; published 001-062 remain unchanged.
BEGIN;
ALTER TABLE candidate_operations.staffing_needs ADD COLUMN start_local_date date;
UPDATE candidate_operations.staffing_needs n SET start_local_date=(n.starts_at AT TIME ZONE r.timezone)::date
FROM candidate_identity.restaurants r WHERE r.id=n.restaurant_id;
ALTER TABLE candidate_operations.staffing_needs ALTER COLUMN start_local_date SET NOT NULL;
CREATE INDEX staffing_local_date_lookup ON candidate_operations.staffing_needs(restaurant_id,start_local_date,id);
CREATE INDEX staffing_copy_request_lookup ON candidate_operations.schedule_copy_origins(restaurant_id,actor_id,request_id,target_id) WHERE kind='staffing';

CREATE FUNCTION candidate_operations.set_staffing_local_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE zone text;
BEGIN
 SELECT timezone INTO zone FROM candidate_identity.restaurants WHERE id=NEW.restaurant_id;
 IF zone IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_department'; END IF;
 NEW.start_local_date:=(NEW.starts_at AT TIME ZONE zone)::date;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ab_staffing_local_date BEFORE INSERT OR UPDATE ON candidate_operations.staffing_needs
FOR EACH ROW EXECUTE FUNCTION candidate_operations.set_staffing_local_date();

CREATE FUNCTION candidate_operations.guard_staffing_timezone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.timezone IS DISTINCT FROM NEW.timezone AND EXISTS(SELECT 1 FROM candidate_operations.staffing_needs WHERE restaurant_id=OLD.id)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='store_timezone_in_use'; END IF;
 RETURN NEW;
END;
$$;
-- Existing aa coordination runs first; changing dated staffing's timezone requires explicit reconciliation.
CREATE TRIGGER ab_staffing_timezone BEFORE UPDATE OF timezone ON candidate_identity.restaurants
FOR EACH ROW EXECUTE FUNCTION candidate_operations.guard_staffing_timezone();

CREATE FUNCTION candidate_operations.list_staffing(p_subject text,p_member uuid,p_restaurant text,p_after uuid,p_limit integer,
 p_from date,p_to date,p_status text,p_copy_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor candidate_identity.memberships;selected uuid[];items jsonb;scope_revision integer;input_version bigint;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 IF (p_from IS NULL)<>(p_to IS NULL) OR p_from>p_to OR p_status IS NOT NULL AND p_status NOT IN ('draft','approved','retired')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_staffing_query'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(p_restaurant,actor.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 IF p_copy_request IS NOT NULL THEN
  SELECT array_agg(id ORDER BY id) INTO selected FROM (
   SELECT n.id FROM candidate_operations.schedule_copy_origins o JOIN candidate_operations.staffing_needs n ON n.id=o.target_id AND n.restaurant_id=o.restaurant_id
   WHERE o.restaurant_id=p_restaurant AND o.actor_id=actor.id AND o.request_id=p_copy_request AND o.kind='staffing'
    AND (p_after IS NULL OR n.id>p_after) AND n.start_local_date>=coalesce(p_from,'-infinity'::date) AND n.start_local_date<=coalesce(p_to,'infinity'::date)
    AND (p_status IS NULL OR n.status=p_status)
    AND (candidate_operations.goal_authorized(actor.id,n.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.change'))
   ORDER BY n.id LIMIT p_limit+1) page;
 ELSE
  SELECT array_agg(id ORDER BY id) INTO selected FROM (
   SELECT n.id FROM candidate_operations.staffing_needs n
   WHERE n.restaurant_id=p_restaurant AND (p_after IS NULL OR n.id>p_after)
    AND n.start_local_date>=coalesce(p_from,'-infinity'::date) AND n.start_local_date<=coalesce(p_to,'infinity'::date)
    AND (p_status IS NULL OR n.status=p_status)
    AND (candidate_operations.goal_authorized(actor.id,n.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,n.department,'schedule.change'))
   ORDER BY n.id LIMIT p_limit+1) page;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind','staffing','locationId',n.restaurant_id,'area',n.department,'ownerId',n.owner_id,'revision',n.revision,
  'data',jsonb_build_object('title',n.title,'position',n.position,'start',n.starts_at,'end',n.ends_at,'minimum',n.minimum,'source',n.source,'status',n.status,
   'history',(SELECT jsonb_agg(jsonb_build_object('actorId',e.actor_id,'action',CASE e.action WHEN 'staffing.save' THEN 'drafted' WHEN 'staffing.approve' THEN 'approved' ELSE 'retired' END,'note',e.note,'at',e.recorded_at) ORDER BY e.revision) FROM candidate_operations.staffing_events e WHERE e.staffing_id=n.id))
   ||CASE WHEN n.copied_from IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('copiedFrom',n.copied_from) END) ORDER BY n.id),'[]')
 INTO items FROM candidate_operations.staffing_needs n WHERE n.id=ANY(selected[1:p_limit]);
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT input_revision INTO input_version FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN cardinality(selected)>p_limit THEN selected[p_limit] ELSE NULL END,
  'workspaceRevision',scope_revision,'inputRevision',input_version,
  'query',jsonb_build_object('from',p_from,'to',p_to,'status',p_status,'copyRequest',p_copy_request));
END;
$$;

-- Preserve the existing five-argument API for accepted callers; bounded clients use the new overload explicitly.
CREATE OR REPLACE FUNCTION candidate_operations.list_staffing(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT candidate_operations.list_staffing(p_subject,p_member,p_restaurant,p_after,p_limit,NULL::date,NULL::date,NULL::text,NULL::uuid);
$$;
REVOKE ALL ON FUNCTION candidate_operations.set_staffing_local_date(),candidate_operations.guard_staffing_timezone(),
 candidate_operations.list_staffing(text,uuid,text,uuid,integer,date,date,text,uuid) FROM PUBLIC,candidate_runtime;
REVOKE ALL ON FUNCTION candidate_operations.list_staffing(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_staffing(text,uuid,text,uuid,integer),
 candidate_operations.list_staffing(text,uuid,text,uuid,integer,date,date,text,uuid) TO candidate_runtime;
COMMIT;
