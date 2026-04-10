import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { WidgetProps } from '@rjsf/utils';

/**
 * Tag-list editor for `list[str]` fields.
 * Renders as an ordered list of removable, reorderable tags with an add-new input row.
 */
export default function TagListWidget(props: WidgetProps) {
  const { value, onChange, label, schema } = props;
  const tags: string[] = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
    setDraft('');
  };

  const remove = (idx: number) => {
    const next = tags.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : undefined);
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...tags];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= tags.length - 1) return;
    const next = [...tags];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {label}
        </label>
      )}

      {tags.length > 0 && (
        <div className="flex flex-col gap-1">
          {tags.map((tag, idx) => (
            <div
              key={tag}
              className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
            >
              <span className="mr-1 min-w-5 text-center font-mono text-[10px] text-gray-400">
                {idx + 1}
              </span>
              <span className="flex-1 font-medium text-gray-700">{tag}</span>
              <button
                type="button"
                onClick={() => moveUp(idx)}
                disabled={idx === 0}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-25 disabled:hover:bg-transparent"
                title="Move up (higher priority)"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => moveDown(idx)}
                disabled={idx === tags.length - 1}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-25 disabled:hover:bg-transparent"
                title="Move down (lower priority)"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="rounded p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add label..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="rounded p-1 text-gray-500 hover:bg-blue-50 hover:text-blue-600"
        >
          <Plus size={14} />
        </button>
      </div>

      {schema.ui_help && (
        <p className="text-xs text-gray-400">{String(schema.ui_help)}</p>
      )}
    </div>
  );
}
