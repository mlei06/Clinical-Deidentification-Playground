import type { UiSchema } from '@rjsf/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIDGET_MAP: Record<string, string> = {
  text: 'text',
  textarea: 'textarea',
  number: 'updown',
  slider: 'range',
  switch: 'checkbox',
  select: 'select',
  multiselect: 'tagList',
  tag_list: 'tagList',
  described_select: 'describedSelect',
  dictionary_picker: 'dictionaryPicker',
  password: 'password',
};

/** These map to custom rjsf *fields* (via ui:field) — needed for type:"object"
 *  schemas where ui:widget is silently ignored by rjsf. */
const FIELD_MAP: Record<string, string> = {
  label_mapping: 'keyValue',
  label_space: 'labelSpace',
  label_regex: 'labelRegex',
  unified_label: 'unifiedLabel',
  whitelist_label: 'whitelistLabel',
  blacklist_dicts: 'blacklistDicts',
  key_value: 'keyValue',
  nested_dict: 'keyValue',
};

/**
 * Unwrap nullable anyOf patterns that Pydantic v2 generates for
 * `Optional[X]` / `X | None`. rjsf shows a broken type-selector
 * dropdown for these; we collapse them to just the non-null variant.
 *
 * Also strips extra keys (ui_widget, ui_help, etc.) that aren't part
 * of JSON Schema proper — they are consumed here and converted to
 * uiSchema entries instead.
 */
export function normalizeSchema(schema: Record<string, any>): Record<string, any> {
  const result = { ...schema };
  const props = result.properties;
  if (!props) return result;

  const normalized: Record<string, any> = {};
  for (const [key, prop] of Object.entries<any>(props)) {
    normalized[key] = unwrapNullable(prop);
  }
  result.properties = normalized;
  return result;
}

function unwrapNullable(prop: any): any {
  if (!prop || typeof prop !== 'object') return prop;

  if (Array.isArray(prop.anyOf)) {
    const nonNull = prop.anyOf.filter((s: any) => s.type !== 'null');
    if (nonNull.length === 1) {
      const { anyOf: _, ...rest } = prop;
      return { ...nonNull[0], ...rest };
    }
  }

  if (prop.additionalProperties && typeof prop.additionalProperties === 'object') {
    return { ...prop, additionalProperties: unwrapNullable(prop.additionalProperties) };
  }

  return prop;
}

export function schemaToUiSchema(jsonSchema: Record<string, any>): UiSchema {
  const uiSchema: UiSchema = {};
  const properties = jsonSchema.properties ?? {};

  const ordered: [string, number][] = [];

  for (const [field, schema] of Object.entries<any>(properties)) {
    const ui: Record<string, unknown> = {};

    if (schema.ui_advanced) {
      ui['ui:widget'] = 'hidden';
      uiSchema[field] = ui;
      ordered.push([field, schema.ui_order ?? 999]);
      continue;
    }

    if (schema.ui_widget) {
      const fieldName = FIELD_MAP[schema.ui_widget];
      if (fieldName) {
        ui['ui:field'] = fieldName;
      } else {
        const mapped = WIDGET_MAP[schema.ui_widget];
        if (mapped) ui['ui:widget'] = mapped;
      }
    }

    if (schema.ui_help) ui['ui:help'] = schema.ui_help;
    if (schema.ui_placeholder) ui['ui:placeholder'] = schema.ui_placeholder;

    if (Object.keys(ui).length > 0) {
      uiSchema[field] = ui;
    }

    ordered.push([field, schema.ui_order ?? 999]);
  }

  ordered.sort((a, b) => a[1] - b[1]);
  uiSchema['ui:order'] = ordered.map(([f]) => f);

  return uiSchema;
}
