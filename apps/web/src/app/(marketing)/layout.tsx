import Link from 'next/link';
import { LinkButton } from '@/components/Button';
import styles from './layout.module.css';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>SNAG</Link>
        <nav className={styles.nav}>
          <Link href="/pricing" className={styles.navLink}>Pricing</Link>
          <Link href="/login" className={styles.navLink}>Log in</Link>
          <LinkButton href="/sign-up" variant="primary" size="sm">Get started</LinkButton>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>© {new Date().getFullYear()} SNAG</footer>
    </div>
  );
}
