import type { ReactNode } from 'react';
import { AlertCircle, CircleSlash } from 'lucide-react';
import type { PipeValidationState } from '../../stores/pipelineEditorStore';
import type { PipeReadiness } from '../../api/pipelines';

interface Props {
  validation?: PipeValidationState;
  readiness?: PipeReadiness;
  installed: boolean;
}

function tooltipFromValidation(v: PipeValidationState | undefined): string | null {
  if (!v || v.errorCount === 0) return null;
  const head = v.errors.slice(0, 4).join('\n');
  const more = v.errorCount > 4 ? `\n…and ${v.errorCount - 4} more` : '';
  return `${v.errorCount} schema error${v.errorCount === 1 ? '' : 's'}:\n${head}${more}`;
}

function tooltipFromReadiness(r: PipeReadiness | undefined, installed: boolean): string | null {
  if (!installed) return 'Pipe is not installed';
  if (!r) return null;
  if (r.ok) return null;
  const lines: string[] = [];
  if (r.missing.length > 0) lines.push(`Missing: ${r.missing.join(', ')}`);
  if (r.ready_details && typeof r.ready_details === 'object') {
    const err = (r.ready_details as Record<string, unknown>).error;
    if (typeof err === 'string') lines.push(err);
  }
  if (r.install_hint) lines.push(r.install_hint);
  return lines.length ? lines.join('\n') : 'Not ready';
}

/**
 * Hover/focus tooltip with no delay and no native ``title`` flakiness.
 *
 * Native ``title`` waits ~500ms, doesn't re-show on quick re-hover, and gets
 * eaten when the cursor crosses inner children. Group-hover + group-focus-within
 * fires immediately and stays attached to the wrapper, so re-entering the
 * trigger reliably re-opens the tip.
 */
function TooltipWrapper({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span tabIndex={0} className={`group relative inline-flex outline-none ${className ?? ''}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-max max-w-[20rem] whitespace-pre-line rounded bg-gray-900 px-2 py-1 text-[10px] font-normal leading-snug text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}

export default function PipeStatusBadge({ validation, readiness, installed }: Props) {
  const validationTip = tooltipFromValidation(validation);
  const readinessTip = tooltipFromReadiness(readiness, installed);

  if (validationTip) {
    return (
      <TooltipWrapper text={validationTip} className="items-center gap-0.5 text-red-600">
        <AlertCircle size={14} />
        <span className="text-[10px] font-semibold tabular-nums">
          {validation?.errorCount}
        </span>
      </TooltipWrapper>
    );
  }

  if (readinessTip) {
    const Icon = installed ? AlertCircle : CircleSlash;
    return (
      <TooltipWrapper text={readinessTip} className="text-amber-500">
        <Icon size={14} />
      </TooltipWrapper>
    );
  }

  return null;
}
