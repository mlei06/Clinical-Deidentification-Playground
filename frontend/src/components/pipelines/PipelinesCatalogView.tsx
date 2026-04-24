import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Loader2, Network, RefreshCw } from 'lucide-react';
import { validatePipeline } from '../../api/pipelines';
import type { PipelineDetail, PipeStep } from '../../api/types';
import { usePipelines } from '../../hooks/usePipelines';
import { useHealth } from '../../hooks/useHealth';
import { ApiError } from '../../api/client';

function pipeStepHint(step: PipeStep): string {
  const c = step.config;
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown>;
  for (const k of [
    'pattern_pack',
    'model',
    'pipeline',
    'source_name',
    'spacy_model',
    'ner_model',
    'strategy',
  ]) {
    if (o[k] != null && o[k] !== '') {
      return `${k}: ${String(o[k])}`;
    }
  }
  const first = Object.keys(o)[0];
  return first ? `${first}: …` : '';
}

export default function PipelinesCatalogView() {
  const { data: health } = useHealth();
  const { data: pipelines, isLoading, isError, error } = usePipelines();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [liveLabels, setLiveLabels] = useState<
    Record<string, { labels: string[]; at?: string; error?: string }>
  >({});

  const names = useMemo(() => (pipelines ?? []).map((p) => p.name), [pipelines]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return names;
    return names.filter((n) => n.toLowerCase().includes(q));
  }, [filter, names]);

  useEffect(() => {
    if (!pipelines?.length) {
      return;
    }
    if (selected && filtered.includes(selected)) {
      return;
    }
    setSelected(filtered[0] ?? null);
  }, [pipelines, filtered, selected]);

  const detail: PipelineDetail | undefined = useMemo(
    () => (pipelines ?? []).find((p) => p.name === selected),
    [pipelines, selected],
  );

  const validateMut = useMutation({
    mutationFn: async (name: string) => {
      const r = await validatePipeline(name);
      if (!r.valid) {
        throw new Error(r.error || 'validate failed');
      }
      return { name, r };
    },
    onSuccess: ({ name, r }) => {
      setLiveLabels((prev) => ({
        ...prev,
        [name]: {
          labels: r.output_label_space ?? [],
          at: r.output_label_space_updated_at ?? undefined,
        },
      }));
    },
    onError: (e: Error, name: string) => {
      setLiveLabels((prev) => ({
        ...prev,
        [name]: { labels: [], error: e instanceof Error ? e.message : 'error' },
      }));
    },
  });

  const outputSpaceFor = (p: PipelineDetail) => {
    const live = liveLabels[p.name];
    if (live?.error) return { kind: 'error' as const, message: live.error };
    if (live?.labels?.length) {
      return { kind: 'labels' as const, labels: live.labels, at: live.at };
    }
    const cached = p.config.output_label_space;
    if (cached?.length) {
      return { kind: 'labels' as const, labels: cached, at: p.config.output_label_space_updated_at };
    }
    return { kind: 'missing' as const };
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-gray-900">Pipelines</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Saved pipeline configs under <code className="rounded bg-gray-100 px-1">data/pipelines</code>
              : composition, optional description, and the{' '}
              <strong>symbolic output label space</strong> (after remaps / label mapping / filters).{' '}
              {health && (
                <span className="text-gray-500">
                  Server <strong>label space</strong> (for <code className="text-xs">POST /process</code>{' '}
                  normalization):{' '}
                  <code className="rounded bg-violet-50 px-1 text-violet-900">{health.label_space_name}</code>
                </span>
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-full max-w-xs shrink-0 border-r border-gray-200 bg-white p-4">
          <label className="text-xs font-medium text-gray-500" htmlFor="pl-filter">
            Filter by name
          </label>
          <input
            id="pl-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. clinical"
            className="mb-3 mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </div>
          )}
          {isError && (
            <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              <AlertCircle size={16} className="shrink-0" />
              {error instanceof ApiError ? error.detail : 'Failed to load pipelines'}
            </div>
          )}
          {!isLoading && !filtered.length && (
            <p className="text-sm text-gray-500">
              No matching pipelines. Create one in <strong>Create</strong> or clear the filter.
            </p>
          )}
          <ul className="max-h-[calc(100vh-12rem)] space-y-0.5 overflow-y-auto pr-1">
            {filtered.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setSelected(name)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    selected === name
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
          {!detail && !isLoading && (
            <p className="text-sm text-gray-500">Select a pipeline to inspect.</p>
          )}
          {detail && (
            <div className="max-w-4xl space-y-6">
              <div className="flex items-center gap-2">
                <Network size={22} className="text-gray-400" />
                <h2 className="text-xl font-semibold text-gray-900">{detail.name}</h2>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Description</h3>
                <p className="mt-1 text-sm text-gray-800">
                  {typeof detail.config.description === 'string' && detail.config.description.trim()
                    ? detail.config.description
                    : '— (set in the pipeline JSON or the Create flow)'}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Composition</h3>
                <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Pipe type</th>
                        <th className="px-3 py-2 font-medium">Config hint</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.config.pipes ?? []).map((step, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-900">{step.type}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{pipeStepHint(step) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!(detail.config.pipes?.length) && (
                  <p className="mt-2 text-sm text-amber-800">This pipeline has no <code>pipes</code> array.</p>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Final output label space
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  Labels emitted at the end of the pipeline (after <code>label_mapper</code> / filters when
                  applicable). Shown as sorted unique strings. Cached in the JSON when the pipeline is saved via
                  the API; otherwise use compute.
                </p>
                {(() => {
                  const o = outputSpaceFor(detail);
                  if (o.kind === 'error') {
                    return (
                      <p className="mt-2 text-sm text-red-700" role="alert">
                        {o.message}
                      </p>
                    );
                  }
                  if (o.kind === 'labels' && o.labels.length) {
                    return (
                      <div className="mt-2">
                        <div className="flex flex-wrap gap-1.5">
                          {o.labels.map((lab) => (
                            <span
                              key={lab}
                              className="inline-flex rounded bg-violet-50 px-2 py-0.5 font-mono text-xs text-violet-900"
                            >
                              {lab}
                            </span>
                          ))}
                        </div>
                        {o.at && (
                          <p className="mt-2 text-xs text-gray-400">Updated {o.at}</p>
                        )}
                      </div>
                    );
                  }
                  return (
                    <p className="mt-2 text-sm text-gray-500">
                      Not cached. Compute loads the built pipeline and evaluates effective output labels.
                    </p>
                  );
                })()}
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={validateMut.isPending}
                    onClick={() => {
                      setLiveLabels((prev) => {
                        const next = { ...prev };
                        delete next[detail.name];
                        return next;
                      });
                      validateMut.mutate(detail.name);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {validateMut.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Compute / refresh output labels
                  </button>
                </div>
              </div>

              <details className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-600">Raw config (JSON)</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded border border-gray-200 bg-white p-3 font-mono text-xs text-gray-800">
                  {JSON.stringify(detail.config, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
