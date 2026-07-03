import { useState } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

// Collapsible card. Open state is initialised from the progress model
// (exactly one section should default open — the user's next step) but
// stays user-controllable after that.
export default function Section({ title, subtitle, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="section"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span>
          {title}
          {subtitle && (
            <span className="meta" style={{ fontWeight: 400, marginLeft: 8 }}>{subtitle}</span>
          )}
        </span>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
