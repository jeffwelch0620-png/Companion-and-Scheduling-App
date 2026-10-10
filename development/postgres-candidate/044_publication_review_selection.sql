-- Read-only support for exact weekly publication review; no new write grants.
BEGIN;
CREATE OR REPLACE FUNCTION candidate_operations.read_publication_review(p_subject text,p_member uuid,p_restaurant text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; s candidate_operations.shift_references; scope_revision integer; needs jsonb; closing jsonb;
BEGIN
 SELECT m.* INTO actor FROM candidate_identity.memberships m JOIN candidate_identity.auth_links a ON a.person_id=m.person_id WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND NOT m.schedule_only AND a.subject=p_subject;
 IF NOT FOUND OR candidate_operations.is_dish_position(actor.restaurant_id,actor.position) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT * INTO s FROM candidate_operations.shift_references WHERE id=p_shift AND restaurant_id=p_restaurant;
 IF NOT FOUND OR NOT (candidate_operations.goal_authorized(actor.id,s.department,'schedule.manage') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.publish') OR candidate_operations.goal_authorized(actor.id,s.department,'schedule.change')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='action_denied'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'revision',n.revision,'status',n.status,'position',n.position,'minimum',n.minimum) ORDER BY n.id),'[]') INTO needs FROM candidate_operations.staffing_needs n WHERE n.restaurant_id=p_restaurant AND n.department=s.department AND n.starts_at<s.ends_at AND n.ends_at>s.starts_at AND (n.status='approved' OR n.status='draft' AND n.copied_from IS NOT NULL AND n.position=s.position);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'due',c.due,'ownerId',c.owner_id,'managerId',c.manager_id,'verifierId',c.verifier_id,'standard',c.standard_snapshot) ORDER BY c.id),'[]') INTO closing FROM candidate_operations.closes c WHERE c.restaurant_id=p_restaurant AND c.shift_id=s.id AND c.phase<>'cancelled';
 SELECT revision INTO scope_revision FROM candidate_identity.restaurants WHERE id=p_restaurant;
 RETURN jsonb_build_object('shiftId',s.id,'revision',s.revision,'workspaceRevision',scope_revision,'staffing',needs,'closing',closing,'closingIssues',candidate_operations.closing_publication_issues_read(s.id,p_restaurant),'sourceReviewComplete',EXISTS(SELECT 1 FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=p_restaurant AND workspace_revision=scope_revision),'coverage','candidate-publication-review-only');
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.read_publication_review(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.read_publication_review(text,uuid,text,uuid) TO candidate_runtime;
COMMIT;
