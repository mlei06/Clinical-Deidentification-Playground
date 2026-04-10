import { useMemo } from 'react';

interface ConfusionMatrixProps {
  confusion: Record<string, Record<string, number>>;
}

export default function ConfusionMatrix({ confusion }: ConfusionMatrixProps) {
  const { labels, maxVal } = useMemo(() => {
    const labelSet = new Set<string>();
    let max = 0;
    for (const [gold, preds] of Object.entries(confusion)) {
      labelSet.add(gold);
      for (const [pred, count] of Object.entries(preds)) {
        labelSet.add(pred);
        if (count > max) max = count;
      }
    }
    return { labels: [...labelSet].sort(), maxVal: max };
  }, [confusion]);

  if (labels.length === 0) {
    return <div className="text-sm text-gray-400">No confusion data</div>;
  }

  const cellColor = (count: number) => {
    if (count === 0) return '';
    const intensity = Math.round((count / maxVal) * 200 + 55);
    return `rgb(${255 - intensity}, ${255 - intensity / 2}, 255)`;
  };

  return (
    <div className="overflow-auto rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Label Confusion Matrix
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1 text-right text-gray-400">Gold \ Pred</th>
              {labels.map((l) => (
                <th key={l} className="px-2 py-1 text-center text-gray-500" style={{ writingMode: 'vertical-lr' }}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((gold) => (
              <tr key={gold}>
                <td className="px-2 py-1 text-right font-medium text-gray-600">
                  {gold}
                </td>
                {labels.map((pred) => {
                  const count = confusion[gold]?.[pred] ?? 0;
                  return (
                    <td
                      key={pred}
                      className="px-2 py-1 text-center"
                      style={{
                        backgroundColor: cellColor(count),
                        minWidth: 32,
                      }}
                    >
                      {count > 0 ? count : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
