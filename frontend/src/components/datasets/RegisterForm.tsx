import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { useRegisterDataset } from '../../hooks/useDatasets';

interface RegisterFormProps {
  onRegistered: (name: string) => void;
}

export default function RegisterForm({ onRegistered }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [format, setFormat] = useState<'jsonl' | 'brat-dir' | 'brat-corpus'>('jsonl');
  const [description, setDescription] = useState('');

  const mutation = useRegisterDataset();

  const handleSubmit = () => {
    if (!name.trim() || !dataPath.trim()) return;
    mutation.mutate(
      {
        name: name.trim(),
        data_path: dataPath.trim(),
        format,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (d) => {
          onRegistered(d.name);
          setName('');
          setDataPath('');
          setDescription('');
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-corpus"
          className="w-36 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Data Path</label>
        <input
          type="text"
          value={dataPath}
          onChange={(e) => setDataPath(e.target.value)}
          placeholder="/path/to/corpus.jsonl"
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Format</label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        >
          <option value="jsonl">JSONL</option>
          <option value="brat-dir">BRAT Directory</option>
          <option value="brat-corpus">BRAT Corpus</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="optional"
          className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!name.trim() || !dataPath.trim() || mutation.isPending}
        className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
      >
        {mutation.isPending ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Plus size={15} />
        )}
        Register
      </button>
      {mutation.isError && (
        <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
      )}
    </div>
  );
}
