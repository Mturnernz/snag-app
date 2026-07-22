import { getOrgDocuments, getOrgDocumentUrl } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { uploadDocumentAction, deleteDocumentAction } from './actions';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { error } = await searchParams;
  const supabase = await createClient();

  const documents = await getOrgDocuments(supabase, activeMembership.org_id);
  const documentUrls = await Promise.all(documents.map((d) => getOrgDocumentUrl(supabase, d.file_path)));

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 4 }}>Documents</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>
        Policies, certificates, and other org-wide files — visible to everyone in {activeMembership.org_name}.
      </p>

      <form action={uploadDocumentAction} encType="multipart/form-data" className="card" style={{ marginBottom: 32 }}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" type="text" required placeholder="e.g. Site induction handbook" />
        </div>
        <div className="field">
          <label htmlFor="category">Category (optional)</label>
          <input id="category" name="category" type="text" placeholder="e.g. Policy, Certificate, Induction" />
        </div>
        <div className="field">
          <label htmlFor="file">File</label>
          <input id="file" name="file" type="file" required />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary">Upload</button>
      </form>

      {documents.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No documents yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((doc, i) => (
            <div key={doc.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                  {documentUrls[i] ? (
                    <a href={documentUrls[i]!} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                      {doc.title}
                    </a>
                  ) : (
                    doc.title
                  )}
                </p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {doc.category ? `${doc.category} · ` : ''}
                  Uploaded by {doc.uploader_name ?? 'unknown'} on {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              <form action={deleteDocumentAction}>
                <input type="hidden" name="documentId" value={doc.id} />
                <input type="hidden" name="filePath" value={doc.file_path} />
                <button type="submit" className="btn-secondary" style={{ fontSize: 13, padding: '6px 12px' }}>
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
