BEGIN;
ALTER FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid) RENAME TO read_dish_cycle_summary;
REVOKE ALL ON FUNCTION candidate_operations.read_dish_cycle_summary(text,uuid,text,uuid) FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.read_dish_cycle(p_subject text,p_member uuid,p_restaurant text,p_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE summary jsonb; records jsonb; manager boolean;
BEGIN
 summary:=candidate_operations.read_dish_cycle_summary(p_subject,p_member,p_restaurant,p_cycle);manager:=candidate_operations.dish_manager(p_member,p_restaurant);
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
$body$;
CREATE FUNCTION candidate_operations.read_shift(p_subject text,p_member uuid,p_restaurant text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; shift candidate_operations.shift_references;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO shift FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT(actor.id=shift.member_id OR candidate_operations.closing_manager(actor.id,p_restaurant,shift.department,'tasks.manage') OR candidate_operations.closing_manager(actor.id,p_restaurant,shift.department,'close.confirm')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='shift_denied'; END IF;
 RETURN jsonb_build_object('id',shift.id,'kind','shift','locationId',p_restaurant,'area',shift.department,'ownerId',shift.member_id,'revision',shift.revision,'data',jsonb_build_object('personId',shift.member_id,'position',shift.position,'start',shift.starts_at,'end',shift.ends_at,'published',shift.published,'cancelled',shift.cancelled,'releasedAt',shift.released_at));
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid),candidate_operations.read_shift(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.read_dish_cycle(text,uuid,text,uuid),candidate_operations.read_shift(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
