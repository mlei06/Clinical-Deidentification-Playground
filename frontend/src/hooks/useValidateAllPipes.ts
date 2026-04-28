import { useEffect } from 'react';
import { usePipelineEditorStore } from '../stores/pipelineEditorStore';
import { validatePipeConfig } from '../lib/validatePipeConfig';

/**
 * Re-validates every pipe in the editor whenever the pipe list or any pipe's
 * config changes, and publishes per-pipe results into the store. Lets the rail
 * surface error badges for unselected pipes without rendering their forms.
 */
export function useValidateAllPipes(): void {
  const pipes = usePipelineEditorStore((s) => s.pipes);
  const setPipeValidation = usePipelineEditorStore((s) => s.setPipeValidation);

  useEffect(() => {
    const handle = setTimeout(() => {
      for (const pipe of pipes) {
        const state = validatePipeConfig(
          pipe.data.configSchema,
          pipe.data.config as Record<string, unknown>,
        );
        setPipeValidation(pipe.id, state);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [pipes, setPipeValidation]);
}
