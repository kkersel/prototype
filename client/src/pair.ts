// Laptop ↔ terminal pairing over WebRTC (PeerJS). The laptop hosts a session
// under a short code; the terminal joins by code. Same Wi-Fi → the data channel
// connects directly (no TURN). PeerJS's cloud only brokers the SDP/ICE handshake;
// the scenario (prototype + media blobs) and the click events travel P2P.
import Peer, { type DataConnection } from 'peerjs'
import type { Prototype, TapEvent } from './types'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I
const CODE_LEN = 6
function makeCode(): string {
  let s = ''
  const a = crypto.getRandomValues(new Uint32Array(CODE_LEN))
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[a[i] % CODE_ALPHABET.length]
  return s
}

// PeerJS namespaces ids globally on its public server; prefix to avoid clashes
// with other apps using short codes.
const NS = 'tproto-'
const peerId = (code: string) => NS + code

// STUN finds the direct path; the free TURN relays packets when the network
// blocks P2P (AP/client isolation, symmetric NAT) — common on phone/guest Wi-Fi.
// On a clean LAN the connection stays direct; TURN is only a fallback.
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
}

export type HostStatus = 'starting' | 'waiting' | 'connected' | 'sending' | 'ready' | 'error'
export type JoinStatus = 'connecting' | 'receiving' | 'ready' | 'lost' | 'error'

export interface MediaPart {
  mediaId: string
  type: 'image' | 'video'
  mime?: string
  name?: string
  buf: ArrayBuffer
}

export interface HostHandle {
  code: string
  close(): void
}

// ---- laptop (host) ----------------------------------------------------------
export function startHost(opts: {
  getScenario: () => Promise<{ doc: Prototype; media: MediaPart[] }>
  onStatus: (s: HostStatus, info?: { sent?: number; total?: number }) => void
  onEvents: (events: TapEvent[]) => void
}): HostHandle {
  let peer: Peer
  let closed = false
  const handle: HostHandle = { code: makeCode(), close: () => {} }

  const sendScenario = async (conn: DataConnection) => {
    const { doc, media } = await opts.getScenario()
    conn.send({ t: 'scenario', doc, mediaCount: media.length })
    let sent = 0
    for (const m of media) {
      opts.onStatus('sending', { sent, total: media.length })
      conn.send({ t: 'media', mediaId: m.mediaId, mtype: m.type, mime: m.mime, name: m.name, buf: m.buf })
      sent++
    }
    conn.send({ t: 'scenario-end' })
    opts.onStatus('ready', { sent, total: media.length })
  }

  const boot = (code: string) => {
    handle.code = code
    peer = new Peer(peerId(code), PEER_OPTS)
    handle.close = () => {
      closed = true
      try {
        peer.destroy()
      } catch {}
    }
    peer.on('open', () => !closed && opts.onStatus('waiting'))
    peer.on('error', (err: { type?: string }) => {
      if (closed) return
      if (err?.type === 'unavailable-id') {
        try {
          peer.destroy()
        } catch {}
        boot(makeCode()) // code taken — pick another
      } else {
        opts.onStatus('error')
      }
    })
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        opts.onStatus('connected')
        sendScenario(conn).catch(() => opts.onStatus('error'))
      })
      conn.on('data', (raw) => {
        const msg = raw as { t?: string; events?: TapEvent[] }
        if (msg?.t === 'events' && Array.isArray(msg.events)) opts.onEvents(msg.events)
      })
      conn.on('close', () => !closed && opts.onStatus('waiting'))
    })
  }

  opts.onStatus('starting')
  boot(handle.code)
  return handle
}

// ---- terminal (join) --------------------------------------------------------
export interface JoinHandle {
  sendEvents(events: TapEvent[]): void
  close(): void
}

export function joinHost(
  code: string,
  opts: {
    onScenario: (doc: Prototype, mediaBlobs: Record<string, Blob>) => void
    onStatus: (s: JoinStatus, info?: { received?: number; total?: number; reason?: string }) => void
  }
): JoinHandle {
  let peer: Peer
  let conn: DataConnection | null = null
  let closed = false
  const outbox: TapEvent[] = [] // all session events; resent on (re)connect, laptop dedups by id

  // scenario assembly
  let doc: Prototype | null = null
  let total = 0
  const blobs: Record<string, Blob> = {}

  const wireConn = (c: DataConnection) => {
    conn = c
    c.on('open', () => {
      opts.onStatus('connecting')
      c.send({ t: 'hello' })
      if (outbox.length) c.send({ t: 'events', events: outbox }) // resend after a reconnect
    })
    c.on('data', (raw) => {
      const msg = raw as {
        t?: string
        doc?: Prototype
        mediaCount?: number
        mediaId?: string
        mtype?: 'image' | 'video'
        mime?: string
        buf?: ArrayBuffer
      }
      if (msg?.t === 'scenario') {
        doc = msg.doc || null
        total = msg.mediaCount || 0
        opts.onStatus('receiving', { received: 0, total })
      } else if (msg?.t === 'media' && msg.mediaId && msg.buf) {
        blobs[msg.mediaId] = new Blob([msg.buf], { type: msg.mime || '' })
        opts.onStatus('receiving', { received: Object.keys(blobs).length, total })
      } else if (msg?.t === 'scenario-end') {
        if (doc) {
          gotScenario = true
          clearTimeout(watchdog)
          opts.onScenario(doc, blobs)
          opts.onStatus('ready')
        } else {
          opts.onStatus('error', { reason: 'bad-scenario' })
        }
      }
    })
    c.on('close', () => !closed && opts.onStatus('lost'))
    c.on('error', () => !closed && opts.onStatus('lost'))
  }

  const connect = () => {
    if (closed) return
    // Default DataConnection: the raw RTCDataChannel is already reliable + ordered
    // and PeerJS chunks large binary (video). PeerJS's `reliable: true` shim is
    // flaky and was dropping later app messages — don't use it.
    conn = peer.connect(peerId(code))
    wireConn(conn)
  }

  let gotScenario = false
  // If nothing arrives in time, the network is likely blocking P2P — surface it
  // instead of hanging on "Подключаемся…".
  const watchdog = window.setTimeout(() => {
    if (!gotScenario && !closed) opts.onStatus('error', { reason: 'timeout' })
  }, 25000)

  peer = new Peer(undefined as unknown as string, PEER_OPTS)
  peer.on('open', connect)
  peer.on('error', (e: { type?: string }) => !closed && opts.onStatus('error', { reason: e?.type || 'peer' }))
  peer.on('disconnected', () => {
    if (!closed) {
      try {
        peer.reconnect()
      } catch {}
    }
  })

  const send = (events: TapEvent[]) => {
    if (conn && conn.open && events.length) {
      try {
        conn.send({ t: 'events', events })
      } catch {}
    }
  }
  // Periodically resend the whole outbox while connected — the laptop dedups by
  // event id, so any dropped/lost message is delivered on the next tick.
  const resend = window.setInterval(() => send(outbox), 4000)

  return {
    sendEvents(events: TapEvent[]) {
      outbox.push(...events)
      send(events)
    },
    close() {
      closed = true
      clearInterval(resend)
      clearTimeout(watchdog)
      try {
        peer.destroy()
      } catch {}
    },
  }
}
