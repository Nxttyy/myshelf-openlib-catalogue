/**
 * Thin fetch wrapper for the FastAPI backend. Auth rides on the httponly
 * `access_token` cookie, so requests are same-origin and need no headers.
 */

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed with ${status}`)
    this.status = status
    this.detail = detail
  }
}

type Json = Record<string, unknown> | unknown[]

async function request<T>(method: string, path: string, body?: Json): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new ApiError(res.status, (payload as { detail?: unknown }).detail ?? payload)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Json) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: Json) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
