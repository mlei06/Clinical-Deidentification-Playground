import { createContext, useContext } from 'react';

/** Flow node id for the pipe being edited — avoids relying on RJSF ``formContext`` reaching custom fields. */
export const PipeEditorNodeContext = createContext<string | null>(null);

export function usePipeEditorNodeId(): string | undefined {
  const id = useContext(PipeEditorNodeContext);
  return id ?? undefined;
}
