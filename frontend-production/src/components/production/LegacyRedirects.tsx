import { Navigate } from 'react-router-dom';
import { useProductionStore } from './store';

export function WorkspaceLegacyRedirect() {
  const activeId = useProductionStore((s) => s.activeDatasetId);
  if (!activeId) return <Navigate to="/library" replace />;
  return <Navigate to={`/datasets/${activeId}/review`} replace />;
}

export function SettingsLegacyRedirect() {
  const activeId = useProductionStore((s) => s.activeDatasetId);
  if (!activeId) return <Navigate to="/library" replace />;
  return <Navigate to={`/datasets/${activeId}/export`} replace />;
}
