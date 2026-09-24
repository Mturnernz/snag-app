import Link from 'next/link';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

export function Button({
  as: Tag = 'button', variant = 'primary', size = 'md', className, ...rest
}: { as?: React.ElementType; variant?: Variant; size?: Size } & Record<string, any>) {
  return (
    <Tag
      className={[styles.btn, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      {...rest}
    />
  );
}

export function LinkButton({
  variant = 'primary', size = 'md', href, className, ...rest
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link
      href={href}
      className={[styles.btn, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      {...rest}
    />
  );
}
