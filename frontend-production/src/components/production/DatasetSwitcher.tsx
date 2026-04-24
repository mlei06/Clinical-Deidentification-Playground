import { useState } from 'react';
import { Plus, Trash2, Pencil, Copy as CopyIcon, Database } from 'lucide-react';
import { useProductionStore, useActiveDataset } from './store';

export default function DatasetSwitcher() {
  const active = useActiveDataset();
  const datasets = useProductionStore((s) => s.datasets);
  const createDataset = useProductionStore((s) => s.createDataset);
  const renameDataset = useProductionStore((s) => s.renameDataset);
  const deleteDataset = useProductionStore((s) => s.deleteDataset);
  const setActiveDataset = useProductionStore((s) => s.setActiveDataset);
  const duplicateDataset = useProductionStore((s) => s.duplicateDataset);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  const list = Object.values(datasets).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const onCreate = () => {
    const name = prompt('Dataset name', `Dataset ${list.length + 1}`);
    if (!name?.trim()) return;
    const id = createDataset(name.trim());
    setActiveDataset(id);
  };

  const onRename = () => {
    if (!active) return;
    if (!draftName.trim()) {
      setEditing(false);
      return;
    }
    renameDataset(active.id, draftName.trim());
    setEditing(false);
  };

  const onDuplicate = () => {
    if (!active) return;
    const name = prompt('Duplicate as', `${active.name} copy`);
    if (!name?.trim()) return;
    const id = duplicateDataset(active.id, name.trim());
    if (id) setActiveDataset(id);
  };

  const onDelete = () => {
    if (!active) return;
    if (!confirm(`Delete dataset "${active.name}"? This cannot be undone.`)) return;
    deleteDataset(active.id);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">Dataset</label>
      <div className="flex items-center gap-1">
        <Database size={14} className="text-gray-400" />
        {editing && active ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={onRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-48 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
          />
        ) : (
          <select
            value={active?.id ?? ''}
            onChange={(e) => setActiveDataset(e.target.value || null)}
            disabled={list.length === 0}
            className="min-w-[12rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 shadow-sm disabled:opacity-40"
          >
            {list.length === 0 && <option value="">No datasets</option>}
            {list.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.files.length})
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          title="Create a new dataset"
        >
          <Plus size={12} />
          New
        </button>
        {active && !editing && (
          <>
            <button
              type="button"
              onClick={() => {
                setDraftName(active.name);
                setEditing(true);
              }}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              title="Rename dataset"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              title="Duplicate dataset"
            >
              <CopyIcon size={12} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title="Delete dataset"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
