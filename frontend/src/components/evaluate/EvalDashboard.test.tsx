import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import EvalDashboard from './EvalDashboard';
import type { EvalRunDetail } from '../../api/types';

function makeRun(remap?: Record<string, string>): EvalRunDetail {
  return {
    id: 'run-1',
    pipeline_name: 'demo',
    dataset_source: 'dataset-a',
    document_count: 10,
    strict_f1: 0.5,
    risk_weighted_recall: 0.6,
    created_at: new Date().toISOString(),
    metrics: {
      overall: {
        strict: { precision: 0.5, recall: 0.5, f1: 0.5, tp: 1, fp: 1, fn: 1 },
      },
      per_label: {},
      risk_weighted_recall: 0.6,
      label_confusion: {},
      ...(remap ? { eval_pred_label_remap: remap } : {}),
    },
  };
}

describe('EvalDashboard', () => {
  it('shows remap banner when eval remap metadata exists', () => {
    render(
      <MemoryRouter>
        <EvalDashboard run={makeRun({ TELEPHONE: 'PHONE' })} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Eval remap applied')).toBeInTheDocument();
    expect(screen.getByText('TELEPHONE -> PHONE')).toBeInTheDocument();
  });

  it('does not show remap banner when no remap metadata exists', () => {
    render(
      <MemoryRouter>
        <EvalDashboard run={makeRun()} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Eval remap applied')).not.toBeInTheDocument();
  });
});
