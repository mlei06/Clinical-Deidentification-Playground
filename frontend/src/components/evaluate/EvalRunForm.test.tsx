import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EvalRunForm from './EvalRunForm';

const mutateSpy = vi.fn();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../shared/PipelineSelector', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <input
      aria-label="pipeline-selector"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('./EvalLabelAlignment', () => ({
  default: ({
    onTempPredLabelRemapChange,
  }: {
    onTempPredLabelRemapChange?: (mapping: Record<string, string>) => void;
  }) => (
    <button
      type="button"
      onClick={() => onTempPredLabelRemapChange?.({ PATIENT_NAME: 'NAME' })}
    >
      Set remap
    </button>
  ),
}));

vi.mock('../../hooks/useDatasets', () => ({
  useDatasets: () => ({
    data: [{ name: 'gold-a' }],
    isLoading: false,
  }),
  useDataset: () => ({
    data: { document_count: 5, split_document_counts: {} },
  }),
}));

vi.mock('../../hooks/useEvalRuns', () => ({
  useRunEvaluation: () => ({
    isPending: false,
    isError: false,
    mutate: mutateSpy,
  }),
}));

describe('EvalRunForm', () => {
  it('submits eval_pred_label_remap when temporary mapping is configured', () => {
    render(<EvalRunForm onResult={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('pipeline-selector'), {
      target: { value: 'pipe-a' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'gold-a' },
    });
    fireEvent.click(screen.getByText('Set remap'));
    fireEvent.click(screen.getByText('Run evaluation'));

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [payload] = mutateSpy.mock.calls[0];
    expect(payload.eval_pred_label_remap).toEqual({ PATIENT_NAME: 'NAME' });
  });
});
