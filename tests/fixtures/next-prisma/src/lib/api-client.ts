export async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}${path}`, init)
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json()
}
