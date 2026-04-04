interface ApiResponse<T = unknown> {
  status: number
  data: T | undefined
}

async function post<T = unknown>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { status: res.status, data: (await res.json()) as T }
  return { status: res.status, data: undefined }  // bug: body not parsed on 4xx
}

export const api = { post }
