import type { ReactNode } from 'react';

export default function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h3>
      {children}
    </div>
  );
}
