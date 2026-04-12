import { useState } from 'react';
import RegisterForm from './RegisterForm';
import DatasetList from './DatasetList';
import DatasetDetail from './DatasetDetail';
import ComposeForm from './ComposeForm';
import TransformForm from './TransformForm';
import GenerateForm from './GenerateForm';

type Action = 'compose' | 'transform' | 'generate' | null;

export default function DatasetsView() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);

  const handleCreated = (name: string) => {
    setSelectedName(name);
    setAction(null);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      {/* Register form */}
      <RegisterForm onRegistered={handleCreated} />

      {/* Action buttons */}
      <div className="flex gap-2">
        {(['compose', 'transform', 'generate'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(action === a ? null : a)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              action === a
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Action panels */}
      {action === 'compose' && <ComposeForm onCreated={handleCreated} />}
      {action === 'transform' && (
        <TransformForm
          sourceDataset={selectedName || undefined}
          onCreated={handleCreated}
        />
      )}
      {action === 'generate' && <GenerateForm onCreated={handleCreated} />}

      {/* List + Detail */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            Registered Datasets
          </h3>
          <DatasetList onSelect={setSelectedName} selectedName={selectedName} />
        </div>
        <div className="lg:col-span-2">
          {selectedName ? (
            <DatasetDetail name={selectedName} />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">
              Select a dataset to view analytics and documents
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
