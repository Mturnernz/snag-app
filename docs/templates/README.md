# Policy & procedure templates

Customer-facing document templates, offered as content for the org document library rather
than as product features. The scope comes from `Snag_NZ_HS_Compliance_Analysis.docx` **Part
F.2** ("Policy and procedure templates worth offering customers"), restated and sequenced in
`Snag_HSWA_Compliance_Response_and_Roadmap.docx` **§8**.

Both source documents are explicit that these are "in-app or downloadable content rather than
custom legal drafting", and that every item carries the §6 disclaimer: *this is general
guidance, not legal advice; confirm with your own adviser*. Nothing here has been through
legal review.

## Status

| Template | State | Note from §8 |
|---|---|---|
| Notifiable-event procedure one-pager | **drafted** | "Should sit directly alongside F1's in-app flow, not just as a downloadable PDF" |
| HSR election procedure | **drafted** | "Useful even before F5 ships, since HSR election isn't gated on Snag having an HSR role" |
| Bullying / psychosocial hazard policy | not written | "Ready ahead of F7, so the policy content isn't blocked on the feature" |
| Emergency plan template | not written | Aligned to the GRWM Regulations' required content |
| Health-information handling policy | not written | Retention, access, breach-response; pairs with F2 |

The two drafted are the two the roadmap says aren't gated on unbuilt features. The analysis's
Part G places the template library as a whole in the **Field Reliability** phase, so the
remaining three are deliberately not started.

## Editing and rendering

The `.html` files are the masters — edit those, never the PDFs. Then:

```bash
cd apps/web && node ../../docs/templates/render.mjs      # writes the .pdf files
# in a sandbox whose Chromium doesn't match this playwright version:
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node ../../docs/templates/render.mjs
```

Chromium via Playwright, not LibreOffice: the container's LibreOffice is `libreoffice-core`
only, with no Writer module, so it cannot load any input format at all.

Every field a customer must fill is marked `[LIKE THIS]` and highlighted, and each document
opens with a DRAFT banner saying it is not yet their policy. Both state plainly that **Snag
does not contact WorkSafe** — reporting a snag emails the org's own H&S team, which is the
wording correction §6 asks for.

## Uploading to a library

These are not seeded anywhere. To put one in an org's library, upload it through the portal at
`/documents` (or mobile, Profile → Documents) — the org folder path and the `org_documents` row
are handled by `uploadOrgDocumentFile` / `create_org_document`. Suggested category:
`Procedure`. Keep "(draft template)" in the title until legal review is done, because the
listing shows titles only.
