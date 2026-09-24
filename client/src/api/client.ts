// Thin fetch wrapper. Cookies carry the session (httpOnly), so no tokens live in JS.
import { PANE } from '../lib/viewAs';
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(PANE ? { 'X-BR-View-As': PANE } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || 'generic');
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T,>(p: string, b?: unknown) => request<T>('DELETE', p, b ?? {}),
};

/** Translation key for an API error code (falls back to the generic message). */
export const errorKey = (e: unknown) => (e instanceof ApiError ? `errors.${e.code}` : 'errors.generic');
