import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { FileText, Download } from 'lucide-react';
import type { Dataset } from '../../components/production/store';

interface DatasetSubShellProps {
  dataset: Dataset;
}

interface SubTab {
  to: string;
  label: string;
  icon: typeof FileText;
  badge?: number | string;
  badgeTone?: 'neutral' | 'warn' | 'danger';
  disabled?: boolean;
}

export default function DatasetSubShell({ dataset }: DatasetSubShellProps) {
  const location = useLocation();
  const id = dataset.id;
  const total = dataset.files.length;
  const resolved = dataset.files.filter((f) => f.resolved).length;
  const exportable = total;

  const tabs: SubTab[] = [
    {
      to: `/datasets/${id}/files`,
      label: 'Workspace',
      icon: FileText,
      badge: total > 0 ? total : undefined,
      badgeTone: 'neutral',
    },
    {
      to: `/datasets/${id}/export`,
      label: 'Export',
      icon: Download,
      badge: exportable > 0 ? exportable : undefined,
      badgeTone: 'neutral',
      disabled: total === 0,
    },
  ];

  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-1.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-semibold text-gray-800">{dataset.name}</span>
        <span className="text-[10px] text-gray-500">
          {resolved}/{total} resolved
        </span>
      </div>
      <nav className="ml-auto flex items-center gap-1">
        {tabs.map(({ to, label, icon: Icon, badge, badgeTone = 'neutral', disabled }) => {
          const isWorkspacePath =
            location.pathname === `/datasets/${id}/files` ||
            location.pathname === `/datasets/${id}/detect` ||
            location.pathname === `/datasets/${id}/review` ||
            location.pathname.startsWith(`/datasets/${id}/review/`);
          const isActive =
            label === 'Workspace' ? isWorkspacePath : location.pathname === to;
          if (disabled) {
            return (
              <span
                key={to}
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-gray-300"
                title={`${label} (no files yet)`}
              >
                <Icon size={12} />
                {label}
              </span>
            );
          }
          return (
            <NavLink
              key={to}
              to={to}
              className={() =>
                clsx(
                  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium',
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-200',
                )
              }
            >
              <Icon size={12} />
              {label}
              {badge != null && (
                <span
                  className={clsx(
                    'ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[9px] font-semibold',
                    isActive
                      ? 'bg-white/20 text-white'
                      : badgeTone === 'warn'
                        ? 'bg-amber-100 text-amber-800'
                        : badgeTone === 'danger'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-200 text-gray-700',
                  )}
                >
                  {badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
