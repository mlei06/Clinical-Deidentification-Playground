import { useMemo, useState } from 'react';
import { Database, Plus, Pencil, Copy as CopyIcon, Trash2, Search, Play, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useActiveDataset, useProductionStore } from './store';

type DatasetActionModal =
  | { type: 'rename'; datasetId: string; initialName: string }
  | { type: 'duplicate'; datasetId: string; initialName: string }
  | { type: 'delete'; datasetId: string; initialName: string }
  | null;

export default function LibraryView() {
  const active = useActiveDataset();
  const datasets = useProductionStore((s) => s.datasets);
  const setActiveDataset = useProductionStore((s) => s.setActiveDataset);
  const renameDataset = useProductionStore((s) => s.renameDataset);
  const duplicateDataset = useProductionStore((s) => s.duplicateDataset);
  const deleteDataset = useProductionStore((s) => s.deleteDataset);
  const createDataset = useProductionStore((s) => s.createDataset);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [actionModal, setActionModal] = useState<DatasetActionModal>(null);
  const [actionName, setActionName] = useState('');

  const list = useMemo(
    () => Object.values(datasets).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [datasets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      const resolved = d.files.filter((f) => f.resolved).length;
      if (filter === 'in_progress') return d.files.length > 0 && resolved < d.files.length;
      if (filter === 'completed') return d.files.length > 0 && resolved === d.files.length;
      return true;
    });
  }, [filter, list, query]);

  const openWorkspace = (id: string) => {
    setActiveDataset(id);
    navigate(`/datasets/${id}/files`);
  };

  const openExport = (id: string) => {
    setActiveDataset(id);
    navigate(`/datasets/${id}/export`);
  };

  const onCreate = () => {
    const trimmed = createName.trim();
    if (!trimmed) return;
    const id = createDataset(trimmed);
    setActiveDataset(id);
    setCreateName('');
    setCreateOpen(false);
    navigate(`/datasets/${id}/files`);
  };

  const openActionModal = (modal: Exclude<DatasetActionModal, null>) => {
    setActionModal(modal);
    if (modal.type === 'rename') setActionName(modal.initialName);
    if (modal.type === 'duplicate') setActionName(`${modal.initialName} copy`);
    if (modal.type === 'delete') setActionName(modal.initialName);
  };

  const closeActionModal = () => {
    setActionModal(null);
    setActionName('');
  };

  const submitAction = () => {
    if (!actionModal) return;
    const name = actionName.trim();
    if (actionModal.type === 'rename') {
      if (!name) return;
      renameDataset(actionModal.datasetId, name);
      closeActionModal();
      return;
    }
    if (actionModal.type === 'duplicate') {
      if (!name) return;
      const id = duplicateDataset(actionModal.datasetId, name);
      if (id) setActiveDataset(id);
      closeActionModal();
      return;
    }
    deleteDataset(actionModal.datasetId);
    closeActionModal();
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="relative min-w-[260px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search datasets"
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-sm text-gray-800"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
        >
          <option value="all">All</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
        >
          <Plus size={12} />
          New dataset
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((d) => {
          const resolved = d.files.filter((f) => f.resolved).length;
          const progress = d.files.length ? Math.round((resolved / d.files.length) * 100) : 0;
          const isActive = active?.id === d.id;
          return (
            <article
              key={d.id}
              className={`rounded-lg border bg-white p-4 shadow-sm ${
                isActive ? 'border-gray-900' : 'border-gray-200'
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{d.name}</h2>
                  <p className="text-[11px] text-gray-500">
                    {d.files.length} files · {resolved} resolved
                  </p>
                </div>
                <Database size={14} className="text-gray-400" />
              </div>
              <div className="mb-3">
                <div className="h-1.5 rounded bg-gray-100">
                  <div
                    className="h-1.5 rounded bg-green-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{progress}% complete</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openWorkspace(d.id)}
                  className="inline-flex items-center gap-1 rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800"
                >
                  <Play size={11} />
                  Open workspace
                </button>
                <button
                  type="button"
                  onClick={() => openExport(d.id)}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  title="Browse saved outputs and export"
                >
                  <Eye size={11} />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openActionModal({
                      type: 'rename',
                      datasetId: d.id,
                      initialName: d.name,
                    })
                  }
                  className="rounded border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                  title="Rename dataset"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openActionModal({
                      type: 'duplicate',
                      datasetId: d.id,
                      initialName: d.name,
                    })
                  }
                  className="rounded border border-gray-200 p-1 text-gray-500 hover:bg-gray-50"
                  title="Duplicate dataset"
                >
                  <CopyIcon size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openActionModal({
                      type: 'delete',
                      datasetId: d.id,
                      initialName: d.name,
                    })
                  }
                  className="rounded border border-red-200 p-1 text-red-500 hover:bg-red-50"
                  title="Delete dataset"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No datasets match this filter.
          </div>
        )}
      </div>
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2 className="text-sm font-semibold text-gray-900">Create dataset</h2>
            <p className="mt-1 text-xs text-gray-500">
              Give the dataset a name and start labeling in Workspace.
            </p>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
              }}
              placeholder={`Dataset ${list.length + 1}`}
              className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCreate}
                className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <h2 className="text-sm font-semibold text-gray-900">
              {actionModal.type === 'rename'
                ? 'Rename dataset'
                : actionModal.type === 'duplicate'
                  ? 'Duplicate dataset'
                  : 'Delete dataset'}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {actionModal.type === 'delete'
                ? `Remove "${actionModal.initialName}" from your local workspace.`
                : 'Enter the dataset name.'}
            </p>
            {actionModal.type === 'delete' ? (
              <p className="mt-3 rounded border border-red-100 bg-red-50 px-2 py-2 text-xs text-red-700">
                This deletes the dataset and all files inside it.
              </p>
            ) : (
              <input
                autoFocus
                value={actionName}
                onChange={(e) => setActionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAction();
                }}
                className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeActionModal}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAction}
                className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
                  actionModal.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-gray-900 hover:bg-gray-800'
                }`}
              >
                {actionModal.type === 'delete'
                  ? 'Delete'
                  : actionModal.type === 'duplicate'
                    ? 'Duplicate'
                    : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
