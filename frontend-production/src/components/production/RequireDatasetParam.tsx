import { useEffect, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useProductionStore } from './store';

export default function RequireDatasetParam({ children }: { children: ReactElement }) {
  const { id } = useParams<{ id: string }>();
  const datasets = useProductionStore((s) => s.datasets);
  const activeId = useProductionStore((s) => s.activeDatasetId);
  const setActiveDataset = useProductionStore((s) => s.setActiveDataset);

  useEffect(() => {
    if (id && datasets[id] && activeId !== id) {
      setActiveDataset(id);
    }
  }, [id, datasets, activeId, setActiveDataset]);

  if (!id || !datasets[id]) {
    return <Navigate to="/library" replace />;
  }
  return children;
}
