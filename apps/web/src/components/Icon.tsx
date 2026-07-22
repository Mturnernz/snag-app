import { icons, type LucideProps } from 'lucide-react';

// Mirrors apps/mobile's shared Icon component (Ionicons + IconSize scale) —
// same idea, lucide-react instead of @expo/vector-icons since this runs in
// the browser. Sizes match theme.ts's IconSize scale (sm/md/lg/xl/xxl) so
// icon sizing stays consistent across both clients even though the
// underlying icon sets differ.
export type IconName = keyof typeof icons;

const SIZES = { sm: 16, md: 20, lg: 24, xl: 32, xxl: 40 } as const;

export default function Icon({
  name,
  size = 'md',
  color = 'currentColor',
  strokeWidth = 1.75,
  ...rest
}: {
  name: IconName;
  size?: keyof typeof SIZES | number;
  color?: string;
} & Omit<LucideProps, 'size' | 'color'>) {
  const LucideIcon = icons[name];
  const px = typeof size === 'number' ? size : SIZES[size];
  return <LucideIcon size={px} color={color} strokeWidth={strokeWidth} {...rest} />;
}
