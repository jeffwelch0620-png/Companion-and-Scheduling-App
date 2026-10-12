BEGIN;
-- Original local start dates, not worked hours or effective reporting dates.
CREATE INDEX completed_source_start_range ON candidate_operations.shift_references(restaurant_id,starts_at,id) WHERE published AND NOT cancelled;
CREATE INDEX completed_correction_date_range ON candidate_operations.completed_shift_corrections(restaurant_id,shift_local_date,id);

CREATE FUNCTION candidate_operations.correction_position_options(p_restaurant text,p_original text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(job ORDER BY job COLLATE "C"),'[]') FROM (
  SELECT p_original AS job UNION SELECT e.job FROM candidate_identity.schedule_eligibility e
  JOIN candidate_identity.memberships m ON m.id=e.member_id WHERE m.restaurant_id=p_restaurant AND e.active
 ) choices;
$$;
REVOKE ALL ON FUNCTION candidate_operations.correction_position_options(text,text) FROM PUBLIC,candidate_runtime;

-- Required arguments on the ranged overload keep historical defaulted signatures unambiguous.
CREATE FUNCTION candidate_operations.list_completed_shifts(p_subject text,p_member uuid,p_restaurant text,p_after uuid,p_limit integer,p_as_of timestamptz,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;selected uuid[];items jsonb;next_cursor uuid;cutoff timestamptz:=coalesce(p_as_of,statement_timestamp());zone text;range_start timestamptz;range_end timestamptz;
BEGIN
 actor:=candidate_operations.correction_actor(p_subject,p_member,p_restaurant);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR NOT isfinite(cutoff) OR cutoff>statement_timestamp()
 OR (p_from IS NULL)<>(p_to IS NULL) OR p_from IS NOT NULL AND (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_from<DATE '0001-01-01' OR p_to>DATE '9999-12-31')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_query'; END IF;
 SELECT timezone INTO zone FROM candidate_identity.restaurants WHERE id=p_restaurant;
 IF p_from IS NOT NULL THEN range_start:=p_from::timestamp AT TIME ZONE zone;range_end:=(p_to+1)::timestamp AT TIME ZONE zone; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT s.id FROM candidate_operations.shift_references s WHERE s.restaurant_id=p_restaurant
 AND s.published AND NOT s.cancelled AND s.ends_at<=cutoff AND candidate_operations.correction_allowed(actor.id,p_restaurant,s.department)
 AND (p_from IS NULL OR s.starts_at>=range_start AND s.starts_at<range_end)
 AND (p_after IS NULL OR s.id>p_after) ORDER BY s.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(candidate_operations.completed_shift_review_json(actor.id,id) ORDER BY id),'[]') INTO items FROM candidate_operations.shift_references WHERE id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'rangeComplete',next_cursor IS NULL,'from',p_from,'to',p_to,'asOf',cutoff,'scheduleRevision',(SELECT schedule_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant),'correctionRevision',(SELECT correction_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
END;
$$;
CREATE OR REPLACE FUNCTION candidate_operations.list_completed_shifts(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50,p_as_of timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT candidate_operations.list_completed_shifts(p_subject,p_member,p_restaurant,p_after,p_limit,p_as_of,NULL::date,NULL::date);
$$;

CREATE FUNCTION candidate_operations.list_shift_corrections(p_subject text,p_member uuid,p_restaurant text,p_after uuid,p_limit integer,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor candidate_identity.memberships;selected uuid[];items jsonb;next_cursor uuid;
BEGIN
 actor:=candidate_operations.correction_actor(p_subject,p_member,p_restaurant);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_from IS NULL)<>(p_to IS NULL)
 OR p_from IS NOT NULL AND (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR p_from<DATE '0001-01-01' OR p_to>DATE '9999-12-31')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_correction_query'; END IF;
 SELECT array_agg(id ORDER BY id) INTO selected FROM (SELECT r.id FROM candidate_operations.completed_shift_corrections r WHERE r.restaurant_id=p_restaurant
 AND candidate_operations.correction_allowed(actor.id,p_restaurant,r.department) AND (p_from IS NULL OR r.shift_local_date BETWEEN p_from AND p_to)
 AND (p_after IS NULL OR r.id>p_after) ORDER BY r.id LIMIT p_limit+1) page;
 SELECT coalesce(jsonb_agg(candidate_operations.completed_correction_json(actor.id,id) ORDER BY id),'[]') INTO items FROM candidate_operations.completed_shift_corrections WHERE id=ANY(selected[1:p_limit]);
 IF cardinality(selected)>p_limit THEN next_cursor:=selected[p_limit]; END IF;
 RETURN jsonb_build_object('items',items,'nextCursor',next_cursor,'rangeComplete',next_cursor IS NULL,'from',p_from,'to',p_to,'correctionRevision',(SELECT correction_revision FROM candidate_operations.scope_coordination WHERE restaurant_id=p_restaurant));
END;
$$;
CREATE OR REPLACE FUNCTION candidate_operations.list_shift_corrections(p_subject text,p_member uuid,p_restaurant text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT candidate_operations.list_shift_corrections(p_subject,p_member,p_restaurant,p_after,p_limit,NULL::date,NULL::date);
$$;
REVOKE ALL ON FUNCTION candidate_operations.list_completed_shifts(text,uuid,text,uuid,integer,timestamptz,date,date),candidate_operations.list_shift_corrections(text,uuid,text,uuid,integer,date,date) FROM PUBLIC,candidate_runtime;
GRANT EXECUTE ON FUNCTION candidate_operations.list_completed_shifts(text,uuid,text,uuid,integer,timestamptz,date,date),candidate_operations.list_shift_corrections(text,uuid,text,uuid,integer,date,date) TO candidate_runtime;

CREATE OR REPLACE FUNCTION candidate_operations.completed_correction_json(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('id',r.id,'kind','shift-correction','locationId',r.restaurant_id,'ownerId',r.member_id,'area',r.department,'revision',r.revision,'updatedAt',r.updated_at,
 'data',jsonb_build_object('shiftId',r.shift_id,'sourceRevision',r.source_revision,'currentSourceRevision',(SELECT revision FROM candidate_operations.shift_references WHERE id=r.shift_id),'employeeName',p.name,'employeeNameAtEntry',r.employee_name_at_entry,'historicalNameLabel','name at time of entry',
 'original',r.original_snapshot,'timezone',r.timezone,'shiftLocalDate',r.shift_local_date,'effectiveLocalDate',((r.effective_summary->>'start')::timestamptz AT TIME ZONE r.timezone)::date,'positionOptions',candidate_operations.correction_position_options(r.restaurant_id,r.original_snapshot->>'position'),'effectiveSummary',r.effective_summary,'appliedRevision',r.applied_revision,
 'proposal',r.proposal_summary,'proposalBaseRevision',r.proposal_base_revision,'authorId',r.author_id,'authorName',a.name,'authorNameAtEntry',r.author_name_at_entry,
 'reason',r.reason,'decisionNote',r.decision_note,'status',r.status,'actions',candidate_operations.correction_actions(p_actor,r.id),
 'warnings',jsonb_build_object('sourceChanged',NOT candidate_operations.correction_source_matches(r),
 'hasOriginalTasks',EXISTS(SELECT 1 FROM candidate_operations.tasks t WHERE t.shift_id=r.shift_id),
 'hasOriginalClosings',EXISTS(SELECT 1 FROM candidate_operations.closes c WHERE c.shift_id=r.shift_id))))
 FROM candidate_operations.completed_shift_corrections r JOIN candidate_identity.people p ON p.id=r.person_id JOIN candidate_identity.people a ON a.id=r.author_person_id WHERE r.id=p_id;
$$;

CREATE OR REPLACE FUNCTION candidate_operations.completed_shift_review_json(p_actor uuid,p_shift uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('shiftId',s.id,'sourceRevision',coalesce(r.source_revision,s.revision),'currentSourceRevision',s.revision,'ownerId',coalesce(r.member_id,s.member_id),'area',coalesce(r.department,s.department),'employeeName',(SELECT name FROM candidate_identity.people WHERE id=coalesce(r.person_id,m.person_id)),
 'originalSummary',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('start',r.original_snapshot->'starts_at','end',r.original_snapshot->'ends_at','position',r.original_snapshot->'position') ELSE jsonb_build_object('start',s.starts_at,'end',s.ends_at,'position',s.position) END,
 'effectiveSummary',coalesce(r.effective_summary,jsonb_build_object('start',s.starts_at,'end',s.ends_at,'position',s.position)),
 'positionOptions',candidate_operations.correction_position_options(s.restaurant_id,coalesce(r.original_snapshot->>'position',s.position)),
 'effectiveLocalDate',(coalesce((r.effective_summary->>'start')::timestamptz,s.starts_at) AT TIME ZONE coalesce(r.timezone,scope.timezone))::date,
 'timezone',coalesce(r.timezone,scope.timezone),'recordRevision',coalesce(r.revision,0),'correction',candidate_operations.completed_correction_json(p_actor,r.id),
 'canPropose',CASE WHEN r.id IS NOT NULL THEN (candidate_operations.correction_actions(p_actor,r.id)->>'canPropose')::boolean ELSE s.published AND NOT s.cancelled AND s.ends_at<=statement_timestamp() AND (actor.person_id=m.person_id OR candidate_operations.correction_notice_recipients(s.restaurant_id) IS NOT NULL) END)
 FROM candidate_operations.shift_references s JOIN candidate_identity.memberships m ON m.id=s.member_id JOIN candidate_identity.people p ON p.id=m.person_id
 JOIN candidate_identity.restaurants scope ON scope.id=s.restaurant_id JOIN candidate_identity.memberships actor ON actor.id=p_actor
 LEFT JOIN candidate_operations.completed_shift_corrections r ON r.shift_id=s.id WHERE s.id=p_shift;
$$;
COMMIT;
