import type { DatasetLabelFrequency, DatasetSchemaResponse } from '../../../api/types';
import LabelChipSelect from '../LabelChipSelect';
import LabelMappingEditor, { type MappingRow } from '../LabelMappingEditor';
type FilterMode = 'none' | 'keep' | 'drop';

interface TransformSchemaTabProps {
  source: string;
  filterMode: FilterMode;
  onFilterModeChange: (m: FilterMode) => void;
  keepLabels: string[];
  onKeepSelectionChange: (next: string[]) => void;
  dropLabels: string[];
  onDropSelectionChange: (next: string[]) => void;
  schema: DatasetSchemaResponse | undefined;
  schemaLoading: boolean;
  schemaLabels: DatasetLabelFrequency[];
  suggestFrequentKeep: () => void;
  mappingRows: MappingRow[];
  onMappingRowsChange: (rows: MappingRow[]) => void;
  blockedForKeep: Set<string>;
  blockedForDrop: Set<string>;
  dropFieldInvalid: boolean;
  dropMappingConflict: string[];
  clientConflicts: string[];
}

export default function TransformSchemaTab({
  source,
  filterMode,
  onFilterModeChange,
  keepLabels,
  onKeepSelectionChange,
  dropLabels,
  onDropSelectionChange,
  schema,
  schemaLoading,
  schemaLabels,
  suggestFrequentKeep,
  mappingRows,
  onMappingRowsChange,
  blockedForKeep,
  blockedForDrop,
  dropFieldInvalid,
  dropMappingConflict,
  clientConflicts,
}: TransformSchemaTabProps) {
  if (!source) {
    return (
      <p className="text-sm text-gray-500">Select a source dataset in the header to configure schema options.</p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <p className="text-xs text-gray-500">
        Use <strong>Target splits</strong> in the header to limit which documents this step (filter + label mapping) applies
        to. Documents outside the selection are left unchanged in the output.
      </p>
      {clientConflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Warnings</p>
          <ul className="list-inside list-disc">
            {clientConflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-gray-100 bg-gray-50/50 p-3">
        <p className="mb-2 text-xs font-medium text-gray-600">Span filter</p>
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {(['none', 'keep', 'drop'] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="filterMode"
                checked={filterMode === m}
                onChange={() => {
                  onFilterModeChange(m);
                  if (m === 'keep') onDropSelectionChange([]);
                  if (m === 'drop') onKeepSelectionChange([]);
                }}
              />
              {m === 'none' ? 'No filter' : m === 'keep' ? 'Keep only' : 'Drop'}
            </label>
          ))}
          {filterMode === 'keep' && schema && schema.labels.length > 0 && (
            <button
              type="button"
              onClick={suggestFrequentKeep}
              className="text-xs text-gray-700 underline decoration-gray-300 hover:text-gray-900"
            >
              Suggest frequent labels (top 8)
            </button>
          )}
        </div>

        {filterMode === 'keep' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Keep labels</label>
            <LabelChipSelect
              idPrefix="keep"
              options={schemaLabels}
              value={keepLabels}
              onChange={onKeepSelectionChange}
              blocked={blockedForKeep}
              disabled={!source || schemaLoading}
              onSelectAll={() => {
                const all = schemaLabels.map((x) => x.label).filter((l) => !blockedForKeep.has(l));
                onKeepSelectionChange(all);
                onDropSelectionChange([]);
              }}
              onClearAll={() => onKeepSelectionChange([])}
            />
          </div>
        )}

        {filterMode === 'drop' && (
          <div className="space-y-1">
            <label
              className={`text-xs font-medium ${dropFieldInvalid ? 'text-red-700' : 'text-gray-600'}`}
            >
              Drop labels
            </label>
            <LabelChipSelect
              idPrefix="drop"
              options={schemaLabels}
              value={dropLabels}
              onChange={onDropSelectionChange}
              blocked={blockedForDrop}
              disabled={!source || schemaLoading}
              onSelectAll={() => {
                const all = schemaLabels.map((x) => x.label).filter((l) => !blockedForDrop.has(l));
                onDropSelectionChange(all);
                onKeepSelectionChange([]);
              }}
              onClearAll={() => onDropSelectionChange([])}
            />
            {dropFieldInvalid && (
              <p className="text-xs text-red-600">
                Remove these from Drop or delete the mapping: {dropMappingConflict.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Label mapping</label>
        <p className="mb-2 text-xs text-gray-500">Map source labels to target schema (applied after filtering).</p>
        <LabelMappingEditor
          schemaLabels={schemaLabels}
          rows={mappingRows}
          onChange={onMappingRowsChange}
          highlightError={dropFieldInvalid}
          disabled={!source}
        />
      </div>
    </div>
  );
}
