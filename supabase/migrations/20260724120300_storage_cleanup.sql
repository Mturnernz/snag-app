-- PRODUCT_REVIEW.md §4.3 — drop the legacy snag-photos INSERT policy.
--
-- snag-photos carried TWO INSERT policies: the current one requiring the first
-- folder segment to be current_org_id(), and a legacy one requiring it to be
-- auth.uid(). The legacy policy let any member write objects outside the
-- org-folder convention every reader assumes. Those objects were then
-- unreadable via the org-folder SELECT policy but readable via the "photos
-- attached to visible snags" policy — inconsistent rather than leaky, but it
-- widened the write surface for no purpose. PhotoPicker builds paths as
-- `${org_id}/...` (pathPrefix = org_id), so nothing depends on the legacy shape.

drop policy if exists "users can upload snag photos to their own folder" on storage.objects;

-- NOT DONE HERE — the empty, policy-less `work-group-images` bucket is also a
-- leftover (its feature was removed by
-- 20260712070000_remove_work_group_image_upload.sql), but Supabase blocks
-- `delete from storage.buckets` via SQL:
--     "Direct deletion from storage tables is not allowed. Use the Storage API"
-- Remove it from the dashboard (Storage → work-group-images → Delete bucket),
-- or via the Storage API with a service-role key. It holds zero objects, so
-- there is nothing to migrate first.
