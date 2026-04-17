import { NavLink, Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import { ShieldCheck, Activity } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Review', icon: ShieldCheck },
  { to: '/audit', label: 'Audit', icon: Activity },
] as const;

export default function ProductionShell() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <span className="text-sm font-semibold text-gray-900">Clinical De-ID Production</span>
        <nav className="flex gap-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
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
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
