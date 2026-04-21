import { apiBaseUrl, apiFetch, authHeaders } from './client';
import type {
  DictionaryInfo,
  DictionaryPreview,
  DictionaryTermsPage,
  DictionaryUploadResult,
} from './types';

export function listDictionaries(
  kind?: 'whitelist' | 'blacklist',
  label?: string,
): Promise<DictionaryInfo[]> {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (label) params.set('label', label);
  const qs = params.toString();
  return apiFetch(`/dictionaries${qs ? `?${qs}` : ''}`);
}

export function getDictionaryPreview(
  kind: string,
  name: string,
  label?: string,
): Promise<DictionaryPreview> {
  const params = label ? `?label=${encodeURIComponent(label)}` : '';
  return apiFetch(
    `/dictionaries/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/preview${params}`,
  );
}

export function getDictionaryTerms(
  kind: string,
  name: string,
  opts?: { label?: string; offset?: number; limit?: number; search?: string },
): Promise<DictionaryTermsPage> {
  const params = new URLSearchParams();
  if (opts?.label) params.set('label', opts.label);
  if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.search) params.set('search', opts.search);
  const qs = params.toString();
  return apiFetch(
    `/dictionaries/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/terms${qs ? `?${qs}` : ''}`,
  );
}

export async function uploadDictionary(
  file: File,
  kind: 'whitelist' | 'blacklist',
  name: string,
  label?: string,
): Promise<DictionaryUploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  form.append('name', name);
  if (label) form.append('label', label);

  const res = await fetch(`${apiBaseUrl()}/dictionaries`, {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? res.statusText);
  }
  return res.json();
}

export function deleteDictionary(
  kind: string,
  name: string,
  label?: string,
): Promise<void> {
  const params = label ? `?label=${encodeURIComponent(label)}` : '';
  return apiFetch(
    `/dictionaries/${encodeURIComponent(kind)}/${encodeURIComponent(name)}${params}`,
    { method: 'DELETE' },
  );
}
