-- ISOLATED D1 PROTOTYPE. Not in drizzle or the deployed migration list.
-- No identities/grants seeded. Requires existing memberships; no live apply.
CREATE TABLE prototype_authority_principals (
 organization_id TEXT NOT NULL, person_id TEXT NOT NULL,
 auth_user_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 active INTEGER NOT NULL CHECK(active IN(0,1)),
 verified_at TEXT NOT NULL CHECK(julianday(verified_at) IS NOT NULL), verified_by_person_id TEXT NOT NULL CHECK(length(trim(verified_by_person_id))>0),
 source_ref TEXT NOT NULL CHECK(length(trim(source_ref))>0),
 PRIMARY KEY(organization_id,person_id), UNIQUE(organization_id,auth_user_id)
);
--> statement-breakpoint
CREATE TABLE prototype_authority_grants (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, person_id TEXT NOT NULL,
 membership_id TEXT REFERENCES memberships(id), membership_revision INTEGER,
 store_id TEXT, role TEXT NOT NULL CHECK(role IN('owner','gm','foh-manager','boh-manager','covering-foh','covering-boh')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), active INTEGER NOT NULL CHECK(active IN(0,1)),
 starts_at TEXT NOT NULL, ends_at TEXT,
 verified_at TEXT NOT NULL, verified_by_person_id TEXT NOT NULL CHECK(length(trim(verified_by_person_id))>0),
 source_ref TEXT NOT NULL CHECK(length(trim(source_ref))>0),
 FOREIGN KEY(organization_id,person_id) REFERENCES prototype_authority_principals(organization_id,person_id),
 CHECK((role='owner' AND membership_id IS NULL AND membership_revision IS NULL AND store_id IS NULL)
  OR (role<>'owner' AND membership_id IS NOT NULL AND membership_revision>0 AND store_id IS NOT NULL)),
 CHECK(role NOT IN('covering-foh','covering-boh') OR ends_at IS NOT NULL),
 CHECK(ends_at IS NULL OR (julianday(ends_at) IS NOT NULL AND julianday(ends_at)>julianday(starts_at))),
 CHECK(julianday(starts_at) IS NOT NULL AND julianday(verified_at) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE prototype_authority_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, identity_key TEXT NOT NULL,
 old_revision INTEGER NOT NULL, recorded_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), snapshot TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER prototype_principal_revision BEFORE UPDATE ON prototype_authority_principals
 WHEN NEW.revision<OLD.revision OR NEW.revision>OLD.revision+1 OR NEW.organization_id<>OLD.organization_id OR NEW.person_id<>OLD.person_id
 BEGIN SELECT RAISE(ABORT,'Authority identity is immutable; revision cannot go backwards or skip'); END;
--> statement-breakpoint
CREATE TRIGGER prototype_principal_changed AFTER UPDATE OF organization_id,person_id,auth_user_id,active,verified_at,verified_by_person_id,source_ref ON prototype_authority_principals
 BEGIN
  INSERT INTO prototype_authority_history(entity,identity_key,old_revision,snapshot) VALUES('principal',OLD.organization_id||':'||OLD.person_id,OLD.revision,json_object('organizationId',OLD.organization_id,'personId',OLD.person_id,'authUserId',OLD.auth_user_id,'active',OLD.active,'verifiedAt',OLD.verified_at,'verifiedByPersonId',OLD.verified_by_person_id,'sourceRef',OLD.source_ref));
  UPDATE prototype_authority_principals SET revision=OLD.revision+1 WHERE organization_id=NEW.organization_id AND person_id=NEW.person_id;
 END;
--> statement-breakpoint
CREATE TRIGGER prototype_grant_revision BEFORE UPDATE ON prototype_authority_grants
 WHEN NEW.revision<OLD.revision OR NEW.revision>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.person_id<>OLD.person_id
 BEGIN SELECT RAISE(ABORT,'Authority identity is immutable; revision cannot go backwards or skip'); END;
--> statement-breakpoint
CREATE TRIGGER prototype_grant_changed AFTER UPDATE OF organization_id,person_id,membership_id,membership_revision,store_id,role,active,starts_at,ends_at,verified_at,verified_by_person_id,source_ref ON prototype_authority_grants
 BEGIN
  INSERT INTO prototype_authority_history(entity,identity_key,old_revision,snapshot) VALUES('grant',OLD.id,OLD.revision,json_object('id',OLD.id,'organizationId',OLD.organization_id,'personId',OLD.person_id,'membershipId',OLD.membership_id,'membershipRevision',OLD.membership_revision,'storeId',OLD.store_id,'role',OLD.role,'active',OLD.active,'startsAt',OLD.starts_at,'endsAt',OLD.ends_at,'verifiedAt',OLD.verified_at,'verifiedByPersonId',OLD.verified_by_person_id,'sourceRef',OLD.source_ref));
  UPDATE prototype_authority_grants SET revision=OLD.revision+1 WHERE id=NEW.id;
 END;
--> statement-breakpoint
CREATE TRIGGER prototype_principal_no_delete BEFORE DELETE ON prototype_authority_principals
 BEGIN SELECT RAISE(ABORT,'Revoke authority; preserve its identity and history'); END;
--> statement-breakpoint
CREATE TRIGGER prototype_grant_no_delete BEFORE DELETE ON prototype_authority_grants
 BEGIN SELECT RAISE(ABORT,'Revoke authority; preserve its identity and history'); END;
