import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import EvalLabelAlignment from './EvalLabelAlignment';

vi.mock('../../hooks/useHealth', () => ({
  useHealth: () => ({ data: { label_space_name: 'clinical_phi', risk_profile_name: 'clinical_phi' } }),
}));

vi.mock('../../hooks/useDatasets', () => ({
  useDataset: () => ({
    isLoading: false,
    isError: false,
    data: { labels: ['NAME', 'PHONE'] },
  }),
}));

vi.mock('../../hooks/usePipelines', () => ({
  usePipeline: () => ({
    isLoading: false,
    isError: false,
    data: { config: { output_label_space: ['PATIENT_NAME', 'PHONE'] } },
  }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({
      isLoading: false,
      isError: false,
      data: null,
    }),
  };
});

describe('EvalLabelAlignment', () => {
  it('renders temp remap dropdown for pipeline-only labels and reports selection', () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <EvalLabelAlignment
          sourceMode="registered"
          datasetName="gold-a"
          datasetPath=""
          pipelineName="pipe-a"
          tempPredLabelRemap={{}}
          onTempPredLabelRemapChange={onChange}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Temporary eval label remap')).toBeInTheDocument();
    const combo = screen.getByRole('combobox');
    fireEvent.change(combo, { target: { value: 'NAME' } });

    expect(onChange).toHaveBeenCalledWith({ PATIENT_NAME: 'NAME' });
  });
});
