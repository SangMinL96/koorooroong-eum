import { API_HOST } from './env';
import type { ApiResponse } from './types';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`api error ${status}`);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }
  const body = parsed as ApiResponse<T> | null;
  if (!body || typeof body !== 'object' || !('ok' in body)) {
    throw new ApiError(res.status, parsed);
  }
  if (body.ok !== true) {
    throw new ApiError(res.status, parsed);
  }
  return body.data;
}

/** JSON POST. */
export async function apiPostJson<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_HOST}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  return unwrap<T>(res);
}

/** multipart/form-data POST. `formData` is required. */
export async function apiPostMultipart<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  // NOTE: do NOT set Content-Type — the platform fetch sets the boundary automatically.
  console.log(`${API_HOST}/api${path}`);
  const res = await fetch(`${API_HOST}/api${path}`, {
    method: 'POST',
    body: formData as unknown as BodyInit,
    ...init,
  });
  return unwrap<T>(res);
}
