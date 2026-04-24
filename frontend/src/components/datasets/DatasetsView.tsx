import { useState } from 'react';
import RegisterForm from './RegisterForm';
import ImportBratForm from './ImportBratForm';
import FormCard from './FormCard';
import DatasetList from './DatasetList';
import DatasetDetail from './DatasetDetail';
import ComposeForm from './ComposeForm';
import TransformForm from './TransformForm';
import GenerateForm from './GenerateForm';

type Pillar = 'library' | 'ingestion' | 'operations';
type OpPanel = 'compose' | 'transform' | 'generate';

const PILLARS: { id: Pillar; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'operations', label: 'Operations' },
];

const OP_ITEMS: { id: OpPanel; label: string }[] = [
  { id: 'compose', label: 'Compose' },
  { id: 'transform', label: 'Transform' },
  { id: 'generate', label: 'Generate' },
];

export default function DatasetsView() {
  const [pillar, setPillar] = useState<Pillar>('library');
  const [opPanel, setOpPanel] = useState<OpPanel>('transform');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const handleCreated = (name: string) => {
    setSelectedName(name);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">Datasets</h1>
        <nav className="mt-3 flex gap-0 border-b border-gray-200" aria-label="Datasets main sections">
          {PILLARS.map((t) => {
            const active = pillar === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setPillar(t.id)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {pillar === 'library' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col gap-2 lg:col-span-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Datasets</h2>
            <DatasetList onSelect={setSelectedName} selectedName={selectedName} />
          </div>
          <div className="min-h-0 lg:col-span-2">
            {selectedName ? (
              <DatasetDetail name={selectedName} />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 text-sm text-gray-500">
                Select a dataset to view analytics and documents
              </div>
            )}
          </div>
        </div>
      )}

      {pillar === 'ingestion' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <FormCard title="Import JSONL">
            <RegisterForm onRegistered={handleCreated} />
          </FormCard>
          <FormCard title="Convert BRAT to JSONL">
            <ImportBratForm onImported={handleCreated} />
          </FormCard>
        </div>
      )}

      {pillar === 'operations' && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:flex-row">
          <nav
            className="flex flex-shrink-0 flex-row flex-wrap gap-1 border-b border-gray-200 pb-2 lg:w-48 lg:flex-col lg:gap-0.5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4"
            aria-label="Dataset operations"
          >
            {OP_ITEMS.map((op) => {
              const on = opPanel === op.id;
              return (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setOpPanel(op.id)}
                  className={`flex-shrink-0 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    on
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {op.label}
                </button>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">
            {opPanel === 'compose' && <ComposeForm onCreated={handleCreated} />}
            {opPanel === 'transform' && (
              <TransformForm
                sourceDataset={selectedName || undefined}
                onCreated={handleCreated}
              />
            )}
            {opPanel === 'generate' && <GenerateForm onCreated={handleCreated} />}
          </div>
        </div>
      )}
    </div>
  );
}
