import type { DatasetSchemaResponse, DatasetSummary } from '../../../api/types';
import TargetSplitsMultiSelect, { type TargetSplitOption } from './TargetSplitsMultiSelect';

export type TransformDestinationMode = 'in_place' | 'new';

interface TransformFormHeaderProps {
  datasets: DatasetSummary[] | undefined;
  source: string;
  onSourceChange: (value: string) => void;
  targetSplitOptions: TargetSplitOption[];
  targetSplits: string[];
  onTargetSplitsChange: (v: string[]) => void;
  detailLoading: boolean;
  destinationMode: TransformDestinationMode;
  onDestinationModeChange: (m: TransformDestinationMode) => void;
  outputName: string;
  onOutputNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  schemaLoading: boolean;
  schema: DatasetSchemaResponse | undefined;
}

export default function TransformFormHeader({
  datasets,
  source,
  onSourceChange,
  targetSplitOptions,
  targetSplits,
  onTargetSplitsChange,
  detailLoading,
  destinationMode,
  onDestinationModeChange,
  outputName,
  onOutputNameChange,
  description,
  onDescriptionChange,
  schemaLoading,
  schema,
}: TransformFormHeaderProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 border-b border-gray-100 pb-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-end lg:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Source dataset</label>
          <select
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          >
            <option value="">Select dataset…</option>
            {datasets?.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name} ({d.document_count.toLocaleString()} docs)
              </option>
            ))}
          </select>
        </div>
        {source ? (
          <div className="min-w-0">
            <TargetSplitsMultiSelect
              options={targetSplitOptions}
              value={targetSplits}
              onChange={onTargetSplitsChange}
              disabled={!source}
              loading={!!source && detailLoading}
              id="transform-header-target-splits"
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Result</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
              <input
                type="radio"
                name="transform-destination"
                checked={destinationMode === 'in_place'}
                onChange={() => onDestinationModeChange('in_place')}
                className="border-gray-300"
              />
              <span>Update source in place</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
              <input
                type="radio"
                name="transform-destination"
                checked={destinationMode === 'new'}
                onChange={() => onDestinationModeChange('new')}
                className="border-gray-300"
              />
              <span>Create new dataset</span>
            </label>
            {destinationMode === 'new' && (
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
                <span className="text-xs text-gray-500">New dataset name</span>
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => onOutputNameChange(e.target.value)}
                  placeholder="e.g. my-corpus-v2"
                  className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
                />
              </div>
            )}
          </div>
          {destinationMode === 'in_place' && source && (
            <p className="mt-2 text-xs text-amber-800/90">Overwrites the corpus and manifest for <strong>{source}</strong>.</p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={
              destinationMode === 'in_place'
                ? 'Override dataset description, or leave blank to keep the current one'
                : 'Notes for the new dataset'
            }
            className="w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
          />
        </div>
        {source ? (
          <p className="text-xs text-gray-500">
            {schemaLoading
              ? 'Loading label schema…'
              : schema
                ? `${schema.labels.length} unique labels, ${schema.total_spans.toLocaleString()} spans`
                : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
