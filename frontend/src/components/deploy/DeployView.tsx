import { useState, useEffect } from 'react';
import { Loader2, Plus, Trash2, Save, Shield, Rocket, Globe } from 'lucide-react';
import { clsx } from 'clsx';
import { useDeployConfig, useDeployablePipelines, useUpdateDeployConfig } from '../../hooks/useDeploy';
import type { DeployConfig, ModeEntry } from '../../api/types';

interface ModeFormEntry {
  pipeline: string;
  description: string;
}

export default function DeployView() {
  const { data: config, isLoading } = useDeployConfig();
  const { data: allPipelines = [] } = useDeployablePipelines();
  const updateConfig = useUpdateDeployConfig();

  const [modes, setModes] = useState<Record<string, ModeFormEntry>>({});
  const [defaultMode, setDefaultMode] = useState<string | null>(null);
  const [allowedPipelines, setAllowedPipelines] = useState<string[] | null>(null);
  const [productionApiUrl, setProductionApiUrl] = useState<string>('');
  const [newModeName, setNewModeName] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setModes(config.modes);
      setDefaultMode(config.default_mode);
      setAllowedPipelines(config.allowed_pipelines);
      setProductionApiUrl(config.production_api_url ?? '');
      setDirty(false);
    }
  }, [config]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  const markDirty = () => setDirty(true);

  const handleSave = () => {
    const payload: DeployConfig = {
      modes,
      default_mode: defaultMode,
      allowed_pipelines: allowedPipelines,
      production_api_url: productionApiUrl.trim() || null,
    };
    updateConfig.mutate(payload, { onSuccess: () => setDirty(false) });
  };

  const addMode = () => {
    const name = newModeName.trim().toLowerCase();
    if (!name || modes[name]) return;
    setModes({ ...modes, [name]: { pipeline: allPipelines[0] ?? '', description: '' } });
    setNewModeName('');
    markDirty();
  };

  const removeMode = (name: string) => {
    const next = { ...modes };
    delete next[name];
    if (defaultMode === name) setDefaultMode(null);
    setModes(next);
    markDirty();
  };

  const updateMode = (name: string, field: keyof ModeFormEntry, value: string) => {
    setModes({ ...modes, [name]: { ...modes[name], [field]: value } });
    markDirty();
  };

  const toggleAllowlist = () => {
    if (allowedPipelines === null) {
      setAllowedPipelines(allPipelines.slice());
    } else {
      setAllowedPipelines(null);
    }
    markDirty();
  };

  const togglePipelineAllowed = (name: string) => {
    if (allowedPipelines === null) return;
    if (allowedPipelines.includes(name)) {
      setAllowedPipelines(allowedPipelines.filter((p) => p !== name));
    } else {
      setAllowedPipelines([...allowedPipelines, name]);
    }
    markDirty();
  };

  const modeNames = Object.keys(modes);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Rocket size={20} />
              Deploy Configuration
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Configure which pipelines are available in production and map them to inference modes.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || updateConfig.isPending}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              dirty
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed',
            )}
          >
            {updateConfig.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </button>
        </div>

        {updateConfig.isError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            Failed to save: {(updateConfig.error as Error).message}
          </div>
        )}

        {/* Inference Modes */}
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Inference Modes</h2>
          <p className="text-xs text-gray-500 mb-4">
            Clients request a mode name (e.g. "fast") and the production API routes to the configured pipeline.
          </p>

          <div className="space-y-3">
            {modeNames.map((name) => (
              <div
                key={name}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-gray-900">{name}</span>
                    {defaultMode === name && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                        default
                      </span>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <label className="flex-1">
                      <span className="text-xs text-gray-500">Pipeline</span>
                      <select
                        value={modes[name].pipeline}
                        onChange={(e) => updateMode(name, 'pipeline', e.target.value)}
                        className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">-- select --</option>
                        {allPipelines.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex-1">
                      <span className="text-xs text-gray-500">Description</span>
                      <input
                        type="text"
                        value={modes[name].description}
                        onChange={(e) => updateMode(name, 'description', e.target.value)}
                        placeholder="Describe this mode..."
                        className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex flex-col gap-1 pt-1">
                  <button
                    onClick={() => setDefaultMode(name)}
                    disabled={defaultMode === name}
                    className={clsx(
                      'rounded px-2 py-1 text-xs font-medium transition-colors',
                      defaultMode === name
                        ? 'bg-blue-100 text-blue-700 cursor-default'
                        : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600',
                    )}
                    title="Set as default"
                  >
                    Default
                  </button>
                  <button
                    onClick={() => removeMode(name)}
                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove mode"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newModeName}
              onChange={(e) => setNewModeName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMode()}
              placeholder="New mode name..."
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={addMode}
              disabled={!newModeName.trim()}
              className="flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              <Plus size={14} />
              Add Mode
            </button>
          </div>
        </section>

        {/* Pipeline Allowlist */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Shield size={14} />
                Pipeline Allowlist
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                When enabled, only checked pipelines can be used in production. Unchecked pipelines return 403.
              </p>
            </div>
            <button
              onClick={toggleAllowlist}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                allowedPipelines === null
                  ? 'bg-gray-100 text-gray-600 hover:bg-yellow-50'
                  : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
              )}
            >
              {allowedPipelines === null ? 'Enable Allowlist' : 'Disable (allow all)'}
            </button>
          </div>

          {allowedPipelines !== null && (
            <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
              {allPipelines.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-400">No pipelines saved yet.</div>
              )}
              {allPipelines.map((name) => {
                const allowed = allowedPipelines.includes(name);
                const usedByMode = modeNames.find((m) => modes[m].pipeline === name);
                return (
                  <label
                    key={name}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={allowed}
                      onChange={() => togglePipelineAllowed(name)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-mono text-gray-900">{name}</span>
                    {usedByMode && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                        used by "{usedByMode}"
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {allowedPipelines === null && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              Allowlist disabled — all saved pipelines are available in production.
            </div>
          )}
        </section>

        {/* Production API URL */}
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1.5">
            <Globe size={14} />
            Production API URL
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Set this to your production server's base URL to view production audit logs from the Audit tab.
          </p>
          <input
            type="url"
            value={productionApiUrl}
            onChange={(e) => {
              setProductionApiUrl(e.target.value);
              markDirty();
            }}
            placeholder="https://your-production-server:8000"
            className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 text-sm font-mono placeholder:text-gray-300"
          />
          {productionApiUrl.trim() && (
            <p className="mt-1.5 text-xs text-green-600">
              The Audit tab will show a toggle to view production logs via this URL.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
