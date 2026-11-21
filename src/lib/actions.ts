import { getAuthToken } from 'deepspace'

/** Call a server action from src/actions/index.ts. Throws with the server's error message on failure. */
export async function callAction(name: string, params: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string }
  if (!res.ok || body.success === false) throw new Error(body.error ?? `Request failed (${res.status})`)
}
