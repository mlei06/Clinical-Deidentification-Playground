import { Plus, X, ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { FieldProps } from '@rjsf/utils';
import { labelColor } from '../../../lib/labelColors';
import { useLabelSpace } from '../../../hooks/useLabelSpace';
import CanonicalLabelSelect from './CanonicalLabelSelect';

/**
 * Label-space-aware editor for ``label_mapping: dict[str, str | None]``.
 *
 * Shows every known label for the detector with a toggle (on/off) and an
 * optional remap text field.  Extra labels are only offered when the schema sets
 * ``ui_allow_custom_labels: true`` (not used for output label mapping).
 *
 * Reads ``pipeType``, ``baseLabels``, and ``config`` from rjsf ``formContext``.
 */
export default function LabelSpaceField(props: FieldProps) {
  const { formData, onChange, schema, formContext, fieldPathId } = props;
  const mapping: Record<string, string | null> = formData ?? {};

  const schemaAny = schema as Record<string, unknown>;
  const pipeType: string =
    (schemaAny.ui_pipe_type as string) || formContext?.pipeType || '';
  const baseLabels: string[] =
    (schemaAny.ui_base_labels as string[]) || formContext?.baseLabels || [];
  const config: Record<string, unknown> = formContext?.config ?? {};

  const { labels: allLabels, isLoading } = useLabelSpace(
    pipeType,
    config,
    baseLabels,
    mapping,
  );

  const [newLabel, setNewLabel] = useState('');

  const isEnabled = (label: string) => mapping[label] !== null;

  const remapValue = (label: string): string => {
    const v = mapping[label];
    if (v === undefined || v === null) return '';
    return v;
  };

  const update = (next: Record<string, string | null>) => {
    const cleaned: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(next)) {
      if (v === null || (typeof v === 'string' && v !== '')) {
        cleaned[k] = v;
      }
    }
    onChange(Object.keys(cleaned).length > 0 ? cleaned : undefined, fieldPathId.path);
  };

  const toggleLabel = (label: string) => {
    const next = { ...mapping };
    if (mapping[label] === null) {
      delete next[label];
    } else {
      next[label] = null;
    }
    update(next);
  };

  const setRemap = (label: string, value: string) => {
    const next = { ...mapping };
    if (value === '') {
      delete next[label];
    } else {
      next[label] = value;
    }
    update(next);
  };

  const addCustomLabel = () => {
    const trimmed = newLabel.trim().toUpperCase();
    if (!trimmed || allLabels.includes(trimmed)) return;
    update({ ...mapping });
    setNewLabel('');
  };

  const removeCustomLabel = (label: string) => {
    const next = { ...mapping };
    delete next[label];
    update(next);
  };

  const title =
    (schema as Record<string, unknown>).title as string | undefined;
  const help =
    (schema as Record<string, unknown>).ui_help as string | undefined;

  /** Only regex_ner / whitelist-style label editors need this; label *mapping* does not. */
  const allowCustom = schemaAny.ui_allow_custom_labels === true;

  const customLabels = Object.keys(mapping).filter(
    (k) => !allLabels.includes(k),
  );
  const displayLabels = [...allLabels, ...customLabels.sort()];

  return (
    <div className="mb-3 space-y-2">
      {title && (
        <div className="flex items-center gap-2">
          <label className="block text-xs font-medium text-gray-600">
            {title}
          </label>
          {isLoading && (
            <Loader2 size={12} className="animate-spin text-gray-400" />
          )}
        </div>
      )}

      {displayLabels.length > 0 && (
        <div className="space-y-1">
          {displayLabels.map((label) => {
            const enabled = isEnabled(label);
            const remap = remapValue(label);
            const isCustom = !allLabels.includes(label);
            const color = labelColor(label);

            return (
              <div
                key={label}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                  enabled
                    ? 'border-gray-200 bg-white'
                    : 'border-gray-100 bg-gray-50'
                }`}
              >
                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => toggleLabel(label)}
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                    enabled ? 'bg-blue-500' : 'bg-gray-300'
                  }`}
                  title={enabled ? 'Disable this label' : 'Enable this label'}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      enabled ? 'left-3.5' : 'left-0.5'
                    }`}
                  />
                </button>

                {/* Label badge */}
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                    enabled ? '' : 'opacity-40'
                  }`}
                  style={{
                    backgroundColor: color.bg,
                    color: color.text,
                    border: `1px solid ${color.border}`,
                  }}
                >
                  {label}
                </span>

                {/* Remap to canonical label */}
                {enabled && (
                  <>
                    <ArrowRight
                      size={12}
                      className="shrink-0 text-gray-300"
                    />
                    <CanonicalLabelSelect
                      value={remap}
                      onChange={(v) => setRemap(label, v)}
                      exclude={label}
                    />
                  </>
                )}

                {/* Remove button for custom labels */}
                {isCustom && (
                  <button
                    type="button"
                    onClick={() => removeCustomLabel(label)}
                    className="ml-auto rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="Remove custom label"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {displayLabels.length === 0 && !isLoading && (
        <p className="text-xs text-gray-400">
          No labels detected for this pipe.
        </p>
      )}

      {/* Add custom label */}
      {allowCustom && (
        <div className="flex items-center gap-1.5">
          <input
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Add custom label..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustomLabel();
              }
            }}
          />
          <button
            type="button"
            onClick={addCustomLabel}
            className="rounded p-1 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      {help && <p className="text-xs text-gray-400">{help}</p>}
    </div>
  );
}
