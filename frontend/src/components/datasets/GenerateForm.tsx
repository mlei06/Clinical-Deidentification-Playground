import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useGenerateDataset } from '../../hooks/useDatasets';

interface GenerateFormProps {
  onCreated: (name: string) => void;
}

const DEFAULT_PHI_TYPES = ['PERSON', 'DATE', 'LOCATION', 'ID', 'PHONE', 'AGE'];

export default function GenerateForm({ onCreated }: GenerateFormProps) {
  const mutation = useGenerateDataset();

  const [outputName, setOutputName] = useState('');
  const [count, setCount] = useState('10');
  const [phiTypes, setPhiTypes] = useState(DEFAULT_PHI_TYPES.join(', '));
  const [specialRules, setSpecialRules] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!outputName.trim()) return;
    const types = phiTypes
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    mutation.mutate(
      {
        output_name: outputName.trim(),
        count: parseInt(count, 10) || 10,
        phi_types: types.length > 0 ? types : undefined,
        special_rules: specialRules.trim() || undefined,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (d) => {
          onCreated(d.name);
          setOutputName('');
          setCount('10');
          setSpecialRules('');
          setDescription('');
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
        Generate Synthetic Data
      </h4>
      <p className="mb-3 text-xs text-gray-400">
        Uses the configured LLM (OpenAI-compatible) to generate annotated clinical notes with PHI.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Output Name</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="synthetic-v1"
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Count</label>
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min={1}
              max={500}
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">
            PHI Types <span className="text-gray-400">(comma-sep)</span>
          </label>
          <input
            type="text"
            value={phiTypes}
            onChange={(e) => setPhiTypes(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Special Rules</label>
          <textarea
            value={specialRules}
            onChange={(e) => setSpecialRules(e.target.value)}
            placeholder="Optional instructions for the LLM..."
            rows={2}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={!outputName.trim() || mutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            Generate
          </button>
          {mutation.isPending && (
            <span className="text-xs text-gray-400">Generating {count} notes via LLM...</span>
          )}
          {mutation.isError && (
            <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
