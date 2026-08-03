-- Tie a snag photo's storage folder to the snag it hangs off.
--
-- `photos attached to visible snags are viewable` (20260708090000) exists for
-- public and QR reporters: they have no org, so they upload under their own
-- auth.uid() folder and the org-folder policies can never match them. To cover
-- that, the policy asked only "is this object named by some snag you can see?"
--
-- But the snag naming it is one you can create, with an array you supply:
--
--   create_snag(..., p_photo_paths => array['<someone-elses-folder>/<file>'])
--
-- makes you the reporter of a snag you can see — `reporter_id = auth.uid()` is
-- a clause in the snags SELECT policy — and so made any object path you could
-- name readable. create_snag does not validate that the paths sit in your own
-- folder, and the upload policies that do enforce that are INSERT-side only,
-- which is a different question from which paths a row may reference.
--
-- Cross-org reach was already closed, by RLS rather than by this policy: the
-- subquery runs as the caller, so `snags` is filtered to their own rows.
-- Verified before this migration — a member of another org saw 0 of the 27
-- objects in the bucket. What remained was an authorisation decision keyed on
-- attacker-supplied data, exploitable only by someone who already knew an
-- exact `<uuid>/<uuid>-<name>` path.
--
-- Narrow, but the fix is narrower still, and it belongs here rather than in
-- create_snag: the boundary is what the object grants, not what the row is
-- allowed to say. Require the folder to be one the *snag itself* justifies —
-- its org, or the reporter who filed it. That keeps the public-reporter case
-- the policy was written for (their folder is their uid, and it is their snag)
-- and drops the case where the path names somebody else entirely.

drop policy "photos attached to visible snags are viewable" on storage.objects;
create policy "photos attached to visible snags are viewable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snag-photos'
    and exists (
      select 1 from public.snags s
      where (s.photo_path = name or name = any (s.photo_paths))
        and (storage.foldername(name))[1] in ((s.org_id)::text, (s.reporter_id)::text)
    )
  );
