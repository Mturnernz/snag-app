-- A linked item says who services it.
--
-- `things.spec.servicedBy` is asked by *Schedule service* on the thing's page
-- ("who does it"), and until now only that page could show it. The job page's
-- *Linked items* draws itself from `snags_with_details.linked_things`, so the
-- answer goes in there: `serviced_by`, the trimmed text or null. The job page
-- and the thing card both show it as a *Serviced by …* pill.
--
-- Only the jsonb inside `linked_things` changes; the column list is exactly
-- what `20260920100000` wrote, one by one, so `create or replace` takes it and
-- the grant survives. **The `with (security_invoker = true)` is not optional**:
-- a replace without it resets the option and the view stops asking RLS
-- anything (`20260921100000`, and `viewSecurity.test.ts`).

create or replace view home.snags_with_details with (security_invoker = true) as
 SELECT s.id,
    s.reference,
    s.household_id,
    s.property_id,
    s.room,
    s.photo_paths,
    s.description,
    s.status,
    s.priority,
    s.parts,
    s.due_at,
    s.repeat_days,
    s.assignee_id,
    s.thing_id,
    s.project_id,
    s.reporter_id,
    s.created_at,
    s.updated_at,
    s.updated_by,
    s.last_done_at,
    s.done_at,
    COALESCE(( SELECT array_agg(t.i ORDER BY t.ordinality) AS array_agg
           FROM unnest(s.parts) WITH ORDINALITY t(i, ordinality)
          WHERE (EXISTS ( SELECT 1
                   FROM home.bought_parts b
                  WHERE b.snag_id = s.id AND b.item = t.i))), '{}'::text[]) AS bought,
    (EXISTS ( SELECT 1
           FROM unnest(s.parts) i(i)
          WHERE NOT (EXISTS ( SELECT 1
                   FROM home.bought_parts b
                  WHERE b.snag_id = s.id AND b.item = i.i)))) AS needs_parts,
    p.name AS property_name,
    reporter.display_name AS reporter_name,
    assignee.display_name AS assignee_name,
    thing.name AS thing_name,
    thing.make AS thing_make,
    thing.model AS thing_model,
    project.name AS project_name,
    ( SELECT count(*) AS count
           FROM home.comments c
          WHERE c.snag_id = s.id) AS comment_count,
    s.project_item_id,
    item.name AS project_item_name,
    element.name AS project_element_name,
    -- What the job is about, whole, so the card can draw itself without a
    -- second round trip per row. Ordered by name because the card is read
    -- rather than ranked, and `'[]'` rather than null because a caller
    -- defaulting a null is a caller that can forget to.
    COALESCE(( SELECT jsonb_agg(jsonb_build_object(
                   'id', lt.id, 'name', lt.name, 'room', lt.room,
                   'make', lt.make, 'model', lt.model, 'kind', lt.kind,
                   'serviced_by', NULLIF(btrim(lt.spec ->> 'servicedBy'), ''))
                 ORDER BY lt.name)
           FROM home.snag_things st
           JOIN home.things lt ON lt.id = st.thing_id
          WHERE st.snag_id = s.id), '[]'::jsonb) AS linked_things
   FROM home.snags s
     JOIN home.properties p ON p.id = s.property_id
     JOIN home.profiles reporter ON reporter.id = s.reporter_id
     LEFT JOIN home.profiles assignee ON assignee.id = s.assignee_id
     LEFT JOIN home.things thing ON thing.id = s.thing_id
     LEFT JOIN home.projects project ON project.id = s.project_id
     LEFT JOIN home.project_items item ON item.id = s.project_item_id
     LEFT JOIN home.project_elements element ON element.id = item.element_id;
