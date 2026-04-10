import type { WidgetProps } from '@rjsf/utils';

/**
 * Select widget that shows only the currently selected option's description
 * below the dropdown, instead of listing all descriptions at once.
 *
 * Expects `schema.ui_enum_descriptions` — a `Record<string, string>` mapping
 * each enum value to its description text.
 */
export default function DescribedSelectWidget(props: WidgetProps) {
  const { id, value, onChange, schema, options, label } = props;

  const enumValues: string[] =
    (options.enumOptions ?? []).map((o: { value: string }) => o.value);

  const descriptions: Record<string, string> =
    (schema as Record<string, unknown>).ui_enum_descriptions as Record<string, string> ?? {};

  const activeDescription = descriptions[value as string] ?? '';

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-600">
          {label}
        </label>
      )}
      <select
        id={id}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      {activeDescription && (
        <p className="text-xs text-gray-500">{activeDescription}</p>
      )}
    </div>
  );
}
