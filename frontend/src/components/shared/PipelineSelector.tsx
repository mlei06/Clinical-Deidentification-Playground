import { usePipelines } from '../../hooks/usePipelines';

interface PipelineSelectorProps {
  value: string;
  onChange: (name: string) => void;
  className?: string;
}

export default function PipelineSelector({
  value,
  onChange,
  className = '',
}: PipelineSelectorProps) {
  const { data: pipelines, isLoading } = usePipelines();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none ${className}`}
      disabled={isLoading}
    >
      <option value="">
        {isLoading ? 'Loading...' : 'Select a pipeline'}
      </option>
      {pipelines?.map((p) => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
