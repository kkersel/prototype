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

app.use('/api', api)

// --- static client (production) ---------------------------------------------
if (PROD && fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  // SPA fallback for client-side routes (/editor, /play/:id, /heatmaps/:id)
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
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
