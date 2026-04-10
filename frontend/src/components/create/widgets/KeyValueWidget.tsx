import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { FieldProps } from '@rjsf/utils';

/**
 * Key-value map editor for dict[str, str | None] fields.
 * Registered as an rjsf custom **field** (not widget) because
 * `ui:widget` is ignored on `type: "object"` schemas.
 */
export default function KeyValueField(props: FieldProps) {
  const { formData, onChange, schema, name, fieldPathId } = props;
  const data: Record<string, string | null> = formData ?? {};
  const entries: [string, string | null][] = Object.entries(data);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const allowNullValues =
    schema.additionalProperties &&
    typeof schema.additionalProperties === 'object' &&
    'anyOf' in (schema.additionalProperties as Record<string, unknown>);

  const update = (updated: Record<string, string | null>) => {
    onChange(Object.keys(updated).length > 0 ? updated : undefined, fieldPathId.path);
  };

  const addEntry = () => {
    const k = newKey.trim();
    if (!k) return;
    update({ ...data, [k]: newVal || null });
    setNewKey('');
    setNewVal('');
  };

  const removeEntry = (key: string) => {
    const copy = { ...data };
    delete copy[key];
    update(copy);
  };

  const updateKey = (oldKey: string, newKeyName: string) => {
    const copy: Record<string, string | null> = {};
    for (const [k, v] of entries) {
      copy[k === oldKey ? newKeyName : k] = v;
    }
    update(copy);
  };

  const updateValue = (key: string, val: string) => {
    update({ ...data, [key]: val || (allowNullValues ? null : '') });
  };

  const title = (schema as Record<string, unknown>).title as string | undefined;
  const help = (schema as Record<string, unknown>).ui_help as string | undefined;
  const description = schema.description as string | undefined;

  return (
    <div className="mb-3 space-y-2">
      {(title || name) && (
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {title || name}
        </label>
      )}
      {description && (
        <p className="text-xs text-gray-400">{description}</p>
      )}

      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                className="w-1/3 rounded border border-gray-300 px-2 py-1 text-sm"
                value={k}
                onChange={(e) => updateKey(k, e.target.value)}
                placeholder="Label"
              />
              <span className="text-xs text-gray-400">&rarr;</span>
              <input
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                value={v ?? ''}
                onChange={(e) => updateValue(k, e.target.value)}
                placeholder={allowNullValues ? '(null = drop)' : 'Value'}
              />
              <button
                type="button"
                onClick={() => removeEntry(k)}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          className="w-1/3 rounded border border-gray-300 px-2 py-1 text-sm"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="New key"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEntry())}
        />
        <span className="text-xs text-gray-400">&rarr;</span>
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="New value"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEntry())}
        />
        <button
          type="button"
          onClick={addEntry}
          className="rounded p-1 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
        >
          <Plus size={14} />
        </button>
      </div>

      {help && (
        <p className="text-xs text-gray-400">{help}</p>
      )}
    </div>
  );
}
