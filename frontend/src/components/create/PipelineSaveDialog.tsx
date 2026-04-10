import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { usePipelineEditorStore } from '../../stores/pipelineEditorStore';
import { useCreatePipeline, useUpdatePipeline } from '../../hooks/usePipelines';

interface PipelineSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isUpdate: boolean;
}

export default function PipelineSaveDialog({
  isOpen,
  onClose,
  isUpdate,
}: PipelineSaveDialogProps) {
  const { pipelineName, setPipelineName, toPipelineConfig } =
    usePipelineEditorStore();
  const [name, setName] = useState(pipelineName);
  const createMutation = useCreatePipeline();
  const updateMutation = useUpdatePipeline();

  if (!isOpen) return null;

  const mutation = isUpdate ? updateMutation : createMutation;

  const handleSave = () => {
    const config = toPipelineConfig();
    const saveName = isUpdate ? pipelineName : name;
    if (!saveName.trim()) return;

    if (isUpdate) {
      updateMutation.mutate(
        { name: saveName, config },
        {
          onSuccess: () => {
            usePipelineEditorStore.setState({ isDirty: false });
            onClose();
          },
        },
      );
    } else {
      createMutation.mutate(
        { name: saveName, config },
        {
          onSuccess: () => {
            setPipelineName(saveName);
            usePipelineEditorStore.setState({ isDirty: false });
            onClose();
          },
        },
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-96 rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">
            {isUpdate ? 'Update Pipeline' : 'Save Pipeline'}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          {!isUpdate && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Pipeline Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-pipeline"
                pattern="^[a-zA-Z0-9][a-zA-Z0-9._-]*$"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
              />
              <div className="mt-1 text-[10px] text-gray-400">
                Letters, numbers, hyphens, dots, underscores
              </div>
            </div>
          )}
          {isUpdate && (
            <p className="mb-4 text-sm text-gray-600">
              Update <span className="font-semibold">{pipelineName}</span>?
            </p>
          )}

          {mutation.isError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(mutation.error as Error).message}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={mutation.isPending || (!isUpdate && !name.trim())}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {isUpdate ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
