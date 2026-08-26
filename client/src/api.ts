// Thin fetch wrapper. In dev, Vite proxies /api to the .NET server;
// in production the SPA is served by the same server, so relative URLs work.

/** Error that keeps the status code and parsed body so callers can react to specific failures. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { /* plain-text error, keep body null */ }
    const parsed = body as { message?: string; title?: string } | null
    const message = parsed?.message || parsed?.title || text || `${res.status} ${res.statusText}`
    throw new ApiError(res.status, message, body)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => fetch(`/api/${path}`).then(handle<T>),

  post: <T>(path: string, body: unknown) =>
    fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle<T>),

  put: <T>(path: string, body: unknown) =>
    fetch(`/api/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handle<T>),

  del: (path: string) => fetch(`/api/${path}`, { method: 'DELETE' }).then(handle<void>),

  upload: <T>(path: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(`/api/${path}`, { method: 'POST', body: form }).then(handle<T>)
  },
}
