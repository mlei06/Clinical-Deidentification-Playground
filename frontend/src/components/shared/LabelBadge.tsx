import { labelColor } from '../../lib/labelColors';

interface LabelBadgeProps {
  label: string;
  className?: string;
}

export default function LabelBadge({ label, className = '' }: LabelBadgeProps) {
  const c = labelColor(label);
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none ${className}`}
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {label}
    </span>
  );
}
