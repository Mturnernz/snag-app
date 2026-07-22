import styles from './Card.module.css';

type CardOwnProps = { elevated?: boolean; padding?: 'sm'; as?: React.ElementType };

export function Card({
  as: Tag = 'div', children, elevated = false, padding, style, ...rest
}: CardOwnProps & Record<string, any>) {
  return (
    <Tag className={styles.card} data-elevated={elevated} data-padding={padding} style={style} {...rest}>
      {children}
    </Tag>
  );
}

export function StatTile({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <Card padding="sm">
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
    </Card>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.statGrid}>{children}</div>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className={styles.pageHeader}>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className={styles.emptyState}>{children}</p>;
}
