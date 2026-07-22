import Link from 'next/link';
import { LinkButton } from '@/components/Button';
import styles from './layout.module.css';

const CONTACT_EMAIL = 'hello@snag.app';

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

      <footer className={styles.footer}>
        <div className={`container ${styles.footerTop}`}>
          <div className={styles.footerBrand}>
            <p className={styles.footerWordmark}>SNAG</p>
            <p className={styles.footerTagline}>Workplace hazard reporting, from photo to fix.</p>
            <span className={styles.hswaBadge}>Built for New Zealand HSWA 2015</span>
          </div>

          <nav className={styles.footerLinks}>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          </nav>
        </div>

        <div className={`container ${styles.footerBottom}`}>
          <p>© {new Date().getFullYear()} SNAG</p>
          <p>Compliance-related content on this site is general guidance, not legal advice.</p>
        </div>
      </footer>
    </div>
  );
}
