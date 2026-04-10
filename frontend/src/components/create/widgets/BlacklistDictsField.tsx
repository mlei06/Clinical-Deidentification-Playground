import {
  Plus,
  X,
  Loader2,
  FileText,
  Upload,
} from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import type { FieldProps } from '@rjsf/utils';
import { uploadDictionary, listDictionaries } from '../../../api/dictionaries';
import type { DictionaryInfo } from '../../../api/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface DictConfig {
  disabled_dictionaries: string[];
  terms: string[];
}

const DEFAULT: DictConfig = {
  disabled_dictionaries: [],
  terms: [],
};

interface DictInfo {
  name: string;
  filename: string;
  term_count: number;
}

/**
 * Combined dictionaries + inline terms field for the blacklist pipe.
 *
 * Dictionaries are checked by default (all active). Unchecking adds to
 * disabled_dictionaries. Inline terms are tag-style add/remove.
 *
 * Bound to ``dict_config: BlacklistDictConfig``.
 */
export default function BlacklistDictsField(props: FieldProps) {
  const { formData, onChange, schema, fieldPathId } = props;
  const config: DictConfig = { ...DEFAULT, ...formData };

  const schemaAny = schema as Record<string, unknown>;
  const builtinDicts: DictInfo[] =
    (schemaAny.ui_blacklist_dicts as DictInfo[]) || [];

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [newTerm, setNewTerm] = useState('');

  const { data: liveDicts = [] } = useQuery({
    queryKey: ['dictionaries', 'blacklist'],
    queryFn: () => listDictionaries('blacklist'),
  });

  const allDicts: DictionaryInfo[] = liveDicts.length > 0
    ? liveDicts
    : builtinDicts.map((d) => ({
        kind: 'blacklist' as const,
        label: null,
        name: d.name,
        filename: d.filename,
        term_count: d.term_count,
      }));

  const disabled = new Set(config.disabled_dictionaries);
  const activeDicts = allDicts.length - disabled.size;

  const emit = useCallback(
    (next: DictConfig) => {
      const cleaned: Partial<DictConfig> = {};
      if (next.disabled_dictionaries.length > 0)
        cleaned.disabled_dictionaries = next.disabled_dictionaries;
      if (next.terms.length > 0) cleaned.terms = next.terms;
      onChange(
        Object.keys(cleaned).length > 0 ? cleaned : undefined,
        fieldPathId.path,
      );
    },
    [onChange, fieldPathId],
  );

  const toggleDict = (name: string) => {
    const next = disabled.has(name)
      ? config.disabled_dictionaries.filter((n) => n !== name)
      : [...config.disabled_dictionaries, name];
    emit({ ...config, disabled_dictionaries: next });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const stem = file.name.replace(/\.[^.]+$/, '');
      await uploadDictionary(file, 'blacklist', stem);
      queryClient.invalidateQueries({ queryKey: ['dictionaries'] });
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addTerm = () => {
    const trimmed = newTerm.trim();
    if (!trimmed || config.terms.includes(trimmed)) return;
    emit({ ...config, terms: [...config.terms, trimmed] });
    setNewTerm('');
  };

  const removeTerm = (term: string) => {
    emit({ ...config, terms: config.terms.filter((t) => t !== term) });
  };

  const title = schemaAny.title as string | undefined;
  const description = schema.description as string | undefined;

  return (
    <div className="mb-3 space-y-3">
      {title && (
        <label className="block text-xs font-medium text-gray-600">
          {title}
        </label>
      )}
      {description && (
        <p className="text-xs text-gray-400">{description}</p>
      )}

      {/* Dictionaries section */}
      <div className="rounded-md border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="text-[10px] font-medium text-gray-500">
            Dictionaries
            {allDicts.length > 0 && (
              <span className="ml-1 font-normal text-gray-400">
                {activeDicts}/{allDicts.length} active
              </span>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50">
            {uploading ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Upload size={10} />
            )}
            Upload
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.json"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
        </div>

        {uploadError && (
          <div className="mx-2 mb-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-600">
            {uploadError}
          </div>
        )}

        {allDicts.length === 0 ? (
          <div className="border-t border-gray-100 px-2 py-3 text-center text-[10px] text-gray-400">
            No dictionaries found. Upload one above.
          </div>
        ) : (
          <div className="space-y-0.5 border-t border-gray-100 px-1.5 py-1.5">
            {allDicts.map((d) => {
              const isEnabled = !disabled.has(d.name);
              return (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => toggleDict(d.name)}
                  className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${
                    isEnabled
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <div
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[8px] ${
                      isEnabled
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300'
                    }`}
                  >
                    {isEnabled && '\u2713'}
                  </div>
                  <FileText size={10} className={`shrink-0 ${isEnabled ? 'text-blue-400' : 'text-gray-300'}`} />
                  <span className={`min-w-0 flex-1 truncate text-[11px] ${isEnabled ? '' : 'line-through'}`}>
                    {d.name}
                  </span>
                  <span className={`shrink-0 text-[10px] ${isEnabled ? 'text-blue-400' : 'text-gray-300'}`}>
                    {d.term_count.toLocaleString()} terms
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline terms section */}
      <div className="rounded-md border border-gray-200 bg-white px-2 py-2">
        <div className="mb-1.5 text-[10px] font-medium text-gray-500">
          Inline Safe Terms
          {config.terms.length > 0 && (
            <span className="ml-1 font-normal text-gray-400">
              ({config.terms.length})
            </span>
          )}
        </div>

        {config.terms.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {config.terms.map((term) => (
              <span
                key={term}
                className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700"
              >
                {term}
                <button
                  type="button"
                  onClick={() => removeTerm(term)}
                  className="rounded-full p-0.5 hover:bg-gray-200"
                >
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1">
          <input
            type="text"
            className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Add safe term..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTerm();
              }
            }}
          />
          <button
            type="button"
            onClick={addTerm}
            className="rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
