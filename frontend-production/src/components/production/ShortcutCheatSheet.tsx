import { useEffect } from 'react';

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: '↑ / ↓', description: 'Previous / next file in the list' },
  { keys: 'J / K', description: 'Next / previous unresolved file' },
  { keys: 'N', description: 'Next file whose detection failed' },
  { keys: 'R', description: 'Toggle resolved on the current file' },
  { keys: 'Enter / Space', description: 'Accept selected ghost span in review pane' },
  { keys: '[ / ]', description: 'Jump to previous / next overlap conflict' },
  { keys: '?', description: 'Show this cheat sheet' },
];

export default function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">
            Close
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td className="py-1 pr-4 font-mono text-xs text-gray-700">{s.keys}</td>
                <td className="py-1 text-gray-600">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
