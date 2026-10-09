-- Fictional test actors only. Separate ordinary owner and runtime roles.
SET ROLE candidate_schema_owner;
INSERT INTO candidate_identity.restaurants(id,name) VALUES('fictional-a','Fictional A'),('fictional-b','Fictional B');
INSERT INTO candidate_identity.people(id,name) VALUES
 ('00000000-0000-0000-0000-000000000001','Fictional Manager'),
 ('00000000-0000-0000-0000-000000000002','Fictional Employee'),
 ('00000000-0000-0000-0000-000000000003','Fictional Peer'),
 ('00000000-0000-0000-0000-000000000004','Fictional Other Store');
INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES
 ('manager','00000000-0000-0000-0000-000000000001'),('employee','00000000-0000-0000-0000-000000000002'),
 ('peer','00000000-0000-0000-0000-000000000003'),('foreign','00000000-0000-0000-0000-000000000004');
INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,can_manage_tasks) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','fictional-a','BOH',true),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','fictional-a','BOH',false),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','fictional-a','BOH',false),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','fictional-b','BOH',true);
GRANT USAGE ON SCHEMA candidate_operations TO candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.command(text,uuid,text,uuid,jsonb),
 candidate_operations.read_task(text,uuid,text,uuid) TO candidate_runtime;
RESET ROLE;
