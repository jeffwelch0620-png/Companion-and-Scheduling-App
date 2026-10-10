-- Fixed fictional shift for the isolated form preview. Not production schedule data.
SET ROLE candidate_schema_owner;
INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published)
VALUES('30000000-0000-0000-0000-000000000001','fictional-a','10000000-0000-0000-0000-000000000002','BOH','Cook',
 '2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00',1,true) ON CONFLICT(id) DO NOTHING;
