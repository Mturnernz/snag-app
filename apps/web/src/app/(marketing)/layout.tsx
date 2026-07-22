import Link from 'next/link';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 32px',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Link href="/" style={{ fontWeight: 700, fontSize: 20, textDecoration: 'none', color: 'var(--color-text-primary)' }}>
          SNAG
        </Link>
        <nav style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Link href="/pricing" style={{ textDecoration: 'none', color: 'var(--color-text-secondary)' }}>
            Pricing
          </Link>
          <Link href="/login" style={{ textDecoration: 'none', color: 'var(--color-text-secondary)' }}>
            Log in
          </Link>
          <Link
            href="/sign-up"
            style={{
              textDecoration: 'none',
              color: '#fff',
              background: 'var(--color-primary)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-button)',
              fontWeight: 600,
            }}
          >
            Get started
          </Link>
        </nav>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer
        style={{
          padding: '24px 32px',
          borderTop: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          fontSize: 14,
        }}
      >
        © {new Date().getFullYear()} SNAG
      </footer>
    </div>
  );
}
