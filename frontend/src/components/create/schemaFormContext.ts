/**
 * Context passed from PipeConfigPanel into @rjsf/core ``Form`` for pipe config editors.
 */
export interface SchemaFormContext {
  pipeType?: string;
  baseLabels?: string[];
  config?: Record<string, unknown>;
  /**
   * Flow node id: enables store-backed hooks (``usePipeFormContextConfig``, ``useLabelSpace``)
   * when sibling fields change without re-rendering this field (e.g. ``model`` vs ``label_mapping``).
   */
  selectedNodeId?: string;
}
