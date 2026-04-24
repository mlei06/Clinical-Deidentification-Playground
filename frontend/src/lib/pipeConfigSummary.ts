import type { PipeNodeData } from '../stores/pipelineEditorStore';

function joinLabels(prefix: string, arr: string[] | undefined, max = 5): string {
  if (!arr || arr.length === 0) return '';
  const shown = arr.slice(0, max);
  const extra = arr.length > max ? `, +${arr.length - max} more` : '';
  return `${prefix}: ${shown.join(', ')}${extra}`;
}

/**
 * One-line summary for a collapsed pipe card.
 */
export function pipeConfigOneLiner(data: PipeNodeData): string {
  const t = data.pipeType;
  const c = data.config as Record<string, unknown>;

  if (t === 'label_filter') {
    const drop = c.drop as string[] | undefined;
    const keep = c.keep as string[] | undefined;
    if (drop?.length) return joinLabels('Drop', drop);
    if (keep?.length) return joinLabels('Keep', keep);
    return 'No filter set';
  }
  if (t === 'label_mapper') {
    const m = c.mapping as Record<string, string> | undefined;
    const n = m ? Object.keys(m).length : 0;
    return n ? `${n} label mapping${n === 1 ? '' : 's'}` : 'No mappings';
  }
  if (t === 'resolve_spans') {
    const s = c.strategy;
    return typeof s === 'string' ? `Strategy: ${s.replace(/_/g, ' ')}` : 'Resolve overlaps';
  }
  if (t === 'regex_ner' || t === 'whitelist' || t === 'blacklist') {
    if (c.labels && Array.isArray(c.labels)) {
      return joinLabels('Labels', c.labels as string[]);
    }
    if (c.label_mapping && typeof c.label_mapping === 'object') {
      return `${Object.keys(c.label_mapping as object).length} label remaps`;
    }
  }
  if (t === 'presidio_ner' || t === 'neuroner_ner' || t === 'huggingface_ner') {
    if (typeof c.model === 'string') {
      return `Model: ${c.model.split('/').pop() ?? c.model}`;
    }
  }
  if (t === 'llm_ner' && typeof c.model === 'string') {
    return `Model: ${c.model}`;
  }

  const keys = Object.keys(c).length;
  return keys ? `${keys} option${keys === 1 ? '' : 's'} set` : 'Default settings';
}

/**
 * Multi-line summary for an expanded card body (read-only; full editor stays in the side panel).
 */
export function pipeConfigExpandedText(data: PipeNodeData): string {
  const t = data.pipeType;
  const c = data.config as Record<string, unknown>;
  const lines: string[] = [];

  if (t === 'label_filter') {
    if (c.drop) lines.push(joinLabels('Drop', c.drop as string[]));
    if (c.keep) lines.push(joinLabels('Keep', c.keep as string[]));
  } else if (t === 'label_mapper') {
    const m = c.mapping as Record<string, string | null> | undefined;
    if (m) {
      for (const [k, v] of Object.entries(m).slice(0, 20)) {
        lines.push(`  ${k} → ${v === null || v === undefined ? '∅' : v}`);
      }
      if (Object.keys(m).length > 20) lines.push('  …');
    }
  } else if (t === 'resolve_spans') {
    if (c.strategy) lines.push(`Strategy: ${String(c.strategy).replace(/_/g, ' ')}`);
    if (c.consensus_threshold != null) lines.push(`Consensus threshold: ${c.consensus_threshold}`);
  } else {
    for (const [k, v] of Object.entries(c)) {
      if (v == null) continue;
      if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v).slice(0, 200)}${JSON.stringify(v).length > 200 ? '…' : ''}`);
      } else {
        lines.push(`${k}: ${String(v)}`);
      }
    }
  }

  return lines.length ? lines.join('\n') : 'No options configured';
}
