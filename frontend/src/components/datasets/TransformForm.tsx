import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { useDatasets, useTransformDataset } from '../../hooks/useDatasets';

interface TransformFormProps {
  sourceDataset?: string;
  onCreated: (name: string) => void;
}

export default function TransformForm({ sourceDataset, onCreated }: TransformFormProps) {
  const { data: datasets } = useDatasets();
  const mutation = useTransformDataset();

  const [source, setSource] = useState(sourceDataset || '');
  const [outputName, setOutputName] = useState('');
  const [keepLabels, setKeepLabels] = useState('');
  const [dropLabels, setDropLabels] = useState('');
  const [labelMapping, setLabelMapping] = useState('');
  const [targetDocs, setTargetDocs] = useState('');
  const [boostLabel, setBoostLabel] = useState('');
  const [boostCopies, setBoostCopies] = useState('');
  const [resplit, setResplit] = useState('');
  const [stripSplits, setStripSplits] = useState(false);
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    if (!source || !outputName.trim()) return;

    const parseCsv = (s: string) => {
      const items = s.split(',').map((x) => x.trim()).filter(Boolean);
      return items.length > 0 ? items : undefined;
    };

    const parseMapping = (s: string): Record<string, string> | undefined => {
      if (!s.trim()) return undefined;
      const pairs = s.split(',').map((x) => x.trim());
      const mapping: Record<string, string> = {};
      for (const pair of pairs) {
        const [from, to] = pair.split(':').map((x) => x.trim());
        if (from && to) mapping[from] = to;
      }
      return Object.keys(mapping).length > 0 ? mapping : undefined;
    };

    const parseSplits = (s: string): Record<string, number> | undefined => {
      if (!s.trim()) return undefined;
      const pairs = s.split(',').map((x) => x.trim());
      const splits: Record<string, number> = {};
      for (const pair of pairs) {
        const [name, val] = pair.split(':').map((x) => x.trim());
        if (name && val) splits[name] = parseFloat(val);
      }
      return Object.keys(splits).length > 0 ? splits : undefined;
    };

    mutation.mutate(
      {
        source_dataset: source,
        output_name: outputName.trim(),
        keep_labels: parseCsv(keepLabels),
        drop_labels: parseCsv(dropLabels),
        label_mapping: parseMapping(labelMapping),
        target_documents: targetDocs.trim() ? parseInt(targetDocs.trim(), 10) : undefined,
        boost_label: boostLabel.trim() || undefined,
        boost_extra_copies: boostCopies.trim() ? parseInt(boostCopies.trim(), 10) : undefined,
        resplit: parseSplits(resplit),
        strip_splits: stripSplits || undefined,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (d) => {
          onCreated(d.name);
          setOutputName('');
          setKeepLabels('');
          setDropLabels('');
          setLabelMapping('');
          setTargetDocs('');
          setBoostLabel('');
          setBoostCopies('');
          setResplit('');
          setStripSplits(false);
          setDescription('');
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
        Transform Dataset
      </h4>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            >
              <option value="">Select dataset...</option>
              {datasets?.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.document_count} docs)
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Output Name</label>
            <input
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder="transformed-corpus"
              className="w-44 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Keep Labels <span className="text-gray-400">(comma-sep)</span>
            </label>
            <input
              type="text"
              value={keepLabels}
              onChange={(e) => setKeepLabels(e.target.value)}
              placeholder="PERSON, DATE"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Drop Labels <span className="text-gray-400">(comma-sep)</span>
            </label>
            <input
              type="text"
              value={dropLabels}
              onChange={(e) => setDropLabels(e.target.value)}
              placeholder="AGE, ZIP_CODE_US"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Label Mapping <span className="text-gray-400">(FROM:TO, ...)</span>
            </label>
            <input
              type="text"
              value={labelMapping}
              onChange={(e) => setLabelMapping(e.target.value)}
              placeholder="DOCTOR:PERSON, HOSPITAL:LOCATION"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Target Documents</label>
            <input
              type="number"
              value={targetDocs}
              onChange={(e) => setTargetDocs(e.target.value)}
              placeholder="keep all"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Boost Label</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={boostLabel}
                onChange={(e) => setBoostLabel(e.target.value)}
                placeholder="SSN"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
              />
              <input
                type="number"
                value={boostCopies}
                onChange={(e) => setBoostCopies(e.target.value)}
                placeholder="copies"
                className="w-20 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">
              Resplit <span className="text-gray-400">(name:weight, ...)</span>
            </label>
            <input
              type="text"
              value={resplit}
              onChange={(e) => setResplit(e.target.value)}
              placeholder="train:0.7, valid:0.15, test:0.15"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={stripSplits}
              onChange={(e) => setStripSplits(e.target.checked)}
              className="rounded border-gray-300"
            />
            Strip splits
          </label>
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={!source || !outputName.trim() || mutation.isPending}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Wand2 size={15} />
            )}
            Transform
          </button>
          {mutation.isError && (
            <span className="text-xs text-red-600">{(mutation.error as Error).message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
