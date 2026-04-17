import { useCallback } from 'react';
import { usePipelineEditorStore } from '../stores/pipelineEditorStore';
import type { SchemaFormContext } from '../components/create/schemaFormContext';
import { usePipeEditorNodeId } from '../components/create/PipeEditorNodeContext';

/**
 * Live full pipe ``config`` for RJSF custom fields.
 *
 * RJSF often does not re-render a custom field when a sibling control changes (the field only
 * receives its own slice as ``formData``). Subscribing to the editor store keeps label-space
 * queries and other config-driven UI aligned with ``model``, ``entity_map``, etc.
 *
 * ``PipeEditorNodeContext`` supplies the node id so we do not rely on ``formContext`` reaching
 * every custom field (if it is missing, the zustand selector would always return ``undefined`` and
 * store updates would not re-render the field).
 */
export function usePipeFormContextConfig(
  formContext: SchemaFormContext | undefined,
): Record<string, unknown> {
  const ctxNodeId = usePipeEditorNodeId();
  const selectedNodeId = ctxNodeId ?? formContext?.selectedNodeId;
  const selectConfig = useCallback(
    (s: ReturnType<typeof usePipelineEditorStore.getState>) =>
      selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId)?.data.config : undefined,
    [selectedNodeId],
  );
  const fromStore = usePipelineEditorStore(selectConfig);
  return (fromStore ?? formContext?.config ?? {}) as Record<string, unknown>;
}
