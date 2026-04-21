import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { fetchLabelSpaceBundle } from '../../api/pipelines';

/**
 * Read-only metadata panel for the selected Hugging Face NER model.
 *
 * Sources its data from the same ``label-space-bundle`` endpoint the label
 * widget already uses, so switching models in the config form reuses the
 * cached bundle — no extra round-trips.
 */
export default function HuggingfaceModelInfo({
  selectedModel,
}: {
  selectedModel: string;
}) {
  const { data: bundle } = useQuery({
    queryKey: ['label-space-bundle', 'huggingface_ner'],
    queryFn: () => fetchLabelSpaceBundle('huggingface_ner'),
    staleTime: 5 * 60_000,
    enabled: !!selectedModel,
  });

  const info = bundle?.model_info?.[selectedModel];
  if (!selectedModel || !info) return null;

  const trainedMax = info.trained_max_length;
  const archMax = info.max_position_embeddings;
  const segmentation = info.segmentation;
  const baseModel = info.base_model;
  const trainDocs = info.train_documents;

  const rows: Array<[string, React.ReactNode]> = [];
  if (trainedMax != null) {
    rows.push([
      'Trained max length',
      <span>
        {trainedMax} tokens
        {archMax != null && archMax !== trainedMax && (
          <span className="text-gray-400"> · model ceiling {archMax}</span>
        )}
      </span>,
    ]);
  } else if (archMax != null) {
    rows.push(['Model context window', `${archMax} tokens`]);
  }
  if (segmentation) rows.push(['Trained segmentation', segmentation]);
  if (baseModel) rows.push(['Base model', baseModel]);
  if (trainDocs != null) rows.push(['Training documents', String(trainDocs)]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-gray-150 bg-gray-50/50 p-3">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Info size={12} className="text-gray-400" />
        Model details
      </div>
      <dl className="space-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-right font-mono text-gray-700">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
