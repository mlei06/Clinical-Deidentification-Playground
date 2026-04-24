import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useImportSources, useRegisterDataset } from '../../hooks/useDatasets';
import TruncatedPathLine from './TruncatedPathLine';

const CUSTOM_PATH_VALUE = '__custom__';
const PLACEHOLDER_VALUE = '';

interface RegisterFormProps {
  onRegistered: (name: string) => void;
}

export default function RegisterForm({ onRegistered }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [description, setDescription] = useState('');

  const importSources = useImportSources();
  const mutation = useRegisterDataset();

  const candidates = importSources.data?.candidates ?? [];

  const handleSourceChange = (value: string) => {
    setSourceKey(value);
    if (value === PLACEHOLDER_VALUE) {
      setDataPath('');
      return;
    }
    if (value === CUSTOM_PATH_VALUE) {
      setDataPath('');
      return;
    }
    const c = candidates.find((x) => x.data_path === value);
    if (c) {
      setDataPath(c.data_path);
    }
  };

  const handleSubmit = () => {
    if (!name.trim() || !dataPath.trim()) return;
    mutation.mutate(
      {
        name: name.trim(),
        data_path: dataPath.trim(),
        format: 'jsonl',
        description: description.trim() || undefined,
      },
      {
        onSuccess: (d) => {
          onRegistered(d.name);
          setName('');
          setSourceKey('');
          setDataPath('');
          setDescription('');
        },
      },
    );
  };

  const pathIsReadOnly = sourceKey !== CUSTOM_PATH_VALUE;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-corpus"
            className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
            className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">JSONL in data folder</label>
          <select
            value={sourceKey}
            onChange={(e) => handleSourceChange(e.target.value)}
            disabled={importSources.isLoading}
            className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none disabled:opacity-50"
          >
            <option value={PLACEHOLDER_VALUE}>
              {candidates.length || importSources.isLoading
                ? 'Select a JSONL file…'
                : 'No importable JSONL in corpora root'}
            </option>
            {candidates.map((c) => (
              <option key={c.data_path} value={c.data_path}>
                {c.label} (jsonl)
              </option>
            ))}
            <option value={CUSTOM_PATH_VALUE}>Other path…</option>
          </select>
          {importSources.isError ? (
            <span className="text-xs text-red-600">{(importSources.error as Error).message}</span>
          ) : null}
          {importSources.data?.corpora_root ? (
            <TruncatedPathLine label="Root" path={importSources.data.corpora_root} className="mt-1" />
          ) : null}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">Data path</label>
          <input
            type="text"
            value={dataPath}
            onChange={(e) => setDataPath(e.target.value)}
            placeholder="/path/to/corpus.jsonl"
            readOnly={pathIsReadOnly}
            title={dataPath || undefined}
            className="w-full min-w-0 max-w-full truncate rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none read-only:bg-gray-50 read-only:text-gray-600"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || !dataPath.trim() || mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
        >
          {mutation.isPending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          Import JSONL
        </button>
        {mutation.isError && (
          <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
        )}
      </div>
    </div>
  );
}
