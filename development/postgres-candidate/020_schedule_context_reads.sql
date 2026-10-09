-- Isolated reference fixtures only; no employee provisioning or availability writes.
BEGIN;
CREATE TABLE candidate_identity.schedule_eligibility(
 member_id uuid NOT NULL REFERENCES candidate_identity.memberships(id),
 job text NOT NULL CHECK(length(btrim(job)) BETWEEN 1 AND 100),
 source text NOT NULL CHECK(source IN ('qualification','schedule-job')),
 active boolean NOT NULL DEFAULT true,PRIMARY KEY(member_id,job,source)
);
CREATE TABLE candidate_operations.availability_references(
 id uuid PRIMARY KEY,restaurant_id text NOT NULL,member_id uuid NOT NULL,department text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),updated_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved','declined','superseded')),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND (data->>'status') IS NOT DISTINCT FROM status),
 FOREIGN KEY(member_id,restaurant_id) REFERENCES candidate_identity.memberships(id,restaurant_id)
);
REVOKE ALL ON candidate_identity.schedule_eligibility,candidate_operations.availability_references FROM PUBLIC,candidate_runtime;
CREATE FUNCTION candidate_operations.list_schedule_context(
 p_subject text,p_member uuid,p_restaurant text,p_kind text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
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
$body$;
REVOKE ALL ON FUNCTION candidate_operations.list_schedule_context(text,uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.list_schedule_context(text,uuid,text,text,uuid,integer) TO candidate_runtime;
COMMIT;
