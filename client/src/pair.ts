// Laptop ↔ terminal pairing over the LOCAL network — no WebRTC, no external
// services, no code to type. Both devices open the laptop's own server URL
// (http://<ip>:5174); that server brokers a session "room" (see server/index.js
// `/pair`). The laptop (host) publishes its scenario list; a terminal discovers
// it via GET /pair/hosts and picks a scenario to run. Control messages go over
// SSE (server→client) + POST (client→server); media blobs travel as raw binary
// PUT/GET. Rock-solid on a shared Wi-Fi because the only thing in the middle is
// the laptop itself.
//
// This module holds the transport + the terminal (join) side. The laptop (host)
// side lives in broadcast.ts as an app-wide singleton (so it survives route
// changes while the moderator edits prototypes).
import type { Prototype, TapEvent } from './types'

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I
const ID_LEN = 6
/** A short, internal session id (never shown to the user — discovery is automatic). */
export function makeId(): string {
  let s = ''
  const a = crypto.getRandomValues(new Uint32Array(ID_LEN))
  for (let i = 0; i < ID_LEN; i++) s += ID_ALPHABET[a[i] % ID_ALPHABET.length]
  return s
}

/** POST a control message to the relay; the server forwards it to the peer role. */
export function post(code: string, role: 'host' | 'join', msg: unknown) {
  return fetch(`/pair/${code}/${role}/msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {})
}

export interface MediaPart {
  mediaId: string
  type: 'image' | 'video'
  mime?: string
  name?: string
  buf: ArrayBuffer
}

export interface HostInfo {
  hostId: string
  name: string
  prototypes: { id: string; name: string; screenCount: number }[]
}

export type JoinStatus = 'searching' | 'receiving' | 'ready' | 'error'

export interface JoinHandle {
  /** Ask a discovered host to stream a specific prototype. */
  request(hostId: string, prototypeId: string): void
  /** Stream a player event back to the host. */
  sendEvents(events: TapEvent[]): void
  /** Drop the current scenario, keep discovering (terminal returns to the list). */
  backToList(): void
  close(): void
}

// ---- terminal (join) --------------------------------------------------------
export function joinBroadcast(opts: {
  onHosts: (hosts: HostInfo[]) => void
  onScenario: (doc: Prototype, mediaBlobs: Record<string, Blob>) => void
  onStatus: (s: JoinStatus, info?: { received?: number; total?: number; reason?: string }) => void
}): JoinHandle {
  let closed = false
  let es: EventSource | null = null
  let curHost: string | null = null
  let curProto: string | null = null
  let receiving = false
  let watchdog: number | null = null
  const outbox: TapEvent[] = [] // all events this terminal produced; resent, host dedups by id

  // scenario assembly (reset per request)
  let doc: Prototype | null = null
  let total = 0
  let blobs: Record<string, Blob> = {}
  let pending: Promise<void>[] = []

  // --- discovery: poll for live laptops + their scenario lists ---
  const poll = async () => {
    if (closed) return
    try {
      const r = await fetch('/pair/hosts')
      const list = (await r.json()) as HostInfo[]
      if (!closed) opts.onHosts(Array.isArray(list) ? list : [])
    } catch {
      if (!closed) opts.onHosts([])
    }
  }
  poll()
  const pollTimer = window.setInterval(poll, 2500)

  const onData = (msg: { t?: string; doc?: Prototype; mediaCount?: number; mediaId?: string }) => {
    if (msg.t === 'scenario') {
      doc = msg.doc || null
      total = msg.mediaCount || 0
      pending = []
      blobs = {}
      opts.onStatus('receiving', { received: 0, total })
    } else if (msg.t === 'media' && msg.mediaId) {
      const id = msg.mediaId
      pending.push(
        fetch(`/pair/${curHost}/media/${id}`)
          .then((r) => r.blob())
          .then((b) => {
            blobs[id] = b
            opts.onStatus('receiving', { received: Object.keys(blobs).length, total })
          })
          .catch(() => {})
      )
    } else if (msg.t === 'scenario-end') {
      // Messages arrive in order, but media downloads are async — wait for them.
      Promise.all(pending).then(() => {
        if (closed || !receiving) return
        receiving = false
        if (watchdog) {
          clearTimeout(watchdog)
          watchdog = null
        }
        if (doc) {
          opts.onScenario(doc, blobs)
          opts.onStatus('ready')
        } else {
          opts.onStatus('error', { reason: 'bad-scenario' })
        }
      })
    }
  }

  const openSse = (hostId: string) => {
    if (curHost === hostId && es) return
    es?.close()
    curHost = hostId
    es = new EventSource(`/pair/${hostId}/join/sse`)
    es.onmessage = (e) => {
      try {
        onData(JSON.parse(e.data))
      } catch {}
    }
    es.onopen = () => {
      if (closed) return
      // Re-ask / re-deliver after any reconnect.
      if (receiving && curProto) post(hostId, 'join', { t: 'request', prototypeId: curProto })
      if (outbox.length) post(hostId, 'join', { t: 'events', events: outbox })
    }
  }

  // Resend the outbox periodically while running — the host dedups by id, so any
  // dropped message lands on the next tick.
  const resend = window.setInterval(() => {
    if (curHost && outbox.length) post(curHost, 'join', { t: 'events', events: outbox })
  }, 4000)

  return {
    request(hostId: string, prototypeId: string) {
      curProto = prototypeId
      receiving = true
      doc = null
      blobs = {}
      pending = []
      opts.onStatus('receiving', { received: 0, total: 0 })
      openSse(hostId)
      post(hostId, 'join', { t: 'request', prototypeId })
      if (watchdog) clearTimeout(watchdog)
      watchdog = window.setTimeout(() => {
        if (receiving && !closed) opts.onStatus('error', { reason: 'timeout' })
      }, 20000)
    },
    sendEvents(events: TapEvent[]) {
      outbox.push(...events)
      if (curHost) post(curHost, 'join', { t: 'events', events })
    },
    backToList() {
      receiving = false
      if (watchdog) {
        clearTimeout(watchdog)
        watchdog = null
      }
      doc = null
      curProto = null
    },
    close() {
      closed = true
      clearInterval(pollTimer)
      clearInterval(resend)
      if (watchdog) clearTimeout(watchdog)
      es?.close()
    },
  }
}
