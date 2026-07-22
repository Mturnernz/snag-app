export default function DocumentsPage() {
  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ marginBottom: 4 }}>Documents</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Not built yet.
      </p>
      <div className="card">
        <p style={{ margin: 0 }}>
          This route is scaffolded but intentionally unimplemented — SNAG_WEB_APP_PLAN.md §5/§10
          (decision D2) flags that "upload documents" is ambiguous between snag-scoped evidence
          (already covered by existing buckets/RPCs, no new backend work) and a general org
          document library for policies and certificates (needs a new bucket, table, and RLS
          policies). Building this page's real functionality depends on which one is decided.
        </p>
      </div>
    </div>
  );
}
