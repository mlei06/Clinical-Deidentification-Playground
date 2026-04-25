import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { Activity, BookOpen } from 'lucide-react';
import { useProductionStore } from '../../components/production/store';
import DatasetSubShell from './DatasetSubShell';
import GlobalSettingsPopover from './GlobalSettingsPopover';

const TABS = [
  { to: '/library', label: 'Library', icon: BookOpen },
  { to: '/audit', label: 'Audit', icon: Activity },
] as const;

function useDatasetForRoute() {
  const params = useParams();
  const datasets = useProductionStore((s) => s.datasets);
  const id = params.id;
  return id ? (datasets[id] ?? null) : null;
}

export default function ProductionShell() {
  const location = useLocation();
  const datasetForRoute = useDatasetForRoute();
  const onDatasetRoute = location.pathname.startsWith('/datasets/');
  const breadcrumbStep = (() => {
    if (!onDatasetRoute || !datasetForRoute) return null;
    if (location.pathname.includes('/files')) return 'Files';
    if (location.pathname.includes('/detect')) return 'Detect';
    if (location.pathname.includes('/review')) return 'Review';
    if (location.pathname.includes('/export')) return 'Export';
    return null;
  })();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-gray-900">Clinical De-ID Production</span>
          <span className="truncate text-[11px] text-gray-500">
            Library
            {datasetForRoute ? ` > ${datasetForRoute.name}` : ''}
            {breadcrumbStep ? ` > ${breadcrumbStep}` : ''}
          </span>
        </div>
        <nav className="flex gap-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/library'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
                )
              }
            >
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <GlobalSettingsPopover />
        </div>
      </header>
      {onDatasetRoute && datasetForRoute && <DatasetSubShell dataset={datasetForRoute} />}
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
