// Laptop (host) side of pairing, as an APP-WIDE SINGLETON so the session survives
// route changes — the moderator can turn it on, then keep editing prototypes
// without dropping the terminal. While live, it publishes the local prototype
// list to the server (so terminals can discover and pick), and on request it
// streams the chosen prototype + its media over the relay. Incoming player events
// are written straight into the local store.
import * as local from './local'
import { makeId, post } from './pair'
import type { TapEvent } from './types'

export type BroadcastStatus = 'off' | 'starting' | 'live' | 'serving' | 'error'
export interface BroadcastState {
  status: BroadcastStatus
  hostId: string | null
  viewing: string | null // name of the prototype currently being served
  eventsReceived: number // new events received this session (after dedup)
}

let state: BroadcastState = { status: 'off', hostId: null, viewing: null, eventsReceived: 0 }
const listeners = new Set<(s: BroadcastState) => void>()
function set(patch: Partial<BroadcastState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l(state)
}
export function getState(): BroadcastState {
  return state
}
export function subscribe(cb: (s: BroadcastState) => void): () => void {
  listeners.add(cb)
  cb(state)
  return () => {
    listeners.delete(cb)
  }
}

let hostId: string | null = null
let es: EventSource | null = null
let announceTimer: number | null = null
let serving = false

// Publish (or refresh) the list of local prototypes terminals can choose from.
async function announce() {
  if (!hostId) return
  try {
    const list = await local.listPrototypes()
    await fetch(`/pair/${hostId}/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ноутбук',
        prototypes: list.map((p) => ({ id: p.id, name: p.name, screenCount: p.screenCount })),
      }),
    })
  } catch {}
}

// Stream a chosen prototype (doc + media blobs) to the terminal.
async function serve(prototypeId: string) {
  if (!hostId || serving) return
  serving = true
  const id = hostId
  try {
    const doc = await local.getPrototype(prototypeId)
    if (!doc) return
    set({ status: 'serving', viewing: doc.name })
    await fetch(`/pair/${id}/media`, { method: 'DELETE' }).catch(() => {}) // free the previous scenario's media
    const clean = structuredClone(doc)
    const media: { mediaId: string; type: 'image' | 'video'; mime?: string; name?: string; buf: ArrayBuffer }[] = []
    for (const s of clean.screens) {
      const mid = s.media?.mediaId
      if (s.media) delete s.media.url
      if (mid) {
        const m = await local.mediaBlob(mid)
        if (m) media.push({ mediaId: mid, type: m.type, mime: m.mime, name: m.name, buf: await m.blob.arrayBuffer() })
      }
    }
    await post(id, 'host', { t: 'scenario', doc: clean, mediaCount: media.length })
    for (const m of media) {
      await fetch(`/pair/${id}/media/${m.mediaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': m.mime || 'application/octet-stream' },
        body: m.buf,
      })
      await post(id, 'host', { t: 'media', mediaId: m.mediaId, mtype: m.type, mime: m.mime, name: m.name })
    }
    await post(id, 'host', { t: 'scenario-end' })
  } catch {
    // Terminal will time out and can retry by tapping again.
  } finally {
    serving = false
  }
}

export function start() {
  if (hostId) return
  hostId = makeId()
  set({ status: 'starting', hostId })
  es = new EventSource(`/pair/${hostId}/host/sse`)
  es.onopen = () => {
    set({ status: 'live' })
    announce()
  }
  es.onmessage = (e) => {
    let msg: { t?: string; prototypeId?: string; events?: TapEvent[] }
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    if (msg.t === 'request' && msg.prototypeId) {
      serve(msg.prototypeId)
    } else if (msg.t === 'events' && Array.isArray(msg.events)) {
      const byId: Record<string, TapEvent[]> = {}
      for (const ev of msg.events) if (ev?.prototypeId) (byId[ev.prototypeId] ||= []).push(ev)
      for (const [pid, evs] of Object.entries(byId)) {
        local
          .appendEvents(pid, evs)
          .then(({ added }) => {
            if (added) set({ eventsReceived: state.eventsReceived + added })
          })
          .catch(() => {})
      }
    }
  }
  // The list can change while live (new prototype, rename) — refresh periodically.
  announceTimer = window.setInterval(announce, 5000)
}

export function stop() {
  if (announceTimer) {
    clearInterval(announceTimer)
    announceTimer = null
  }
  es?.close()
  es = null
  if (hostId) {
    try {
      fetch(`/pair/${hostId}`, { method: 'DELETE', keepalive: true })
    } catch {}
  }
  hostId = null
  serving = false
  set({ status: 'off', hostId: null, viewing: null })
}
