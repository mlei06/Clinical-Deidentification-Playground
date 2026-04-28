import { useEffect, useMemo, useState } from 'react';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';
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
  const {
    pipelineName,
    setPipelineName,
    pipelineDescription,
    setPipelineDescription,
    toPipelineConfig,
  } = usePipelineEditorStore();
  const pipes = usePipelineEditorStore((s) => s.pipes);
  const validationByPipeId = usePipelineEditorStore((s) => s.validationByPipeId);
  const [name, setName] = useState(pipelineName);
  const [description, setDescription] = useState(pipelineDescription);
  const [saveMode, setSaveMode] = useState<'create' | 'update'>(isUpdate ? 'update' : 'create');
  const [confirmAnyway, setConfirmAnyway] = useState(false);
  const createMutation = useCreatePipeline();
  const updateMutation = useUpdatePipeline();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) return;
    setName(pipelineName);
    setDescription(pipelineDescription);
    setSaveMode(isUpdate ? 'update' : 'create');
    setConfirmAnyway(false);
  }, [isOpen, isUpdate, pipelineDescription, pipelineName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const invalidPipes = useMemo(() => {
    return pipes
      .map((p) => ({
        label: p.data.label,
        count: validationByPipeId[p.id]?.errorCount ?? 0,
      }))
      .filter((p) => p.count > 0);
  }, [pipes, validationByPipeId]);

  if (!isOpen) return null;

  const shouldUpdate = isUpdate && saveMode === 'update';
  const mutation = shouldUpdate ? updateMutation : createMutation;
  const hasIssues = invalidPipes.length > 0;
  const blockedByIssues = hasIssues && !confirmAnyway;

  const handleSave = () => {
    setPipelineDescription(description);
    const base = toPipelineConfig();
    const trimmed = description.trim();
    const config = trimmed ? { ...base, description: trimmed } : base;
    const saveName = shouldUpdate ? pipelineName : name;
    if (!saveName.trim()) return;

    if (shouldUpdate) {
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
            {shouldUpdate ? 'Update Pipeline' : 'Save Pipeline'}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          {!shouldUpdate && (
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
          {shouldUpdate && (
            <p className="mb-4 text-sm text-gray-600">
              Update <span className="font-semibold">{pipelineName}</span>?
            </p>
          )}
          {isUpdate && (
            <button
              onClick={() =>
                setSaveMode((current) => (current === 'update' ? 'create' : 'update'))
              }
              className="mb-4 text-xs font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              {shouldUpdate
                ? 'Save as a new pipeline instead'
                : `Update "${pipelineName}" instead`}
            </button>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Description
              <span className="ml-1 text-gray-400">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this pipeline does, who it's for, any caveats…"
              rows={3}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
            />
          </div>

          {hasIssues && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="mb-1 flex items-center gap-1 font-semibold">
                <AlertCircle size={13} />
                {invalidPipes.length} pipe{invalidPipes.length === 1 ? '' : 's'} with schema errors
              </div>
              <ul className="ml-4 list-disc space-y-0.5">
                {invalidPipes.slice(0, 5).map((p, i) => (
                  <li key={i} className="capitalize">
                    {p.label} <span className="text-amber-600">({p.count})</span>
                  </li>
                ))}
                {invalidPipes.length > 5 && (
                  <li className="text-amber-600">
                    …and {invalidPipes.length - 5} more
                  </li>
                )}
              </ul>
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 font-medium">
                <input
                  type="checkbox"
                  checked={confirmAnyway}
                  onChange={(e) => setConfirmAnyway(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Save anyway
              </label>
            </div>
          )}

          {mutation.isError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(mutation.error as Error).message}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={
              mutation.isPending ||
              (!shouldUpdate && !name.trim()) ||
              blockedByIssues
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {hasIssues
              ? 'Save anyway'
              : shouldUpdate
                ? 'Update'
                : 'Save As New'}
          </button>
        </div>
      </div>
    </div>
  );
}
