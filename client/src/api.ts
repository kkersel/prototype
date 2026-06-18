import type { Prototype, PrototypeSummary, SessionInfo, TapEvent } from './types'

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const api = {
  listPrototypes: () => fetch('/api/prototypes').then((r) => j<PrototypeSummary[]>(r)),

  createPrototype: (name: string, canvas: { width: number; height: number }) =>
    fetch('/api/prototypes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, canvas }),
    }).then((r) => j<Prototype>(r)),

  getPrototype: (id: string) => fetch(`/api/prototypes/${id}`).then((r) => j<Prototype>(r)),

  savePrototype: (doc: Prototype) =>
    fetch(`/api/prototypes/${doc.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    }).then((r) => j<Prototype>(r)),

  deletePrototype: (id: string) =>
    fetch(`/api/prototypes/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),

  importPrototype: (prototype: Prototype) =>
    fetch('/api/prototypes/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prototype }),
    }).then((r) => j<Prototype>(r)),

  upload: async (file: File): Promise<{ url: string; type: 'image' | 'video'; name: string; mime: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    return j(res)
  },

  sendEvents: (prototypeId: string, events: TapEvent[]) =>
    fetch(`/api/prototypes/${prototypeId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
    }).then((r) => j<{ ok: boolean; added: number }>(r)),

  getEvents: (prototypeId: string, opts: { screen?: string; sessions?: string[] } = {}) => {
    const p = new URLSearchParams()
    if (opts.screen) p.set('screen', opts.screen)
    if (opts.sessions?.length) p.set('sessions', opts.sessions.join(','))
    const qs = p.toString()
    return fetch(`/api/prototypes/${prototypeId}/events${qs ? `?${qs}` : ''}`).then((r) =>
      j<TapEvent[]>(r)
    )
  },

  getSessions: (prototypeId: string) =>
    fetch(`/api/prototypes/${prototypeId}/sessions`).then((r) => j<SessionInfo[]>(r)),
}
