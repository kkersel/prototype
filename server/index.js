import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { nanoid } from 'nanoid'
import {
  DATA_DIR,
  UPLOAD_DIR,
  listPrototypes,
  getPrototype,
  savePrototype,
  deletePrototype,
  appendEvents,
  readEvents,
  deleteEvents,
  deleteEventsBySession,
  listSessions,
} from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 5174)
const PROD = process.env.NODE_ENV === 'production'

const app = express()
app.use(cors())
app.use(express.json({ limit: '64mb' })) // big enough for bulk event/import payloads

// --- uploads -----------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ''
    cb(null, `${nanoid(12)}${ext.toLowerCase()}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 512 * 1024 * 1024 }, // 512MB — videos can be large
})

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, { maxAge: PROD ? '7d' : 0, immutable: PROD })
)

// --- API ---------------------------------------------------------------------
const api = express.Router()

api.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

api.get('/prototypes', async (_req, res) => {
  res.json(await listPrototypes())
})

api.post('/prototypes', async (req, res) => {
  const now = Date.now()
  const doc = {
    id: nanoid(10),
    name: (req.body?.name || 'Новый прототип').toString().slice(0, 120),
    createdAt: now,
    updatedAt: now,
    canvas: req.body?.canvas || { width: 1080, height: 1080 },
    startScreenId: null,
    screens: [],
  }
  await savePrototype(doc)
  res.status(201).json(doc)
})

// Import a full prototype document (from the editor's export). A new id is
// minted so importing never clobbers an existing prototype.
api.post('/prototypes/import', async (req, res) => {
  const incoming = req.body?.prototype
  if (!incoming || !Array.isArray(incoming.screens)) {
    return res.status(400).json({ error: 'bad prototype document' })
  }
  const now = Date.now()
  const doc = {
    ...incoming,
    id: nanoid(10),
    name: `${incoming.name || 'Импорт'} (копия)`.slice(0, 120),
    createdAt: now,
    updatedAt: now,
  }
  await savePrototype(doc)
  res.status(201).json(doc)
})

api.get('/prototypes/:id', async (req, res) => {
  const doc = await getPrototype(req.params.id)
  if (!doc) return res.status(404).json({ error: 'not found' })
  res.json(doc)
})

api.put('/prototypes/:id', async (req, res) => {
  const existing = await getPrototype(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not found' })
  const doc = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt }
  await savePrototype(doc)
  res.json(doc)
})

api.delete('/prototypes/:id', async (req, res) => {
  await deletePrototype(req.params.id)
  res.json({ ok: true })
})

api.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' })
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
    mime: req.file.mimetype,
    size: req.file.size,
  })
})

// --- events (heatmaps) -------------------------------------------------------
api.post('/prototypes/:id/events', async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : []
  // Stamp the prototype id server-side; trust client ids for dedup only.
  for (const e of events) e.prototypeId = req.params.id
  const result = await appendEvents(req.params.id, events)
  res.json({ ok: true, ...result })
})

api.get('/prototypes/:id/events', async (req, res) => {
  const sessions = req.query.sessions
    ? String(req.query.sessions).split(',').filter(Boolean)
    : undefined
  const events = await readEvents(req.params.id, {
    screenId: req.query.screen ? String(req.query.screen) : undefined,
    sessions,
  })
  res.json(events)
})

api.get('/prototypes/:id/sessions', async (req, res) => {
  res.json(await listSessions(req.params.id))
})

api.delete('/prototypes/:id/events', async (req, res) => {
  if (Array.isArray(req.body?.ids)) {
    const result = await deleteEvents(req.params.id, req.body.ids)
    return res.json({ ok: true, ...result })
  }
  if (req.body?.sessionId) {
    const result = await deleteEventsBySession(req.params.id, req.body.sessionId)
    return res.json({ ok: true, ...result })
  }
  res.status(400).json({ error: 'provide ids or sessionId' })
})

app.use('/api', api)

// --- LAN pairing relay (laptop ↔ terminal over the local network) ------------
// No external services: the laptop's own server brokers a session "room".
// The laptop (host) opens an SSE stream and publishes its scenario list; any
// terminal (join) on the same Wi-Fi discovers it via GET /pair/hosts — no code
// to type. Picking a scenario streams it over: control messages via SSE+POST,
// media (images/video) as raw binary PUT/GET held in memory for the session.
// Replaces the old WebRTC path (PeerJS cloud + TURN), which was unreliable on
// real Wi-Fi. Both devices just open this server's LAN URL.
const rooms = new Map() // code -> { host, join, q:{host:[],join:[]}, media:Map }
const hosts = new Map() // code -> { name, prototypes:[{id,name,screenCount}] } (live = room has host SSE)

function room(code) {
  let r = rooms.get(code)
  if (!r) {
    r = { host: null, join: null, q: { host: [], join: [] }, media: new Map() }
    rooms.set(code, r)
  }
  return r
}
function sseSend(res, msg) {
  try {
    res.write(`data: ${JSON.stringify(msg)}\n\n`)
  } catch {}
}
function deliver(code, toRole, msg) {
  const r = room(code)
  if (r[toRole]) sseSend(r[toRole], msg)
  else r.q[toRole].push(msg) // peer not connected yet — queue until it is
}

const pair = express.Router()

// LAN URLs shown on the laptop (so the moderator knows what to open on a terminal).
pair.get('/info', (_req, res) => {
  res.json({ port: PORT, urls: lanAddresses().map((ip) => `http://${ip}:${PORT}`) })
})

// Terminals poll this to discover live laptops and their scenario lists. A host
// is "live" only while its SSE stream is connected.
pair.get('/hosts', (_req, res) => {
  const out = []
  for (const [code, h] of hosts) {
    // live (SSE connected) and has something to run — skip empty devices/terminals
    if (rooms.get(code)?.host && h.prototypes.length > 0)
      out.push({ hostId: code, name: h.name, prototypes: h.prototypes })
  }
  res.json(out)
})

// Laptop publishes / refreshes its scenario list under its session id.
pair.post('/:code/announce', (req, res) => {
  hosts.set(req.params.code, {
    name: typeof req.body?.name === 'string' ? req.body.name : '',
    prototypes: Array.isArray(req.body?.prototypes) ? req.body.prototypes : [],
  })
  res.json({ ok: true })
})

// Server→client stream. role ∈ {host, join}.
pair.get('/:code/:role/sse', (req, res) => {
  const { code, role } = req.params
  if (role !== 'host' && role !== 'join') return res.status(400).end()
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let any proxy buffer the stream
  })
  res.flushHeaders?.()
  res.write('retry: 2000\n\n')
  const r = room(code)
  try {
    r[role]?.end()
  } catch {} // drop any stale stream for this role (reconnect)
  r[role] = res
  const queued = r.q[role]
  r.q[role] = []
  for (const m of queued) sseSend(res, m)
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {}
  }, 20000)
  req.on('close', () => {
    clearInterval(ping)
    if (r[role] === res) r[role] = null
    // A host leaving takes its session down: drop it from discovery and free its
    // media. (The terminal's poll will then show it as gone.)
    if (role === 'host' && !r.host) {
      hosts.delete(code)
      r.media.clear()
      if (!r.join) rooms.delete(code)
    }
  })
})

// Client→server message; relayed to the other role.
pair.post('/:code/:role/msg', (req, res) => {
  const { code, role } = req.params
  if (role !== 'host' && role !== 'join') return res.status(400).end()
  deliver(code, role === 'host' ? 'join' : 'host', req.body)
  res.json({ ok: true })
})

// Media bytes: host uploads, terminal downloads. Raw binary, not JSON.
pair.put('/:code/media/:mediaId', express.raw({ type: () => true, limit: '512mb' }), (req, res) => {
  const r = room(req.params.code)
  r.media.set(req.params.mediaId, { buf: req.body, mime: req.get('Content-Type') || 'application/octet-stream' })
  res.json({ ok: true })
})

pair.get('/:code/media/:mediaId', (req, res) => {
  const m = rooms.get(req.params.code)?.media.get(req.params.mediaId)
  if (!m) return res.status(404).end()
  res.set('Content-Type', m.mime)
  res.send(m.buf)
})

// Host clears the previous scenario's media before streaming a freshly picked one.
pair.delete('/:code/media', (req, res) => {
  rooms.get(req.params.code)?.media.clear()
  res.json({ ok: true })
})

// Host tears the room down when the moderator closes the pairing dialog.
pair.delete('/:code', (req, res) => {
  const r = rooms.get(req.params.code)
  if (r) {
    try {
      r.host?.end()
    } catch {}
    try {
      r.join?.end()
    } catch {}
    rooms.delete(req.params.code)
  }
  res.json({ ok: true })
})

app.use('/pair', pair)

// --- static client (production) ---------------------------------------------
if (PROD && fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  // SPA fallback for client-side routes (/editor, /play/:id, /heatmaps/:id)
  app.get(/^(?!\/api|\/uploads|\/pair).*/, (_req, res) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else if (PROD) {
  app.get('/', (_req, res) =>
    res
      .status(503)
      .send('Сборка клиента не найдена. Выполни: npm run build, затем npm start')
  )
}

// --- listen (http, plus https if certs present) ------------------------------
function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

function banner(proto, port) {
  const ips = lanAddresses()
  console.log(`\n  Terminal Prototyper — сервер запущен (${proto})`)
  console.log(`  Локально:   ${proto}://localhost:${port}`)
  for (const ip of ips) console.log(`  Терминалы:  ${proto}://${ip}:${port}`)
  console.log(`  Данные:     ${DATA_DIR}\n`)
}

http.createServer(app).listen(PORT, '0.0.0.0', () => banner('http', PORT))

// Optional HTTPS for a valid PWA/service-worker context over the LAN.
// Drop key.pem + cert.pem into data/certs (e.g. via `mkcert <your-ip>`).
const CERT_DIR = path.join(DATA_DIR, 'certs')
const keyPath = path.join(CERT_DIR, 'key.pem')
const certPath = path.join(CERT_DIR, 'cert.pem')
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1)
  https
    .createServer(
      { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
      app
    )
    .listen(HTTPS_PORT, '0.0.0.0', () => banner('https', HTTPS_PORT))
}
