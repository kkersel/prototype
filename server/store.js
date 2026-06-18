// Tiny file-based store. No native deps, transparent on disk, trivial to back
// up and to merge offline-collected results into.
//
//   data/prototypes/<id>.json      one prototype document
//   data/events/<protoId>.ndjson   append-only tap log (one JSON object/line)
//   data/uploads/<file>            uploaded images & videos
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, '..', 'data')
export const PROTO_DIR = path.join(DATA_DIR, 'prototypes')
export const EVENT_DIR = path.join(DATA_DIR, 'events')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

for (const dir of [DATA_DIR, PROTO_DIR, EVENT_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}

const protoPath = (id) => path.join(PROTO_DIR, `${safeId(id)}.json`)
const eventPath = (id) => path.join(EVENT_DIR, `${safeId(id)}.ndjson`)

function safeId(id) {
  // ids come from nanoid (server) or client; keep them filename-safe.
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '')
}

export async function listPrototypes() {
  const files = await fsp.readdir(PROTO_DIR).catch(() => [])
  const out = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const doc = JSON.parse(await fsp.readFile(path.join(PROTO_DIR, f), 'utf8'))
      out.push({
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        screenCount: Array.isArray(doc.screens) ? doc.screens.length : 0,
      })
    } catch {
      /* skip corrupt file */
    }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

export async function getPrototype(id) {
  try {
    return JSON.parse(await fsp.readFile(protoPath(id), 'utf8'))
  } catch {
    return null
  }
}

export async function savePrototype(doc) {
  doc.updatedAt = Date.now()
  await fsp.writeFile(protoPath(doc.id), JSON.stringify(doc, null, 2))
  return doc
}

export async function deletePrototype(id) {
  await fsp.rm(protoPath(id), { force: true })
  await fsp.rm(eventPath(id), { force: true })
}

// --- events -----------------------------------------------------------------

export async function appendEvents(prototypeId, events) {
  if (!events?.length) return { added: 0 }
  // Dedup against existing ids (re-imports / retried syncs) AND within this
  // batch so the same event id is never written twice.
  const seen = await readEventIds(prototypeId)
  const fresh = []
  for (const e of events) {
    if (!e || !e.id || seen.has(e.id)) continue
    seen.add(e.id)
    fresh.push(e)
  }
  if (!fresh.length) return { added: 0 }
  const lines = fresh.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fsp.appendFile(eventPath(prototypeId), lines)
  return { added: fresh.length }
}

async function readEventIds(prototypeId) {
  const set = new Set()
  await forEachEvent(prototypeId, (e) => {
    if (e.id) set.add(e.id)
  })
  return set
}

export async function readEvents(prototypeId, { screenId, sessions } = {}) {
  const sessionSet = sessions && sessions.length ? new Set(sessions) : null
  const out = []
  await forEachEvent(prototypeId, (e) => {
    if (screenId && e.screenId !== screenId) return
    if (sessionSet && !sessionSet.has(e.sessionId)) return
    out.push(e)
  })
  return out
}

export async function listSessions(prototypeId) {
  const map = new Map() // sessionId -> { sessionId, participant, device, count, firstTs, lastTs }
  await forEachEvent(prototypeId, (e) => {
    let s = map.get(e.sessionId)
    if (!s) {
      s = {
        sessionId: e.sessionId,
        participant: e.participant || '',
        device: e.device || '',
        count: 0,
        firstTs: e.ts,
        lastTs: e.ts,
      }
      map.set(e.sessionId, s)
    }
    s.count++
    if (e.participant) s.participant = e.participant
    if (e.device) s.device = e.device
    if (e.ts < s.firstTs) s.firstTs = e.ts
    if (e.ts > s.lastTs) s.lastTs = e.ts
  })
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
}

async function forEachEvent(prototypeId, cb) {
  let raw
  try {
    raw = await fsp.readFile(eventPath(prototypeId), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      cb(JSON.parse(line))
    } catch {
      /* skip bad line */
    }
  }
}
