-- Corrective candidate privacy projection; published 050 and 051 remain unchanged.
BEGIN;
-- Candidate-only published editing projection; existing write policies remain authoritative.
CREATE OR REPLACE FUNCTION candidate_operations.published_shift_actions(p_member uuid,p_restaurant text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE s candidate_operations.shift_references%ROWTYPE; allowed boolean; structural boolean; station boolean; pending_tasks boolean; closing_count integer; areas jsonb; reason text;
BEGIN
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Authority is evaluated before linked-work queries. Non-editors receive no work-state metadata.
 IF NOT candidate_operations.published_change_allowed(p_member,p_restaurant,s.department,s.starts_at,s.ends_at) THEN RETURN jsonb_build_object('canEdit',false,'canChangeStructure',false,'canChangeStation',false,'canCancel',false,'unfinishedClosingCount',0,'hasLinkedTasks',false,'hasCompletedClosing',false,'editAreas','[]'::jsonb,'blockedReason','authority'); END IF;
 allowed:=s.published AND NOT s.cancelled AND s.released_at IS NULL AND s.ends_at>statement_timestamp()
  AND EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id);
 SELECT count(*)::integer INTO closing_count FROM candidate_operations.closes WHERE shift_id=s.id AND phase NOT IN ('closed','cancelled');
 pending_tasks:=EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id AND phase<>'closed');
 structural:=allowed AND NOT EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id)
  AND NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id AND phase='closed');
 station:=structural AND NOT EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id AND phase<>'cancelled')
  AND NOT EXISTS(SELECT 1 FROM candidate_operations.shift_standard_links WHERE shift_id=s.id);
 -- These are candidate departments, not permission to save a new period. The command checks both periods again.
 SELECT coalesce(jsonb_agg(configured.department ORDER BY configured.department),'[]'::jsonb) INTO areas
 FROM unnest((SELECT operating_departments FROM candidate_identity.restaurants WHERE id=p_restaurant)) configured(department)
 WHERE allowed AND candidate_operations.goal_authorized(p_member,configured.department,'schedule.change') AND (
  EXISTS(SELECT 1 FROM candidate_identity.membership_capabilities WHERE membership_id=p_member AND capability='location.manage' AND active)
  OR EXISTS(SELECT 1 FROM candidate_operations.leadership_references l WHERE l.restaurant_id=p_restaurant AND l.member_id=p_member AND l.department=configured.department AND l.active AND l.ends_at>statement_timestamp()));
 reason:=CASE WHEN NOT s.published THEN 'draft' WHEN s.cancelled OR s.released_at IS NOT NULL THEN 'inactive'
  WHEN s.ends_at<=statement_timestamp() THEN 'ended'
  WHEN NOT EXISTS(SELECT 1 FROM candidate_operations.schedule_draft_events WHERE shift_id=s.id) THEN 'reference'
  WHEN NOT allowed THEN 'authority' ELSE '' END;
 RETURN jsonb_build_object('canEdit',allowed,'canChangeStructure',structural,'canChangeStation',station,
  'canCancel',allowed AND NOT pending_tasks AND closing_count=0,'unfinishedClosingCount',closing_count,
  'hasLinkedTasks',EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE shift_id=s.id),
  'hasCompletedClosing',EXISTS(SELECT 1 FROM candidate_operations.closes WHERE shift_id=s.id AND phase='closed'),
  'editAreas',areas,'blockedReason',reason);
END;
$function$;
REVOKE ALL ON FUNCTION candidate_operations.published_shift_actions(uuid,text,uuid) FROM PUBLIC,candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.list_schedule_shifts(p_subject text, p_member uuid, p_restaurant text, p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE actor candidate_identity.memberships; caps text[]; selected uuid[]; items jsonb; next_cursor uuid; scope candidate_identity.restaurants; can_change boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size'; END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO scope FROM candidate_identity.restaurants WHERE id=p_restaurant;
 SELECT coalesce(array_agg(capability),'{}') INTO caps FROM candidate_identity.membership_capabilities WHERE membership_id=actor.id AND active;
 can_change:='schedule.change'=ANY(caps);
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant AND (p_after IS NULL OR s.id>p_after) AND (s.published OR s.ends_at>statement_timestamp())
  AND (
   (caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)))
   OR s.published AND (s.member_id=actor.id
    OR NOT candidate_operations.is_dish_position(actor.restaurant_id,actor.position) AND ('location.manage'=ANY(caps) OR 'people.manage'=ANY(caps) AND actor.department=s.department)
    OR 'close.confirm'=ANY(caps) AND (actor.department=s.department OR 'location.manage'=ANY(caps)
      OR NOT candidate_operations.is_dish_position(actor.restaurant_id,actor.position) AND 'tasks.manage'=ANY(caps) AND 'operations.store'=ANY(caps) AND candidate_operations.operating_department(s.restaurant_id,s.department)))
  ) ORDER BY s.id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','shift','locationId',s.restaurant_id,'area',s.department,'ownerId',s.member_id,'revision',s.revision,
  'data',jsonb_build_object('personId',s.member_id,'position',s.position,'start',s.starts_at,'end',s.ends_at,'published',s.published,'cancelled',s.cancelled,'releasedAt',s.released_at,'publishedActions',CASE WHEN can_change THEN candidate_operations.published_shift_actions(actor.id,p_restaurant,s.id) ELSE jsonb_build_object('canEdit',false,'canChangeStructure',false,'canChangeStation',false,'canCancel',false,'unfinishedClosingCount',0,'hasLinkedTasks',false,'hasCompletedClosing',false,'editAreas','[]'::jsonb,'blockedReason','authority') END)||CASE WHEN s.station_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stationId',s.station_id,'stationName',s.station_name,'stationRevision',s.station_revision) END||CASE WHEN caps && ARRAY['schedule.manage','schedule.publish','schedule.change'] AND (actor.department=s.department OR 'location.manage'=ANY(caps)) AND EXISTS(SELECT 1 FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending') THEN jsonb_build_object('reviewFlags',(SELECT jsonb_agg(jsonb_build_object('reason',f.reason,'reviewStatus',f.review_status) ORDER BY f.request_id) FROM candidate_operations.time_off_shift_flags f WHERE f.shift_id=s.id AND f.restaurant_id=p_restaurant AND f.review_status='pending')) ELSE '{}'::jsonb END) ORDER BY s.id),'[]')
 INTO items FROM candidate_operations.shift_references s WHERE s.id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'workspaceRevision',scope.revision,'timezone',scope.timezone,'coverage','shift-references-only');
END;
$function$;

COMMIT;
