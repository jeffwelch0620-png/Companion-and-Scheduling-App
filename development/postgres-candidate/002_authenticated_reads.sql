-- Candidate extension only. Applies after 001_candidate.sql.
BEGIN;
CREATE TABLE candidate_identity.sessions(
 id uuid PRIMARY KEY, subject text NOT NULL REFERENCES candidate_identity.auth_links(subject),
 active boolean NOT NULL DEFAULT true, expires_at timestamptz NOT NULL
);
REVOKE ALL ON candidate_identity.sessions FROM PUBLIC;

CREATE FUNCTION candidate_operations.resolve_identity(p_subject text,p_session uuid,p_restaurant text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE member candidate_identity.memberships;
BEGIN
 -- Consistent scope-first locking. Held through command/read by the HTTP transaction.
 PERFORM 1 FROM candidate_identity.restaurants WHERE id=p_restaurant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scope_denied'; END IF;
 PERFORM 1 FROM candidate_identity.sessions WHERE id=p_session AND subject=p_subject
  AND active AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='session_denied'; END IF;
 SELECT m.* INTO member FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE a.subject=p_subject AND m.restaurant_id=p_restaurant AND m.active FOR SHARE OF m,a;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 RETURN jsonb_build_object('subject',p_subject,'membershipId',member.id);
END;
$body$;
CREATE FUNCTION candidate_operations.list_tasks(
 p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE actor candidate_identity.memberships; selected uuid[]; items jsonb; next_cursor uuid;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_page_size';
 END IF;
 SELECT m.* INTO actor FROM candidate_identity.memberships m
 JOIN candidate_identity.auth_links a ON a.person_id=m.person_id
 WHERE m.id=p_member AND m.restaurant_id=p_restaurant AND m.active AND a.subject=p_subject;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='actor_denied'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (
  SELECT id FROM candidate_operations.tasks WHERE restaurant_id=p_restaurant
   AND (assignee_id=actor.id OR (actor.can_manage_tasks AND department=actor.department))
   AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit+1
 ) page;
 SELECT coalesce(jsonb_agg(candidate_operations.read_task(p_subject,p_member,p_restaurant,id)
  ORDER BY ordinal),'[]'::jsonb) INTO items
 FROM unnest(selected) WITH ORDINALITY AS entry(id,ordinal) WHERE ordinal<=p_limit;
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor);
END;
$body$;
REVOKE ALL ON FUNCTION candidate_operations.resolve_identity(text,uuid,text),
 candidate_operations.list_tasks(text,uuid,text,uuid,integer) FROM PUBLIC;
COMMIT;
