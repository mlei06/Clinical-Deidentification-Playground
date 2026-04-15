import { useMemo } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useDeployConfig, useDeployHealth } from '../../hooks/useDeploy';
import type { ModeHealth } from '../../api/types';

interface ModeSelectorProps {
  value: string;
  onChange: (mode: string) => void;
}

export default function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const { data: config } = useDeployConfig();
  const { data: health, isLoading } = useDeployHealth();

  const modes: ModeHealth[] = useMemo(() => {
    if (health) return health.modes;
    if (!config) return [];
    return Object.entries(config.modes).map(([name, entry]) => ({
      name,
      pipeline: entry.pipeline,
      description: entry.description,
      available: true,
      missing: [],
    }));
  }, [health, config]);

  const selected = modes.find((m) => m.name === value);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500">Mode</label>
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading || modes.length === 0}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-blue-400 focus:outline-none disabled:opacity-40"
        >
          <option value="">{modes.length === 0 ? 'No modes configured' : 'Select a mode…'}</option>
          {modes.map((m) => (
            <option key={m.name} value={m.name} disabled={!m.available}>
              {m.name}
              {!m.available ? ' (unavailable)' : ''}
            </option>
          ))}
        </select>
        {selected && (
          <span
            className="flex items-center gap-1 text-xs"
            title={selected.missing.join(', ') || 'Ready'}
          >
            {selected.available ? (
              <>
                <CheckCircle2 size={13} className="text-green-600" />
                <span className="text-gray-500">
                  Pipeline: <code className="text-gray-700">{selected.pipeline}</code>
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={13} className="text-amber-600" />
                <span className="text-amber-700">
                  Missing: {selected.missing.join(', ')}
                </span>
              </>
            )}
          </span>
        )}
      </div>
      {selected?.description && (
        <p className="text-xs text-gray-400">{selected.description}</p>
      )}
    </div>
  );
}
