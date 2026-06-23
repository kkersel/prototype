// Server-backed store. The server (Express + file store in server/) is the
// single source of truth shared by everyone: editors author here, terminals
// play from here, and result events aggregate centrally — so colleagues on any
// network see the same scenarios just by opening the URL.
//
// Mirrors the local.ts surface so pages call store.* identically; the only
// difference from local-first is that data lives on the server, not this
// browser's IndexedDB. Media is uploaded to the server's disk and addressed by
// a durable /uploads URL (no object-URL hydration needed).
import { api } from './api'
import type { Media, Prototype, PrototypeSummary, SessionInfo, TapEvent } from './types'

// ---- prototypes -------------------------------------------------------------
export const listPrototypes = (): Promise<PrototypeSummary[]> => api.listPrototypes()
export const getPrototype = (id: string): Promise<Prototype> => api.getPrototype(id)
export const createPrototype = (name: string, canvas: { width: number; height: number }): Promise<Prototype> =>
  api.createPrototype(name, canvas)
export const savePrototype = (doc: Prototype): Promise<Prototype> => api.savePrototype(doc)
export const deletePrototype = (id: string): Promise<{ ok: boolean }> => api.deletePrototype(id)
export const importPrototype = (doc: Prototype): Promise<Prototype> => api.importPrototype(doc)

// ---- media ------------------------------------------------------------------
/** Upload a file to the server; returns a Media descriptor with a durable URL. */
export async function addMedia(file: File): Promise<Media> {
  const r = await api.upload(file)
  return { type: r.type, url: r.url, name: r.name, mime: r.mime }
}

// ---- events / results -------------------------------------------------------
export const appendEvents = (prototypeId: string, events: TapEvent[]): Promise<{ added: number }> =>
  api.sendEvents(prototypeId, events) as Promise<{ added: number }>
export const readEvents = (
  prototypeId: string,
  opts: { screen?: string; sessions?: string[] } = {}
): Promise<TapEvent[]> => api.getEvents(prototypeId, opts)
export const listSessions = (prototypeId: string): Promise<SessionInfo[]> => api.getSessions(prototypeId)
export const deleteEvents = (prototypeId: string, opts: { ids?: string[]; sessionId?: string }): Promise<{ deleted: number }> =>
  api.deleteEvents(prototypeId, opts)
