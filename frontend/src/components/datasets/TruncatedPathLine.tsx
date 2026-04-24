/**
 * Single-line path display: ellipsis overflow, full value on hover via `title`.
 */
export default function TruncatedPathLine({
  label,
  path,
  className = '',
}: {
  label: string;
  path: string;
  className?: string;
}) {
  const full = `${label}: ${path}`;
  return (
    <div
      className={`flex min-w-0 max-w-full items-baseline gap-1.5 text-[11px] text-gray-400 ${className}`}
      title={full}
    >
      <span className="shrink-0 font-medium text-gray-500">{label}:</span>
      <span className="min-w-0 truncate font-mono text-gray-500">{path}</span>
    </div>
  );
}
