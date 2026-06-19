// Local-first store. The laptop's browser is the source of truth: prototypes,
// media blobs, and result events all live in IndexedDB — no server. Mirrors the
// api.ts surface so pages swap api.* → local.* with minimal change.
//
// Media: blobs are stored once and addressed by `mediaId`. `media.url` is a
// runtime object URL, hydrated on getPrototype()/listPrototypes() and cached, so
// the rest of the app keeps using `screen.media.url` unchanged.
import type { Media, MediaType, Prototype, PrototypeSummary, SessionInfo, TapEvent } from './types'

const DB_NAME = 'terminal-prototyper-local'
const VERSION = 1
const PROTOS = 'prototypes'
const MEDIA = 'media'
const EVENTS = 'events'

const rid = (): string =>
  (crypto as Crypto).randomUUID?.().replace(/-/g, '').slice(0, 16) ||
  Math.random().toString(36).slice(2) + Date.now().toString(36)

let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROTOS)) db.createObjectStore(PROTOS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(EVENTS)) {
        const os = db.createObjectStore(EVENTS, { keyPath: 'id' })
        os.createIndex('prototypeId', 'prototypeId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function reqAsync<T>(make: (db: IDBDatabase) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const r = make(db)
        r.onsuccess = () => resolve(r.result as T)
        r.onerror = () => reject(r.error)
      })
  )
}
const put = (store: string, value: unknown) =>
  reqAsync<IDBValidKey>((db) => db.transaction(store, 'readwrite').objectStore(store).put(value))
const get = <T>(store: string, key: IDBValidKey) =>
  reqAsync<T | undefined>((db) => db.transaction(store, 'readonly').objectStore(store).get(key))
const getAll = <T>(store: string) =>
  reqAsync<T[]>((db) => db.transaction(store, 'readonly').objectStore(store).getAll())
const del = (store: string, key: IDBValidKey) =>
  reqAsync<undefined>((db) => db.transaction(store, 'readwrite').objectStore(store).delete(key))

// ---- media ------------------------------------------------------------------
interface StoredMedia {
  id: string
  blob: Blob
  type: MediaType
  name?: string
  mime?: string
}

const urlCache = new Map<string, string>()

/** Store an uploaded file locally; returns a Media descriptor (with object URL). */
export async function addMedia(file: File): Promise<Media> {
  const id = rid()
  const type: MediaType = file.type.startsWith('video') ? 'video' : 'image'
  await put(MEDIA, { id, blob: file, type, name: file.name, mime: file.type } as StoredMedia)
  const url = URL.createObjectURL(file)
  urlCache.set(id, url)
  return { type, mediaId: id, url, name: file.name, mime: file.type }
}

/** Object URL for a stored media blob (cached). */
export async function mediaURL(mediaId: string): Promise<string | undefined> {
  const cached = urlCache.get(mediaId)
  if (cached) return cached
  const m = await get<StoredMedia>(MEDIA, mediaId)
  if (!m) return undefined
  const url = URL.createObjectURL(m.blob)
  urlCache.set(mediaId, url)
  return url
}

/** Raw blob for a stored media (used to transfer to a paired terminal). */
export function mediaBlob(mediaId: string): Promise<StoredMedia | undefined> {
  return get<StoredMedia>(MEDIA, mediaId)
}

async function hydrateMedia(media: Media | null | undefined): Promise<void> {
  if (media?.mediaId && !media.url) media.url = await mediaURL(media.mediaId)
}

// Strip the transient object URL before persisting (only mediaId is durable).
function dehydrate(doc: Prototype): Prototype {
  const copy = structuredClone(doc)
  for (const s of copy.screens) if (s.media) delete s.media.url
  return copy
}

// ---- prototypes -------------------------------------------------------------
export async function listPrototypes(): Promise<PrototypeSummary[]> {
  const docs = await getAll<Prototype>(PROTOS)
  const out: PrototypeSummary[] = []
  for (const d of docs) {
    const cover = d.screens.find((s) => s.id === d.startScreenId) || d.screens[0]
    out.push({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      screenCount: d.screens.length,
      thumb: cover?.media?.mediaId ? (await mediaURL(cover.media.mediaId)) || null : null,
      thumbType: cover?.media?.type || null,
    })
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export async function getPrototype(id: string): Promise<Prototype | null> {
  const doc = await get<Prototype>(PROTOS, id)
  if (!doc) return null
  for (const s of doc.screens) await hydrateMedia(s.media)
  return doc
}

export async function savePrototype(doc: Prototype): Promise<Prototype> {
  doc.updatedAt = Date.now()
  await put(PROTOS, dehydrate(doc))
  return doc
}

export async function createPrototype(
  name: string,
  canvas: { width: number; height: number }
): Promise<Prototype> {
  const now = Date.now()
  const doc: Prototype = {
    id: rid().slice(0, 10),
    name: name.slice(0, 120),
    createdAt: now,
    updatedAt: now,
    canvas,
    startScreenId: null,
    screens: [],
  }
  await put(PROTOS, doc)
  return doc
}

export async function deletePrototype(id: string): Promise<void> {
  const doc = await get<Prototype>(PROTOS, id)
  if (doc) {
    for (const s of doc.screens) {
      if (s.media?.mediaId) {
        await del(MEDIA, s.media.mediaId)
        const u = urlCache.get(s.media.mediaId)
        if (u) {
          URL.revokeObjectURL(u)
          urlCache.delete(s.media.mediaId)
        }
      }
    }
  }
  await del(PROTOS, id)
  // drop this prototype's events
  const evs = await readEvents(id)
  await Promise.all(evs.map((e) => del(EVENTS, e.id)))
}

// Import a prototype document. Media blobs (when provided as {mediaId, blob})
// are stored; a fresh id is minted so import never clobbers.
export async function importPrototype(
  prototype: Prototype,
  blobs?: Record<string, Blob>
): Promise<Prototype> {
  const now = Date.now()
  const doc: Prototype = {
    ...structuredClone(prototype),
    id: rid().slice(0, 10),
    name: `${prototype.name || 'Импорт'} (копия)`.slice(0, 120),
    createdAt: now,
    updatedAt: now,
  }
  if (blobs) {
    for (const s of doc.screens) {
      const mid = s.media?.mediaId
      if (mid && blobs[mid] && s.media) {
        await put(MEDIA, {
          id: mid,
          blob: blobs[mid],
          type: s.media.type,
          name: s.media.name,
          mime: s.media.mime,
        } as StoredMedia)
      }
      if (s.media) delete s.media.url
    }
  }
  await put(PROTOS, doc)
  return doc
}

// ---- events / results -------------------------------------------------------
/** Append events (dedup by id). Returns how many were newly added. */
export async function appendEvents(prototypeId: string, events: TapEvent[]): Promise<{ added: number }> {
  if (!events?.length) return { added: 0 }
  const db = await open()
  return new Promise((resolve, reject) => {
    const store = db.transaction(EVENTS, 'readwrite').objectStore(EVENTS)
    let added = 0
    let pending = 0
    let done = false
    const finish = () => {
      if (done) return
      done = true
      store.transaction.oncomplete = () => resolve({ added })
      store.transaction.onerror = () => reject(store.transaction.error)
    }
    for (const e of events) {
      if (!e?.id) continue
      pending++
      const ev = { ...e, prototypeId }
      const g = store.get(e.id)
      g.onsuccess = () => {
        if (!g.result) {
          store.add(ev)
          added++
        }
        if (--pending === 0) finish()
      }
      g.onerror = () => {
        if (--pending === 0) finish()
      }
    }
    if (pending === 0) finish()
  })
}

export async function readEvents(
  prototypeId: string,
  opts: { screen?: string; sessions?: string[] } = {}
): Promise<TapEvent[]> {
  const all = await reqAsync<TapEvent[]>((db) =>
    db.transaction(EVENTS, 'readonly').objectStore(EVENTS).index('prototypeId').getAll(prototypeId)
  )
  const sessionSet = opts.sessions?.length ? new Set(opts.sessions) : null
  return all.filter((e) => {
    if (opts.screen && e.screenId !== opts.screen) return false
    if (sessionSet && !sessionSet.has(e.sessionId)) return false
    return true
  })
}

export async function listSessions(prototypeId: string): Promise<SessionInfo[]> {
  const all = await readEvents(prototypeId)
  const map = new Map<string, SessionInfo>()
  for (const e of all) {
    let s = map.get(e.sessionId)
    if (!s) {
      s = { sessionId: e.sessionId, participant: e.participant || '', device: e.device || '', count: 0, firstTs: e.ts, lastTs: e.ts }
      map.set(e.sessionId, s)
    }
    s.count++
    if (e.participant) s.participant = e.participant
    if (e.device) s.device = e.device
    if (e.ts < s.firstTs) s.firstTs = e.ts
    if (e.ts > s.lastTs) s.lastTs = e.ts
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
}
