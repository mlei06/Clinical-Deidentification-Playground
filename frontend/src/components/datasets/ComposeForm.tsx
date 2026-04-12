import { useState } from 'react';
import { Loader2, Merge } from 'lucide-react';
import { useDatasets, useComposeDatasets } from '../../hooks/useDatasets';

interface ComposeFormProps {
  onCreated: (name: string) => void;
}

export default function ComposeForm({ onCreated }: ComposeFormProps) {
  const { data: datasets } = useDatasets();
  const mutation = useComposeDatasets();

  const [outputName, setOutputName] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<'merge' | 'interleave' | 'proportional'>('merge');
  const [weightsStr, setWeightsStr] = useState('');
  const [targetDocs, setTargetDocs] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [description, setDescription] = useState('');

  const toggleSource = (name: string) => {
    setSources((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  };

  const handleSubmit = () => {
    if (!outputName.trim() || sources.length === 0) return;
    const weights = weightsStr.trim()
      ? weightsStr.split(',').map((w) => parseFloat(w.trim()))
      : undefined;
    const target = targetDocs.trim() ? parseInt(targetDocs.trim(), 10) : undefined;

    mutation.mutate(
      {
        output_name: outputName.trim(),
        source_datasets: sources,
        strategy,
        weights: strategy === 'proportional' ? weights : undefined,
        target_documents: target || undefined,
        shuffle,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (d) => {
          onCreated(d.name);
          setOutputName('');
          setSources([]);
          setDescription('');
          setWeightsStr('');
          setTargetDocs('');
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
        Compose Datasets
      </h4>

      <div className="flex flex-col gap-3">
        {/* Source selection */}
        <div>
          <label className="text-xs font-medium text-gray-500">Source Datasets</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {datasets?.map((d) => (
              <button
                key={d.name}
                onClick={() => toggleSource(d.name)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  sources.includes(d.name)
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                {d.name}
                <span className="ml-1 text-gray-400">({d.document_count})</span>
              </button>
            ))}
            {!datasets?.length && (
              <span className="text-xs text-gray-400">No datasets available</span>
            )}
          </div>
          {sources.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {sources.length} selected
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Output Name</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="composed-corpus"
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as typeof strategy)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            >
              <option value="merge">Merge (concatenate)</option>
              <option value="interleave">Interleave (round-robin)</option>
              <option value="proportional">Proportional (weighted sample)</option>
            </select>
          </div>
          {strategy === 'proportional' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Weights (comma-sep)</label>
              <input
                type="text"
                value={weightsStr}
                onChange={(e) => setWeightsStr(e.target.value)}
                placeholder="0.7, 0.3"
                className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Target Docs</label>
            <input
              type="number"
              value={targetDocs}
              onChange={(e) => setTargetDocs(e.target.value)}
              placeholder="all"
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={shuffle}
              onChange={(e) => setShuffle(e.target.checked)}
              className="rounded border-gray-300"
            />
            Shuffle
          </label>
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
            disabled={!outputName.trim() || sources.length === 0 || mutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Merge size={15} />
            )}
            Compose
          </button>
          {mutation.isError && (
            <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
