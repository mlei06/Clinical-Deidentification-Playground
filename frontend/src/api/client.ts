const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

export function apiBaseUrl(): string {
  return BASE_URL;
}

/** Merge auth + default headers. Exported so multipart uploads that must set
 *  their own Content-Type (or leave it to the browser for FormData) can still
 *  attach the API key. */
export function authHeaders(extra?: HeadersInit): HeadersInit {
  const merged: Record<string, string> = {};
  if (extra) {
    const iter =
      extra instanceof Headers
        ? Array.from(extra.entries())
        : Array.isArray(extra)
          ? extra
          : Object.entries(extra);
    for (const [k, v] of iter) merged[k] = v;
  }
  if (API_KEY) merged['X-API-Key'] = API_KEY;
  return merged;
}

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
