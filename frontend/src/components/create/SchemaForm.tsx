import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import type { IChangeEvent } from '@rjsf/core';
import type { RegistryWidgetsType, RegistryFieldsType } from '@rjsf/utils';
import { schemaToUiSchema, normalizeSchema } from '../../lib/schemaToUiSchema';
import { useMemo } from 'react';
import KeyValueField from './widgets/KeyValueWidget';
import LabelSpaceField from './widgets/LabelSpaceWidget';
import LabelRegexField from './widgets/LabelRegexWidget';
import UnifiedLabelField from './widgets/UnifiedLabelField';
import WhitelistLabelField from './widgets/WhitelistLabelField';
import BlacklistDictsField from './widgets/BlacklistDictsField';
import TagListWidget from './widgets/TagListWidget';
import DictionaryPickerWidget from './widgets/DictionaryPickerWidget';
import DescribedSelectWidget from './widgets/DescribedSelectWidget';
import type { SchemaFormContext } from './schemaFormContext';

export type { SchemaFormContext };

const customWidgets: RegistryWidgetsType = {
  tagList: TagListWidget,
  dictionaryPicker: DictionaryPickerWidget,
  describedSelect: DescribedSelectWidget,
};

const customFields: RegistryFieldsType = {
  keyValue: KeyValueField,
  labelSpace: LabelSpaceField,
  labelRegex: LabelRegexField,
  unifiedLabel: UnifiedLabelField,
  whitelistLabel: WhitelistLabelField,
  blacklistDicts: BlacklistDictsField,
};

interface SchemaFormProps {
  schema: Record<string, unknown>;
  formData: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  formContext?: SchemaFormContext;
}

export default function SchemaForm({ schema, formData, onChange, formContext }: SchemaFormProps) {
  const normalizedSchema = useMemo(() => normalizeSchema(schema), [schema]);
  const uiSchema = useMemo(
    () => schemaToUiSchema(normalizedSchema, formData as Record<string, unknown>),
    [normalizedSchema, formData],
  );

  const handleChange = (e: IChangeEvent) => {
    onChange(e.formData);
  };

  return (
    <div className={[
      'schema-form text-sm',
      '[&_.field-description]:text-xs [&_.field-description]:text-gray-400',
      '[&_input]:rounded [&_input]:border [&_input]:border-gray-300 [&_input]:px-2 [&_input]:py-1 [&_input]:text-sm',
      '[&_label]:mb-1 [&_label]:block [&_label]:text-xs [&_label]:font-medium [&_label]:text-gray-600',
      '[&_select]:rounded [&_select]:border [&_select]:border-gray-300 [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm',
      '[&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-gray-300',
      '[&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-xs [&_textarea]:font-mono [&_textarea]:leading-relaxed [&_textarea]:resize-y',
      '[&_.form-group]:mb-3',
    ].join(' ')}>
      <Form
        schema={normalizedSchema as any}
        uiSchema={{
          ...uiSchema,
          'ui:submitButtonOptions': { norender: true },
        }}
        formData={formData}
        onChange={handleChange}
        validator={validator}
        widgets={customWidgets}
        fields={customFields}
        formContext={formContext}
        liveValidate={false}
      />
    </div>
  );
}
