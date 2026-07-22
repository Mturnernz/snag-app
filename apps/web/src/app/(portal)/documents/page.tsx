import { getOrgDocuments, getOrgDocumentUrl } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import Icon from '@/components/Icon';
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
      <PageHeader
        title="Documents"
        subtitle={`Policies, certificates, and other org-wide files — visible to everyone in ${activeMembership.org_name}.`}
      />

      <Card as="form" action={uploadDocumentAction} encType="multipart/form-data" style={{ marginBottom: 'var(--space-2xl)' }}>
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
        <Button type="submit" variant="primary"><Icon name="Upload" size="sm" /> Upload</Button>
      </Card>

      {documents.length === 0 ? (
        <EmptyState>No documents yet.</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {documents.map((doc, i) => (
            <Card key={doc.id} padding="sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-lg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-button)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="FileText" size="sm" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                    {documentUrls[i] ? (
                      <a href={documentUrls[i]!} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                        {doc.title}
                      </a>
                    ) : (
                      doc.title
                    )}
                  </p>
                  <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {doc.category ? `${doc.category} · ` : ''}
                    Uploaded by {doc.uploader_name ?? 'unknown'} on {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <form action={deleteDocumentAction}>
                <input type="hidden" name="documentId" value={doc.id} />
                <input type="hidden" name="filePath" value={doc.file_path} />
                <Button type="submit" variant="ghost" size="sm"><Icon name="Trash2" size="sm" /></Button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
