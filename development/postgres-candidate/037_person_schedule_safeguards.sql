-- Isolated candidate only. Preserve published migrations 001–036.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- Keep person identity out of the source row's JSON/permit hashes. This private
-- projection follows membership identity changes through its composite FK.
ALTER TABLE candidate_identity.memberships ADD CONSTRAINT memberships_id_person_key UNIQUE(id,person_id);
CREATE TABLE candidate_operations.person_shift_bookings(
 shift_id uuid PRIMARY KEY REFERENCES candidate_operations.shift_references(id) ON DELETE CASCADE,
 member_id uuid NOT NULL,person_id uuid NOT NULL,period tstzrange NOT NULL,
 FOREIGN KEY(member_id,person_id) REFERENCES candidate_identity.memberships(id,person_id) ON UPDATE CASCADE,
 CHECK(NOT isempty(period)),
 CONSTRAINT person_shift_no_overlap EXCLUDE USING gist(person_id WITH =,period WITH &&)
);
REVOKE ALL ON candidate_operations.person_shift_bookings FROM PUBLIC,candidate_runtime;
-- Fail closed if an existing baseline contains overlapping active references.
INSERT INTO candidate_operations.person_shift_bookings
 SELECT s.id,s.member_id,m.person_id,tstzrange(s.starts_at,s.ends_at,'[)')
 FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id
 WHERE NOT s.cancelled;

CREATE FUNCTION candidate_operations.person_shift_conflict(p_member uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM candidate_identity.memberships target
  JOIN candidate_identity.memberships other ON other.person_id=target.person_id
  JOIN candidate_operations.shift_references s ON s.member_id=other.id
  WHERE target.id=p_member AND NOT s.cancelled AND s.id IS DISTINCT FROM p_exclude
   AND s.starts_at<p_end AND s.ends_at>p_start
 );
$$;
REVOKE ALL ON FUNCTION candidate_operations.person_shift_conflict(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,candidate_runtime;

CREATE FUNCTION candidate_operations.check_person_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- Hold the membership key stable through projection insertion. Coordinate scope
 -- first (aa_coordinate_policy); never acquire another location's scope here.
 PERFORM 1 FROM candidate_identity.memberships WHERE id=NEW.member_id AND restaurant_id=NEW.restaurant_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='owner_denied'; END IF;
 IF NOT NEW.cancelled AND candidate_operations.person_shift_conflict(NEW.member_id,NEW.starts_at,NEW.ends_at,NEW.id)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='shift_overlap'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION candidate_operations.check_person_shift() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER ab_check_person_shift BEFORE INSERT OR UPDATE ON candidate_operations.shift_references
FOR EACH ROW EXECUTE FUNCTION candidate_operations.check_person_shift();

CREATE FUNCTION candidate_operations.sync_person_shift_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
$$;
REVOKE ALL ON FUNCTION candidate_operations.sync_person_shift_booking() FROM PUBLIC,candidate_runtime;
CREATE TRIGGER sync_person_shift_booking AFTER INSERT OR UPDATE OR DELETE ON candidate_operations.shift_references
FOR EACH ROW EXECUTE FUNCTION candidate_operations.sync_person_shift_booking();

-- Explicit reviewed definition: volunteers also observe cross-location bookings.
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
 OR EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND starts_at<s.ends_at AND ends_at>s.starts_at)
 OR EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_offer.restaurant_id AND member_id=m.id AND status='approved' AND candidate_operations.availability_period_conflict(data,s.starts_at,s.ends_at,zone)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=s.id AND c.phase<>'cancelled' AND (m.position='Dishwasher' OR m.id IN (c.manager_id,c.verifier_id) OR c.due<s.starts_at OR c.due>s.ends_at OR c.department<>m.department OR p_offer.mode='coverage' AND c.standard_snapshot->>'position'<>s.position OR NOT EXISTS(SELECT 1 FROM candidate_identity.station_clearances WHERE member_id=m.id AND restaurant_id=p_offer.restaurant_id AND active AND position=c.standard_snapshot->>'position'))) THEN RETURN false; END IF;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION candidate_operations.offer_eligible(candidate_operations.schedule_offers,uuid) FROM PUBLIC,candidate_runtime;

COMMIT;
