import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { X, Upload, Loader2 } from 'lucide-react';
import { uploadDictionary } from '../../api/dictionaries';

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

export default function DictionaryUploadDialog({ open, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'whitelist' | 'blacklist'>('whitelist');
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      const f = accepted[0];
      setFile(f);
      if (!name) {
        const stem = f.name.replace(/\.[^.]+$/, '');
        setName(stem);
      }
      setError('');
      setSuccessMsg('');
    }
  }, [name]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.txt'], 'text/csv': ['.csv'], 'application/json': ['.json'] },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024,
  });

  const reset = () => {
    setFile(null);
    setKind('whitelist');
    setLabel('');
    setName('');
    setError('');
    setSuccessMsg('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleUpload = async () => {
    if (!file || !name.trim()) return;
    if (kind === 'whitelist' && !label.trim()) {
      setError('Label is required for whitelist dictionaries');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await uploadDictionary(
        file,
        kind,
        name.trim(),
        kind === 'whitelist' ? label.trim().toUpperCase() : undefined,
      );
      setSuccessMsg(result.message);
      onUploaded();
      setTimeout(handleClose, 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Upload Dictionary</h2>
          <button onClick={handleClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Drop zone */}
          <div
            {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
              isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            <Upload size={24} className="mb-2 text-gray-400" />
            {file ? (
              <p className="text-sm text-gray-700">{file.name}</p>
            ) : (
              <p className="text-sm text-gray-500">Drop a .txt, .csv, or .json file here, or click to browse</p>
            )}
          </div>

          {/* Kind selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
            <div className="flex gap-2">
              {(['whitelist', 'blacklist'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    kind === k
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {k === 'whitelist' ? 'Whitelist' : 'Blacklist'}
                </button>
              ))}
            </div>
          </div>

          {/* Label (whitelist only) */}
          {kind === 'whitelist' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. HOSPITAL, DOCTOR, LOCATION"
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">The PHI label this dictionary detects</p>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Dictionary Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ontario_hospitals"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {successMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            onClick={handleClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || !name.trim() || uploading}
            className="flex items-center gap-1.5 rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploading && <Loader2 size={14} className="animate-spin" />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
