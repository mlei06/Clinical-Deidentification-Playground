import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { getDictionaryTerms } from '../../api/dictionaries';

const PAGE_SIZE = 50;

interface Props {
  kind: string;
  name: string;
  label?: string;
}

export default function DictionaryTermBrowser({ kind, name, label }: Props) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  // Reset offset when search changes
  const handleSearch = (val: string) => {
    setSearch(val);
    setOffset(0);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['dictionary-terms', kind, name, label, offset, search],
    queryFn: () =>
      getDictionaryTerms(kind, name, { label: label ?? undefined, offset, limit: PAGE_SIZE, search: search || undefined }),
  });

  const total = data?.total ?? 0;
  const terms = data?.terms ?? [];
  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;
  const pageStart = total > 0 ? offset + 1 : 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search terms..."
          className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-3 text-sm"
        />
      </div>

      {/* Term list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      ) : terms.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">
          {search ? 'No terms match your search' : 'No terms in this dictionary'}
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto rounded border border-gray-200">
          {terms.map((term, i) => (
            <div
              key={`${offset}-${i}`}
              className={`px-3 py-1.5 text-sm ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
            >
              {term}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {pageStart}--{pageEnd} of {total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasNext}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
