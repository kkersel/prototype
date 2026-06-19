import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as local from '../local'
import type { Action, Direction, Prototype, TapEvent, Transition } from '../types'
import { Button, Field, Icon, Input, Sheet, SheetItem, Spinner } from '../components/ui'

const uid = () => Math.random().toString(36).slice(2, 10)
const SWIPE_THRESHOLD = 40

const ANIM: Record<Transition, string> = {
  none: '',
  fade: 'anim-fade',
  'slide-left': 'anim-slide-left',
  'slide-right': 'anim-slide-right',
  'slide-up': 'anim-slide-up',
  'slide-down': 'anim-slide-down',
  'push-left': 'anim-push-left',
}

export function Player({
  prototype,
  onEvent,
}: {
  // When provided (paired terminal), play this doc and stream events to onEvent
  // instead of loading from / writing to the local store.
  prototype?: Prototype
  onEvent?: (ev: TapEvent) => void
} = {}) {
  const { id } = useParams()
  const nav = useNavigate()
  const [doc, setDoc] = useState<Prototype | null>(null)
  const [started, setStarted] = useState(false)
  const [session, setSession] = useState<{ id: string; participant: string; device: string } | null>(null)
  const [participant, setParticipant] = useState('')
  const [device, setDevice] = useState(() => localStorage.getItem('tp-device') || '')

  const [currentId, setCurrentId] = useState<string | null>(null)
  const [anim, setAnim] = useState('')
  const [animKey, setAnimKey] = useState(0)
  const history = useRef<string[]>([])

  const [box, setBox] = useState({ w: 0, h: 0, left: 0, top: 0 })
  const [menuOpen, setMenuOpen] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (prototype) setDoc(prototype)
    else if (id) local.getPrototype(id).then(setDoc).catch(() => {})
  }, [id, prototype])

  useEffect(() => {
    let lock: any
    const req = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen')
      } catch {}
    }
    if (started) req()
    const onVis = () => document.visibilityState === 'visible' && started && req()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.().catch?.(() => {})
    }
  }, [started])

  const current = doc?.screens.find((s) => s.id === currentId) || null

  const recomputeBox = useCallback(() => {
    if (!doc) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const aspect = doc.canvas.width / doc.canvas.height
    let w = vw
    let h = w / aspect
    if (h > vh) {
      h = vh
      w = h * aspect
    }
    setBox({ w, h, left: (vw - w) / 2, top: (vh - h) / 2 })
  }, [doc])

  useEffect(() => {
    recomputeBox()
    window.addEventListener('resize', recomputeBox)
    window.addEventListener('orientationchange', recomputeBox)
    return () => {
      window.removeEventListener('resize', recomputeBox)
      window.removeEventListener('orientationchange', recomputeBox)
    }
  }, [recomputeBox])

  const go = useCallback(
    (toId: string | null, transition: Transition = 'none', pushHistory = true) => {
      if (!toId) return
      if (pushHistory && currentId) history.current.push(currentId)
      setCurrentId(toId)
      setAnim(ANIM[transition] || '')
      setAnimKey((k) => k + 1)
    },
    [currentId]
  )

  const record = useCallback(
    (partial: Omit<TapEvent, 'id' | 'prototypeId' | 'sessionId' | 'participant' | 'device' | 'ts'>) => {
      if (!doc || !session) return
      const ev: TapEvent = {
        id: uid() + Date.now().toString(36),
        prototypeId: doc.id,
        sessionId: session.id,
        participant: session.participant,
        device: session.device,
        ts: Date.now(),
        ...partial,
      }
      if (onEvent) onEvent(ev)
      else local.appendEvents(ev.prototypeId, [ev]).catch(() => {})
    },
    [doc, session, onEvent]
  )

  const doAction = useCallback(
    (a: Action | null | undefined) => {
      if (!a || a.type === 'none') return
      if (a.type === 'back') {
        const prev = history.current.pop()
        if (prev) {
          setCurrentId(prev)
          setAnim(ANIM['slide-right'])
          setAnimKey((k) => k + 1)
        }
        return
      }
      go(a.toScreenId ?? null, a.transition ?? 'none')
    },
    [go]
  )

  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!down.current || !current) return
    const dx = e.clientX - down.current.x
    const dy = e.clientY - down.current.y
    const dist = Math.hypot(dx, dy)
    const start = down.current
    down.current = null

    if (dist >= SWIPE_THRESHOLD) {
      const dir: Direction =
        Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
      const norm = toBoxNorm(start.x, start.y)
      const act = current.swipes?.[dir]
      record({ x: norm.x, y: norm.y, hit: !!act, hotspotId: null, toScreenId: act?.toScreenId ?? null, kind: 'swipe', screenId: current.id })
      if (act) doAction(act)
      return
    }

    const norm = toBoxNorm(e.clientX, e.clientY)
    let hitHotspot = null as null | (typeof current.hotspots)[number]
    for (let i = current.hotspots.length - 1; i >= 0; i--) {
      const h = current.hotspots[i]
      if (norm.x >= h.x && norm.x <= h.x + h.w && norm.y >= h.y && norm.y <= h.y + h.h) {
        hitHotspot = h
        break
      }
    }
    record({
      x: norm.x,
      y: norm.y,
      hit: !!hitHotspot,
      hotspotId: hitHotspot?.id ?? null,
      toScreenId: hitHotspot?.action.toScreenId ?? null,
      kind: 'tap',
      screenId: current.id,
    })
    if (hitHotspot) doAction(hitHotspot.action)
  }

  const toBoxNorm = (clientX: number, clientY: number) => {
    const r = frameRef.current!.getBoundingClientRect()
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    }
  }

  useEffect(() => {
    if (!started || !current?.autoAdvance) return
    const { afterMs, action } = current.autoAdvance
    const t = setTimeout(() => {
      record({ x: 0.5, y: 0.5, hit: true, hotspotId: null, toScreenId: action.toScreenId ?? null, kind: 'timer', screenId: current.id })
      doAction(action)
    }, afterMs)
    return () => clearTimeout(t)
  }, [started, currentId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current
    if (!v || current?.media?.type !== 'video') return
    if (current.videoAutoplay) v.play().catch(() => {})
  }, [currentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {}
    localStorage.setItem('tp-device', device)
    setSession({ id: uid() + Date.now().toString(36), participant: participant.trim(), device: device.trim() })
    history.current = []
    setCurrentId(doc?.startScreenId || doc?.screens[0]?.id || null)
    setStarted(true)
    setMenuOpen(false)
  }

  const newSession = () => {
    setStarted(false)
    setSession(null)
    setParticipant('')
    setMenuOpen(false)
  }

  const restart = () => {
    history.current = []
    setCurrentId(doc?.startScreenId || doc?.screens[0]?.id || null)
    setAnim('')
    setAnimKey((k) => k + 1)
    setMenuOpen(false)
  }

  const downloadResults = async () => {
    const events = await local.readEvents(doc?.id || '')
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `results-${doc?.id || 'proto'}.json`
    a.click()
  }

  const pressTimer = useRef<number | null>(null)
  const onCornerDown = () => {
    pressTimer.current = window.setTimeout(() => setMenuOpen(true), 650)
  }
  const onCornerUp = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  if (!doc)
    return (
      <div className="player">
        <Spinner />
      </div>
    )
  if (doc.screens.length === 0)
    return (
      <div className="player">
        <div className="player__gate">
          <div className="player__gate-card" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Icon name="image" size={28} />
            <p className="muted" style={{ color: 'var(--player-text-dim)' }}>
              В прототипе нет экранов.
            </p>
            <Button variant="primary" onClick={() => nav(`/editor/${doc.id}`)}>
              Открыть редактор
            </Button>
          </div>
        </div>
      </div>
    )

  if (!started) {
    return (
      <div className="player">
        <div className="player__gate">
          <div className="player__gate-card">
            <div>
              <h2 style={{ fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-bold)' }}>{doc.name}</h2>
              <p style={{ color: 'var(--player-text-dim)', fontSize: 'var(--fs-ui)', marginTop: 4 }}>
                {doc.screens.length} экран(ов). Заполни метки (необязательно) и запускай тест.
              </p>
            </div>
            <Field>
              <Input
                placeholder="Участник / тестировщик"
                value={participant}
                onChange={(e) => setParticipant(e.target.value)}
              />
            </Field>
            <Field>
              <Input
                placeholder="Метка терминала (напр. «касса-1»)"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              />
            </Field>
            <Button variant="primary" icon="play" block onClick={begin} style={{ height: 'var(--control-h-lg)' }}>
              Запустить во весь экран
            </Button>
            <button
              className="btn btn--ghost"
              style={{ color: 'var(--player-text-dim)' }}
              onClick={() => nav('/')}
            >
              На главную
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="player">
      <div
        ref={frameRef}
        className="frame"
        style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div key={animKey} className={`media-layer ${anim}`}>
          {current?.media?.type === 'image' ? (
            <img src={current.media.url} draggable={false} />
          ) : current?.media?.type === 'video' ? (
            <video
              ref={videoRef}
              src={current.media.url}
              playsInline
              autoPlay={current.videoAutoplay}
              loop={current.videoLoop}
              onEnded={() => !current.videoLoop && doAction(current.onVideoEnd)}
            />
          ) : null}
        </div>
      </div>

      <button
        className="player__menu-corner"
        onPointerDown={onCornerDown}
        onPointerUp={onCornerUp}
        onPointerLeave={onCornerUp}
        aria-label="Меню оператора (долгое нажатие)"
      />

      <Sheet open={menuOpen} title="Меню оператора" onClose={() => setMenuOpen(false)}>
        <SheetItem icon="restart" onClick={restart}>
          Начать сначала
        </SheetItem>
        <SheetItem icon="user-plus" onClick={newSession}>
          Новая сессия / участник
        </SheetItem>
        <SheetItem icon="download" onClick={downloadResults}>
          Скачать результаты (.json)
        </SheetItem>
        <SheetItem icon="target" onClick={() => nav(`/heatmaps/${doc.id}`)}>
          Тепловые карты
        </SheetItem>
        <SheetItem
          icon="expand"
          onClick={() => {
            document.exitFullscreen?.().catch(() => {})
            setMenuOpen(false)
          }}
        >
          Выйти из полноэкранного
        </SheetItem>
      </Sheet>
    </div>
  )
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}
