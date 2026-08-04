-- The CSV export on /reports has never once produced a file.
--
-- `governance-reports` had a SELECT policy and nothing else, so the bucket was
-- readable and unwritable. That was invisible for as long as only the PDF
-- existed: `export-governance-report` is an edge function holding the service
-- role, which bypasses RLS entirely — every object in the bucket is a PDF with
-- a null owner, written by it.
--
-- `/reports/export-csv` is a Next route handler, so it uploads as the signed-in
-- user and RLS applies. The upload was refused, the route redirected to
-- /reports?error=Upload failed: …, and the reason showed up as a line of text
-- on the page rather than anywhere anyone was watching.
--
-- Only the storage side was missing. `record_governance_export` is SECURITY
-- DEFINER and already refuses anyone who isn't an officer admin, which is why
-- `governance_reports` needs no INSERT policy of its own.
--
-- The role test is repeated here deliberately: the route checks it, the RPC
-- checks it, and now the bucket does too. Without it any org member could
-- write a file into the org's governance folder, where the SELECT policy would
-- then serve it to everyone as though the organisation had produced it.

create policy "officer admins can upload their org's governance reports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'governance-reports'
    and (storage.foldername(name))[1] = (current_org_id())::text
    and "current_role"() = 'officer_admin'::user_role
  );
