import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import type { WidgetProps } from '@rjsf/utils';
import { listDictionaries, getDictionaryPreview } from '../../../api/dictionaries';
import type { DictionaryInfo } from '../../../api/types';
import { usePipeFormContextConfig } from '../../../hooks/usePipeFormContextConfig';
import type { SchemaFormContext } from '../schemaFormContext';

/**
 * Custom rjsf widget that replaces the generic tag-list for dictionary fields.
 * Shows available dictionaries with term counts and preview-on-hover.
 *
 * Infers kind (whitelist/blacklist) and label from the form context:
 * - pipeType containing "whitelist" => kind=whitelist, uses label from parent key
 * - pipeType containing "blacklist" => kind=blacklist
 */
export default function DictionaryPickerWidget(props: WidgetProps) {
  const { value, onChange, formContext, label } = props;
  const fieldLabel = typeof label === 'string' ? label : undefined;
  const selected: string[] = Array.isArray(value) ? value : [];
  const [open, setOpen] = useState(false);
  const [hoveredDict, setHoveredDict] = useState<string | null>(null);

  // Infer kind from pipeType
  const pipeType: string = (formContext as Record<string, unknown>)?.pipeType as string ?? '';
  const kind: 'whitelist' | 'blacklist' = pipeType.includes('blacklist') ? 'blacklist' : 'whitelist';

  // For whitelist, try to infer the label from the config context
  // The dictionaries field lives inside per_label[LABEL].dictionaries
  // We look at the config object's per_label keys
  const config = usePipeFormContextConfig(formContext as SchemaFormContext | undefined);
  const inferredLabel = useMemo(() => {
    if (kind !== 'whitelist' || !config?.per_label) return undefined;
    const perLabel = config.per_label as Record<string, unknown>;
    // Find which label this field belongs to by checking which has our current value
    for (const [lbl, cfg] of Object.entries(perLabel)) {
      const labelCfg = cfg as Record<string, unknown>;
      if (labelCfg?.dictionaries === value) return lbl;
    }
    // Fallback: return first label
    const keys = Object.keys(perLabel);
    return keys.length > 0 ? keys[0] : undefined;
  }, [kind, config, value]);

  const { data: dicts = [], isLoading } = useQuery({
    queryKey: ['dictionaries', kind, inferredLabel],
    queryFn: () => listDictionaries(kind, inferredLabel ?? undefined),
  });

  const { data: preview } = useQuery({
    queryKey: ['dictionary-preview', kind, hoveredDict, inferredLabel],
    queryFn: () => getDictionaryPreview(kind, hoveredDict!, inferredLabel ?? undefined),
    enabled: !!hoveredDict,
  });

  const toggle = (name: string) => {
    const next = selected.includes(name)
      ? selected.filter((n) => n !== name)
      : [...selected, name];
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div className="space-y-2">
      {fieldLabel && (
        <label className="mb-1 block text-xs font-medium text-gray-600">{fieldLabel}</label>
      )}

      {/* Selected badges */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name) => {
            const info = dicts.find((d) => d.name === name);
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
              >
                {name}
                {info && (
                  <span className="text-blue-400">({info.term_count})</span>
                )}
                <button
                  type="button"
                  onClick={() => toggle(name)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100"
                >
                  &times;
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between rounded border border-gray-300 px-3 py-1.5 text-left text-sm text-gray-700 hover:border-gray-400"
        >
          <span className="text-gray-400">
            {isLoading ? 'Loading...' : `${dicts.length} available`}
          </span>
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown list */}
        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
            <div className="max-h-48 overflow-y-auto py-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-gray-400" />
                </div>
              ) : dicts.length === 0 ? (
                <div className="px-3 py-3 text-center text-xs text-gray-400">
                  No dictionaries available
                </div>
              ) : (
                dicts.map((d) => (
                  <DictOption
                    key={d.name}
                    dict={d}
                    isSelected={selected.includes(d.name)}
                    onToggle={() => toggle(d.name)}
                    onHover={() => setHoveredDict(d.name)}
                    onLeave={() => setHoveredDict(null)}
                    preview={hoveredDict === d.name ? preview : undefined}
                  />
                ))
              )}
            </div>

            <div className="border-t border-gray-100 px-3 py-2">
              <a
                href="/dictionaries"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
              >
                Manage Dictionaries <ExternalLink size={10} />
              </a>
            </div>
          </div>
        )}
      </div>

      {typeof (props.schema as Record<string, unknown>).ui_help === 'string' && (
        <p className="text-xs text-gray-400">
          {(props.schema as Record<string, string>).ui_help}
        </p>
      )}
    </div>
  );
}

function DictOption({
  dict,
  isSelected,
  onToggle,
  onHover,
  onLeave,
  preview,
}: {
  dict: DictionaryInfo;
  isSelected: boolean;
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
  preview?: { sample_terms: string[]; term_count: number } | null;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
          isSelected ? 'bg-blue-50' : ''
        }`}
      >
        <div
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'
          }`}
        >
          {isSelected && <Check size={10} />}
        </div>
        <span className="min-w-0 flex-1 truncate">{dict.name}</span>
        <span className="shrink-0 text-xs text-gray-400">{dict.term_count}</span>
      </button>

      {/* Preview tooltip */}
      {preview && preview.sample_terms.length > 0 && (
        <div className="absolute left-full top-0 z-30 ml-2 w-56 rounded-md border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-1.5 text-xs font-medium text-gray-500">
            {preview.term_count} terms — sample:
          </div>
          <div className="flex flex-wrap gap-1">
            {preview.sample_terms.slice(0, 10).map((t) => (
              <span
                key={t}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
              >
                {t}
              </span>
            ))}
            {preview.term_count > 10 && (
              <span className="text-xs text-gray-400">+{preview.term_count - 10} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
