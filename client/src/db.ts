// Offline-first event queue. Every tap is written to IndexedDB immediately, then
// synced to the server when the network is available. This is what makes the
// player work "и так, и так": online it streams live; offline (or on a flaky
// terminal Wi-Fi) it queues and catches up later. Nothing is ever lost, and
// events can also be exported to a JSON file for manual transfer/merge.
import type { TapEvent } from './types'
import { api } from './api'

const DB_NAME = 'terminal-prototyper'
const STORE = 'events'
const VERSION = 1

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('synced', 'synced', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

interface StoredEvent extends TapEvent {
  synced: 0 | 1
}

export async function enqueue(event: TapEvent): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, 'readwrite').put({ ...event, synced: 0 } as StoredEvent)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function getAll(): Promise<StoredEvent[]> {
  return open().then(
    (db) =>
      new Promise<StoredEvent[]>((resolve, reject) => {
        const req = tx(db, 'readonly').getAll()
        req.onsuccess = () => resolve(req.result as StoredEvent[])
        req.onerror = () => reject(req.error)
      })
  )
}

async function markSynced(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite')
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
    for (const id of ids) {
      const g = store.get(id)
      g.onsuccess = () => {
        const v = g.result as StoredEvent | undefined
        if (v) {
          v.synced = 1
          store.put(v)
        }
      }
    }
  })
}

export async function pendingCount(): Promise<number> {
  return (await getAll()).filter((e) => e.synced === 0).length
}

/** Push all unsynced events to the server, grouped by prototype. */
export async function flush(): Promise<{ synced: number; pending: number }> {
  if (!navigator.onLine) {
    const pending = await pendingCount()
    return { synced: 0, pending }
  }
  const all = await getAll()
  const unsynced = all.filter((e) => e.synced === 0)
  if (!unsynced.length) return { synced: 0, pending: 0 }

  const byProto = new Map<string, StoredEvent[]>()
  for (const e of unsynced) {
    const list = byProto.get(e.prototypeId) || []
    list.push(e)
    byProto.set(e.prototypeId, list)
  }

  let synced = 0
  for (const [protoId, list] of byProto) {
    try {
      const clean = list.map(({ synced: _s, ...rest }) => rest as TapEvent)
      await api.sendEvents(protoId, clean)
      await markSynced(list.map((e) => e.id))
      synced += list.length
    } catch {
      // leave them queued; next flush retries
    }
  }
  return { synced, pending: await pendingCount() }
}

/** All locally stored events (for "Скачать результаты"). */
export async function exportAll(): Promise<TapEvent[]> {
  const all = await getAll()
  return all.map(({ synced: _s, ...rest }) => rest as TapEvent)
}

let timer: number | null = null
/** Start background sync: on interval, on reconnect, and immediately. */
export function startSync(intervalMs = 8000): () => void {
  const tick = () => {
    flush().catch(() => {})
  }
  tick()
  if (timer == null) timer = window.setInterval(tick, intervalMs)
  window.addEventListener('online', tick)
  return () => {
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
    window.removeEventListener('online', tick)
  }
}
