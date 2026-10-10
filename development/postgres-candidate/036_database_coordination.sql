-- Corrective candidate coordination. Published 001–035 are preserved.
BEGIN;
CREATE TABLE candidate_operations.scope_coordination(
 restaurant_id text PRIMARY KEY REFERENCES candidate_identity.restaurants(id) ON DELETE CASCADE
);
INSERT INTO candidate_operations.scope_coordination SELECT id FROM candidate_identity.restaurants;
REVOKE ALL ON candidate_operations.scope_coordination FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.lock_scope(p_restaurant text,p_nowait boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
$$;
REVOKE ALL ON FUNCTION candidate_operations.lock_scope(text,boolean) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.seed_scope_coordination() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO candidate_operations.scope_coordination VALUES(NEW.id);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.seed_scope_coordination() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER seed_scope_coordination AFTER INSERT ON candidate_identity.restaurants
FOR EACH ROW EXECUTE FUNCTION candidate_operations.seed_scope_coordination();

-- Determine only affected scopes, never lock every location or every grant.
CREATE FUNCTION candidate_operations.coordination_scope_keys(p_table text,p_old jsonb,p_new jsonb)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
$$;
REVOKE ALL ON FUNCTION candidate_operations.coordination_scope_keys(text,jsonb,jsonb) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.coordinate_policy_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
$$;
REVOKE ALL ON FUNCTION candidate_operations.coordinate_policy_write() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER aa_coordinate_policy BEFORE UPDATE OR DELETE ON candidate_identity.restaurants FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_identity.memberships FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_identity.membership_capabilities FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_identity.schedule_eligibility FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_identity.auth_links FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_identity.sessions FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_operations.standard_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();
CREATE TRIGGER aa_coordinate_policy BEFORE INSERT OR UPDATE OR DELETE ON candidate_operations.closes FOR EACH ROW EXECUTE FUNCTION candidate_operations.coordinate_policy_write();

-- Replace scope SELECT ... FOR UPDATE with private coordination, retaining policy/record locks.
-- Explicit names and assertions make drift fail instead of silently changing arbitrary functions.
DO $patch$
DECLARE f record;body text;definition text;count integer:=0;
BEGIN
 FOR f IN SELECT p.oid,p.proname,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='candidate_operations' AND p.proname IN
  ('assign_close','assign_dish_cycle','availability_command','change_schedule','command_before_dish','dish_command','goal_command','leadership_command','manager_handoff_command','overnight_command','publish_shift_core','publish_week','release_shift','resolve_identity','save_schedule_draft','save_station','schedule_consent_command','staffing_command','support_close','time_off_command','transition_close')
  AND p.prosrc ~ 'candidate_identity.restaurants[^;]*FOR UPDATE'
 LOOP
  body:=regexp_replace(f.prosrc,'(candidate_identity.restaurants[^;]*) FOR UPDATE','\1','g');
  body:=regexp_replace(body,'\mBEGIN\M',E'BEGIN\n PERFORM candidate_operations.lock_scope(p_restaurant);');
  IF f.proname='overnight_command' THEN
   body:=replace(body,'PERFORM 1 FROM candidate_identity.membership_capabilities ORDER BY membership_id,capability FOR SHARE;',
    'PERFORM 1 FROM candidate_identity.membership_capabilities c JOIN candidate_identity.memberships m ON m.id=c.membership_id WHERE m.restaurant_id=p_restaurant ORDER BY c.membership_id,c.capability FOR SHARE OF c;');
  END IF;
  definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);EXECUTE definition;count:=count+1;
 END LOOP;
 IF count<>21 THEN RAISE EXCEPTION 'Expected 21 coordinated function bodies, found %',count; END IF;
 SELECT p.oid,p.prosrc INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations' AND p.proname='invalidate_schedule_offers';
 IF f.prosrc NOT LIKE '%restaurants WHERE id=p_restaurant FOR UPDATE;%' THEN RAISE EXCEPTION 'Offer invalidation source changed'; END IF;
 body:=replace(f.prosrc,'restaurants WHERE id=p_restaurant FOR UPDATE;','restaurants WHERE id=p_restaurant;');
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
END;
$patch$;

-- Non-locking read helper variants preserve the existing write helper contracts.
DO $reads$
DECLARE f record;body text;definition text;helper text;signature text;read_count integer:=0;
 helpers text[]:=ARRAY['closing_manager','dish_manager','task_manager','closing_publication_issues','task_reviewer'];
 roots text[]:=ARRAY['list_goals','list_schedule_context','list_schedule_leadership','list_schedule_offers','list_schedule_shifts','list_schedule_stations','list_staffing','list_tasks','list_time_off','read_close','read_dish_cycle','read_dish_cycle_basic','read_dish_cycle_summary','read_overnight','read_publication_review','read_shift','read_task','schedule_viewer','weekly_review'];
BEGIN
 FOR f IN SELECT p.oid,p.proname,p.prosrc,p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='candidate_operations' AND (p.proname=ANY(helpers) OR p.proname=ANY(roots)) ORDER BY p.proname
 LOOP
  IF f.prosrc ~* '(INSERT INTO|UPDATE candidate_|DELETE FROM)' THEN RAISE EXCEPTION 'Read function mutates: %',f.proname; END IF;
  body:=regexp_replace(f.prosrc,' FOR (SHARE|UPDATE)( OF [a-z,]+)?','','g');
  body:=replace(body,'-- Lock grants through commit: a concurrent downgrade must wait for this authorized transaction.','-- Read authorization uses the statement snapshot; writes retain the original lock-aware helper.');
  FOREACH helper IN ARRAY helpers LOOP body:=replace(body,'candidate_operations.'||helper||'(','candidate_operations.'||helper||'_read('); END LOOP;
  definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
  signature:=f.signature;
  IF f.proname=ANY(helpers) THEN
   definition:=replace(definition,'FUNCTION candidate_operations.'||f.proname||'(','FUNCTION candidate_operations.'||f.proname||'_read(');
   signature:=replace(signature,'candidate_operations.'||f.proname||'(','candidate_operations.'||f.proname||'_read(');
  END IF;
  EXECUTE definition;EXECUTE 'ALTER FUNCTION '||signature||' STABLE';read_count:=read_count+1;
  IF f.proname=ANY(helpers) THEN EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,candidate_runtime'; END IF;
 END LOOP;
 IF read_count<>24 THEN RAISE EXCEPTION 'Expected 24 read/helper function bodies, found %',read_count; END IF;
 -- The HTTP read resolver shares the request snapshot and acquires no coordination/policy row locks.
 SELECT p.oid,p.prosrc INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations' AND p.proname='resolve_identity';
 body:=replace(f.prosrc,E' PERFORM candidate_operations.lock_scope(p_restaurant);','');
 body:=replace(body,'-- Consistent scope-first locking. Held through command/read by the HTTP transaction.','-- Read identity uses the request snapshot, without coordination or policy row locks.');
 body:=regexp_replace(body,' FOR (SHARE|UPDATE)( OF [a-z,]+)?','','g');
 definition:=replace(replace(pg_get_functiondef(f.oid),f.prosrc,body),'FUNCTION candidate_operations.resolve_identity(','FUNCTION candidate_operations.resolve_identity_read(');
 EXECUTE definition;
END;
$reads$;
ALTER FUNCTION candidate_operations.resolve_identity_read(text,uuid,text) STABLE;
REVOKE ALL ON FUNCTION candidate_operations.resolve_identity_read(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION candidate_operations.resolve_identity_read(text,uuid,text) TO candidate_runtime;
COMMIT;
