import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
}

export default function TextInput({ value, onChange }: TextInputProps) {
  const onDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') onChange(reader.result);
      };
      reader.readAsText(file);
    },
    [onChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    accept: { 'text/*': ['.txt', '.csv', '.json', '.jsonl'] },
  });

  return (
    <div {...getRootProps()} className="relative flex flex-col">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste clinical text here, or drag & drop a file..."
        className="h-48 w-full resize-y rounded-lg border border-gray-300 p-3 font-mono text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none"
      />
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/80">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
            <Upload size={18} />
            Drop file here
          </div>
        </div>
      )}

      <label className="mt-1.5 flex cursor-pointer items-center gap-1 self-end text-xs text-gray-400 hover:text-gray-600">
        <Upload size={12} />
        Upload file
        <input
          type="file"
          className="hidden"
          accept=".txt,.csv,.json,.jsonl"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') onChange(reader.result);
            };
            reader.readAsText(file);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
