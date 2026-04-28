import validator from '@rjsf/validator-ajv8';
import type { RJSFSchema } from '@rjsf/utils';
import type { PipeValidationState } from '../stores/pipelineEditorStore';

/**
 * Validate against the *raw* backend schema, not the rjsf-normalized one.
 * ``normalizeSchema`` collapses nullable ``anyOf`` patterns to the non-null
 * branch for cleaner form widgets — applying that to validation makes AJV
 * reject every saved ``null`` for ``Optional[...]`` fields ("must be array").
 * AJV handles ``anyOf`` natively, so just feed it the original schema.
 */
export function validatePipeConfig(
  schema: Record<string, unknown> | null,
  config: Record<string, unknown>,
): PipeValidationState {
  if (!schema) return { errors: [], errorCount: 0 };
  try {
    const result = validator.validateFormData(config, schema as RJSFSchema);
    const errors = (result.errors ?? []).map(
      (e) => e.stack ?? e.message ?? 'invalid value',
    );
    return { errors, errorCount: errors.length };
  } catch {
    return { errors: [], errorCount: 0 };
  }
}
