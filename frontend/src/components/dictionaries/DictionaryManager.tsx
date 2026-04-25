import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, BookOpen, FileText, Loader2 } from 'lucide-react';
import { listDictionaries, getDictionaryPreview, deleteDictionary } from '../../api/dictionaries';
import type { DictionaryInfo } from '../../api/types';
import DictionaryUploadDialog from './DictionaryUploadDialog';
import DictionaryTermBrowser from './DictionaryTermBrowser';

type DictKey = string; // "kind:label:name"

function dictKey(d: { kind: string; label: string | null; name: string }): DictKey {
  return `${d.kind}:${d.label ?? ''}:${d.name}`;
}

interface GroupedDicts {
  whitelist: DictionaryInfo[];
  blacklist: DictionaryInfo[];
}

function groupDicts(dicts: DictionaryInfo[]): GroupedDicts {
  const whitelist: DictionaryInfo[] = [];
  const blacklist: DictionaryInfo[] = [];
  for (const d of dicts) {
    if (d.kind === 'whitelist') {
      whitelist.push(d);
    } else if (d.kind === 'blacklist') {
      blacklist.push(d);
    }
  }
  whitelist.sort((a, b) => a.name.localeCompare(b.name));
  blacklist.sort((a, b) => a.name.localeCompare(b.name));
  return { whitelist, blacklist };
}

export default function DictionaryManager() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<DictKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: dicts = [], isLoading } = useQuery({
    queryKey: ['dictionaries'],
    queryFn: () => listDictionaries(),
  });

  const grouped = useMemo(() => groupDicts(dicts), [dicts]);

  const selected = useMemo(
    () => (selectedKey ? dicts.find((d) => dictKey(d) === selectedKey) ?? null : null),
    [dicts, selectedKey],
  );

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['dictionary-preview', selected?.kind, selected?.name, selected?.label],
    queryFn: () =>
      getDictionaryPreview(selected!.kind, selected!.name, selected!.label ?? undefined),
    enabled: !!selected,
  });

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await deleteDictionary(selected.kind, selected.name, selected.label ?? undefined);
      setSelectedKey(null);
      queryClient.invalidateQueries({ queryKey: ['dictionaries'] });
    } finally {
      setDeleting(false);
    }
  };

  const handleUploaded = () => {
    queryClient.invalidateQueries({ queryKey: ['dictionaries'] });
  };

  const renderDictItem = (d: DictionaryInfo) => {
    const key = dictKey(d);
    const isSelected = key === selectedKey;
    return (
      <button
        key={key}
        onClick={() => setSelectedKey(key)}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
          isSelected ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <FileText size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{d.name}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {d.term_count}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white">
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">Dictionaries</span>
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            <Plus size={12} />
            Upload
          </button>
        </div>

        {/* Dict list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : dicts.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              No dictionaries yet. Upload one to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Whitelist section */}
              {grouped.whitelist.length > 0 && (
                <div>
                  <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Whitelist
                  </div>
                  <div className="space-y-0.5">{grouped.whitelist.map(renderDictItem)}</div>
                </div>
              )}

              {/* Blacklist section */}
              {grouped.blacklist.length > 0 && (
                <div>
                  <div className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Blacklist
                  </div>
                  <div className="space-y-0.5">{grouped.blacklist.map(renderDictItem)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            <BookOpen size={40} className="mb-3" />
            <p className="text-sm">Select a dictionary to view its terms</p>
            <p className="mt-1 text-xs">or upload a new one</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      selected.kind === 'whitelist'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {selected.kind}
                  </span>
                  {selected.label && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                      {selected.label}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Delete
              </button>
            </div>

            {/* Stats */}
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 size={14} className="animate-spin" /> Loading preview...
              </div>
            ) : preview ? (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Terms" value={String(preview.term_count)} />
                <Stat label="File" value={selected.filename} />
                <Stat label="Size" value={formatBytes(preview.file_size_bytes)} />
              </div>
            ) : null}

            {/* Sample terms */}
            {preview && preview.sample_terms.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Sample Terms
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {preview.sample_terms.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-white px-2.5 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Full term browser */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                All Terms
              </h3>
              <DictionaryTermBrowser
                kind={selected.kind}
                name={selected.name}
                label={selected.label ?? undefined}
              />
            </div>
          </div>
        )}
      </div>

      <DictionaryUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
