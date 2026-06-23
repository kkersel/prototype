import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as store from '../../store'
import { drawHeatmap } from '../../heatmap'
import { buildResultsHtml, exportResultsDeck } from '../../export'
import type { Prototype, SessionInfo, TapEvent } from '../../types'
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Modal, Segmented, Slider, toast, type SegmentOption } from '../../components/ui'

type Mode = 'heat' | 'dots'
type Filter = 'all' | 'hit' | 'miss'

const SESSION_COLORS = ['#0d99ff', '#12a150', '#d98c12', '#e5484d', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']
const MODE_OPTIONS: SegmentOption<Mode>[] = [
  { value: 'heat', label: 'Тепло', icon: 'target' },
  { value: 'dots', label: 'Точки', icon: 'eye' },
]
const FILTER_OPTIONS: SegmentOption<Filter>[] = [
  { value: 'all', label: 'Все' },
  { value: 'hit', label: 'По зонам' },
  { value: 'miss', label: 'Мимо' },
]

// Heatmaps as an editor view. Returns three grid children (left screen list,
// center canvas, right controls) so it slots straight into the editor grid —
// the prototype doc and the selected screen are shared with the editor, so
// switching the Холст / Экран / Карты tabs keeps your place.
export function HeatmapsView({
  doc,
  selScreen,
  selHotspot,
  onSelectScreen,
  onSelectHotspot,
  onUpdateHotspot,
}: {
  doc: Prototype
  selScreen: string | null
  selHotspot: string | null
  onSelectScreen: (id: string) => void
  onSelectHotspot: (id: string | null) => void
  onUpdateHotspot: (screenId: string, hotspotId: string, label: string) => void
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selSessions, setSelSessions] = useState<Set<string>>(new Set())
  const [allSessions, setAllSessions] = useState(true)
  const [events, setEvents] = useState<TapEvent[]>([])
  const [mode, setMode] = useState<Mode>('heat')
  const [filter, setFilter] = useState<Filter>('all')
  const [radius, setRadius] = useState(30)
  const initDone = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const [selEvents, setSelEvents] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<'events' | 'session' | null>(null)
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    if (editingLabel && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
    }
  }, [editingLabel])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const roRef = useRef<ResizeObserver | null>(null)
  const wrapCb = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
    measure()
  }, [])

  const loadSessions = useCallback(() => {
    store.listSessions(doc.id).then(setSessions).catch(() => {})
  }, [doc.id])
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // Live updates: the server is the shared source of truth, so poll for new
  // sessions while this view is open — taps streamed in from terminals appear
  // within a few seconds. Re-reading sessions cascades to the events reload +
  // canvas redraw below; the manual «Обновить» button forces an immediate pull.
  useEffect(() => {
    const t = setInterval(loadSessions, 4000)
    return () => clearInterval(t)
  }, [loadSessions])

  useEffect(() => {
    if (!selScreen) return
    const sessionIds = allSessions ? undefined : [...selSessions]
    store.readEvents(doc.id, { screen: selScreen, sessions: sessionIds }).then(setEvents).catch(() => {})
  }, [doc.id, selScreen, selSessions, allSessions, sessions])

  const screen = doc.screens.find((s) => s.id === selScreen) || null
  const aspect = doc.canvas.width / doc.canvas.height
  const dims = useMemo(() => {
    const availW = Math.max(50, box.w - 48)
    const availH = Math.max(50, box.h - 48)
    let w = availW
    let h = w / aspect
    if (h > availH) {
      h = availH
      w = h * aspect
    }
    return { w: Math.round(w), h: Math.round(h) }
  }, [box, aspect])

  // ~4.5mm finger radius on a ~57mm-wide physical P10 screen (720px → 57mm → 12.6 px/mm).
  const fingerRadius = useMemo(() => Math.max(10, Math.round(dims.w * 0.079)), [dims.w])

  useEffect(() => {
    if (!initDone.current && box.w > 0) {
      setRadius(fingerRadius)
      initDone.current = true
    }
  }, [box.w, fingerRadius])

  const filtered = useMemo(
    () => events.filter((e) => (filter === 'all' ? true : filter === 'hit' ? e.hit : !e.hit)),
    [events, filter]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = dims.w
    canvas.height = dims.h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (mode === 'heat') {
      const points = filtered.map((e) => ({ x: e.x * dims.w, y: e.y * dims.h, value: 1 }))
      drawHeatmap(canvas, points, { radius, blur: radius * 0.8 })
    } else {
      const colorOf = new Map<string, string>()
      sessions.forEach((s, i) => colorOf.set(s.sessionId, SESSION_COLORS[i % SESSION_COLORS.length]))
      for (const e of filtered) {
        ctx.beginPath()
        ctx.fillStyle = colorOf.get(e.sessionId) || '#0d99ff'
        ctx.globalAlpha = e.hit ? 0.85 : 0.5
        ctx.arc(e.x * dims.w, e.y * dims.h, e.hit ? 7 : 5, 0, Math.PI * 2)
        ctx.fill()
        if (selEvents.has(e.id)) {
          ctx.beginPath()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2
          ctx.arc(e.x * dims.w, e.y * dims.h, (e.hit ? 7 : 5) + 3, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }
  }, [filtered, dims, mode, radius, sessions, selEvents])

  const onStackClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'dots') return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const hitRadius = 15
      let found: TapEvent | null = null
      for (const ev of filtered) {
        const dx = ev.x * dims.w - cx
        const dy = ev.y * dims.h - cy
        if (dx * dx + dy * dy <= hitRadius * hitRadius) { found = ev; break }
      }
      if (found) {
        setSelEvents((prev) => {
          const next = new Set(prev)
          next.has(found!.id) ? next.delete(found!.id) : next.add(found!.id)
          return next
        })
      } else {
        setSelEvents(new Set())
      }
    },
    [mode, filtered, dims]
  )

  const toggleSession = (sid: string) => {
    setAllSessions(false)
    setSelSessions((prev) => {
      const next = new Set(prev)
      next.has(sid) ? next.delete(sid) : next.add(sid)
      return next
    })
  }

  const onImport = async (file: File) => {
    try {
      const arr = JSON.parse(await file.text()) as TapEvent[]
      if (!Array.isArray(arr)) throw new Error()
      const res = await store.appendEvents(doc.id, arr)
      toast(`Импортировано событий: ${res.added}`)
      loadSessions()
    } catch {
      toast('Не удалось импортировать файл результатов', 'error')
    }
  }

  const onExport = async () => {
    setExporting(true)
    try {
      const all = await store.readEvents(doc.id) // all screens, all sessions
      await exportResultsDeck(doc, all, sessions)
    } catch {
      toast('Не удалось собрать презентацию', 'error')
    } finally {
      setExporting(false)
    }
  }

  const onExportPdf = async () => {
    // open the print window synchronously (inside the click) so it isn't blocked
    const win = window.open('', '_blank')
    if (win) win.document.write('<!doctype html><meta charset="utf-8"><body style="font:16px sans-serif;padding:40px;color:#62666d">Готовим PDF…</body>')
    setExportingPdf(true)
    try {
      const all = await store.readEvents(doc.id)
      const html = await buildResultsHtml(doc, all, sessions, { autoPrint: true })
      if (win) {
        win.document.open()
        win.document.write(html)
        win.document.close()
      } else {
        toast('Разрешите всплывающие окна, чтобы сохранить PDF', 'error')
      }
    } catch {
      win?.close()
      toast('Не удалось собрать PDF', 'error')
    } finally {
      setExportingPdf(false)
    }
  }

  const confirmDeleteSelected = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const ids = [...selEvents]
      const res = await store.deleteEvents(doc.id, { ids })
      setSelEvents(new Set())
      toast(`Удалено кликов: ${res.deleted}`)
      loadSessions()
    } catch {
      toast('Не удалось удалить', 'error')
    } finally {
      setDeleting(false)
      setDeleteModal(null)
    }
  }

  const confirmDeleteSession = async () => {
    if (deleting || !deleteSessionId) return
    setDeleting(true)
    try {
      const res = await store.deleteEvents(doc.id, { sessionId: deleteSessionId })
      toast(`Удалено кликов сессии: ${res.deleted}`)
      loadSessions()
    } catch {
      toast('Не удалось удалить сессию', 'error')
    } finally {
      setDeleting(false)
      setDeleteModal(null)
      setDeleteSessionId(null)
    }
  }

  const stats = useMemo(() => {
    const hits = events.filter((e) => e.hit).length
    const byHotspot = new Map<string, number>()
    for (const e of events) if (e.hotspotId) byHotspot.set(e.hotspotId, (byHotspot.get(e.hotspotId) || 0) + 1)
    return { total: events.length, hits, miss: events.length - hits, byHotspot }
  }, [events])

  return (
    <>
      <div className="panel editor__panel-left">
        <div className="panel__section">
          <div className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>Экраны</div>
          <div className="col" style={{ gap: 2 }}>
            {doc.screens.map((s) => (
              <div
                key={s.id}
                className={`screen-item ${s.id === selScreen ? 'is-active' : ''}`}
                onClick={() => onSelectScreen(s.id)}
              >
                <span className="screen-item__name grow truncate">{s.name}</span>
                <span className="screen-item__meta">{s.hotspots.length} зон</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="heat-embed__main">
        <div className="heat__canvas" ref={wrapCb}>
          {!screen ? (
            <EmptyState icon="target" title="Выбери экран" />
          ) : events.length === 0 ? (
            <EmptyState
              icon="target"
              title="Нет данных по экрану"
              text="Прогони прототип на терминале — клики появятся здесь автоматически."
            />
          ) : (
            <div className="heat__stack" style={{ width: dims.w, height: dims.h }}>
              {screen.media?.type === 'image' ? (
                <img src={screen.media.url} style={{ width: dims.w, height: dims.h, objectFit: 'fill' }} />
              ) : screen.media?.type === 'video' ? (
                <video src={screen.media.url} muted style={{ width: dims.w, height: dims.h, objectFit: 'fill' }} />
              ) : (
                <div style={{ width: dims.w, height: dims.h, background: '#000' }} />
              )}
              <canvas ref={canvasRef} />
              {mode === 'dots' && (
                <div
                  className="heat__click-layer"
                  style={{ position: 'absolute', inset: 0, zIndex: 1, cursor: 'pointer' }}
                  onClick={onStackClick}
                />
              )}
              {screen.hotspots.map((h) => {
                const count = stats.byHotspot.get(h.id) || 0
                return (
                  <div
                    key={h.id}
                    className={`heat__hotspot${selHotspot === h.id ? ' is-selected' : ''}`}
                    style={{ left: h.x * dims.w, top: h.y * dims.h, width: h.w * dims.w, height: h.h * dims.h, zIndex: 2 }}
                    onClick={(e) => { e.stopPropagation(); onSelectHotspot(selHotspot === h.id ? null : h.id) }}
                  >
                    <span className="heat__hotspot-tag">
                      {h.label ? `${h.label} · ${count} кл.` : `${count} кл.`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="heat__legend">
          {mode === 'heat' ? (
            <>
              <span>мало</span>
              <span className="heat__legend-bar" />
              <span>много</span>
            </>
          ) : (
            <span>Каждый цвет — отдельная сессия. Крупные точки — попадание в зону, мелкие — мимо.</span>
          )}
          <div className="grow" />
          <span className="dim">{screen?.name}</span>
        </div>
      </div>

      <div className="panel editor__panel-right">
        <div className="panel__section col">
          <div className="panel__title" style={{ margin: 0 }}>Отображение</div>
          <Field label="Режим">
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} />
          </Field>
          <Field label="Клики">
            <Segmented options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
          </Field>
          {mode === 'heat' && (
            <div className="col" style={{ gap: 'var(--space-1)' }}>
              <div className="row between">
                <span className="field__label">Радиус</span>
                <span className="dim" style={{ fontSize: 'var(--fs-ui)' }}>{radius}px</span>
              </div>
              <Slider min={10} max={70} value={radius} onChange={setRadius} ariaLabel="Радиус" />
              <div className="row between">
                <span className="dim" style={{ fontSize: 'var(--fs-ui)' }}>Палец ≈ {fingerRadius}px</span>
                {radius !== fingerRadius && (
                  <button
                    className="dim"
                    style={{ fontSize: 'var(--fs-ui)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setRadius(fingerRadius)}
                  >
                    сбросить
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="panel__section">
          <div className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>
            Сессии · {sessions.length}
          </div>
          {sessions.length === 0 ? (
            <p className="dim" style={{ fontSize: 'var(--fs-ui)' }}>
              Ещё нет данных. Запусти прототип на терминале.
            </p>
          ) : (
            <>
              <Checkbox
                className="session-row"
                checked={allSessions}
                onChange={(v) => {
                  setAllSessions(v)
                  if (v) setSelSessions(new Set())
                }}
                label={<span style={{ fontWeight: 'var(--fw-semibold)' }}>Все сессии</span>}
              />
              {sessions.map((s, i) => (
                <div key={s.sessionId} className="session-row-wrap">
                  <Checkbox
                    className="session-row"
                    checked={allSessions || selSessions.has(s.sessionId)}
                    disabled={allSessions}
                    onChange={() => toggleSession(s.sessionId)}
                    label={
                      <span className="session-row__main">
                        <span className="session-dot" style={{ background: SESSION_COLORS[i % SESSION_COLORS.length] }} />
                        <span className="grow truncate">{s.participant || s.device || 'сессия'}</span>
                        <span className="col" style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                          <span className="dim" style={{ fontSize: 'var(--fs-ui)', lineHeight: 1 }}>{s.count}</span>
                          <span className="dim" style={{ fontSize: 10, lineHeight: 1 }}>
                            {new Date(s.firstTs).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                            {' '}
                            {new Date(s.firstTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </span>
                    }
                  />
                  <IconButton
                    icon="trash"
                    size="sm"
                    variant="danger"
                    label="Удалить сессию"
                    className="session-row__delete"
                    onClick={(e) => { e.stopPropagation(); setDeleteSessionId(s.sessionId); setDeleteModal('session') }}
                  />
                </div>
              ))}
            </>
          )}
        </div>

        <div className="panel__section">
          <div className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>Статистика</div>
          <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            <Badge>всего {stats.total}</Badge>
            <Badge variant="success">по зонам {stats.hits}</Badge>
            <Badge>мимо {stats.miss}</Badge>
          </div>
          {selEvents.size > 0 && (
            <Button
              block
              variant="danger"
              icon="trash"
              style={{ marginTop: 'var(--space-2)' }}
              onClick={() => setDeleteModal('events')}
            >
              Удалить выбранное ({selEvents.size})
            </Button>
          )}
        </div>

        {screen && screen.hotspots.length > 0 && (
          <div className="panel__section col">
            <div className="panel__title" style={{ margin: 0 }}>Зоны · {screen.hotspots.length}</div>
            <div className="col" style={{ gap: 2 }}>
              {screen.hotspots.map((h, i) => {
                const count = stats.byHotspot.get(h.id) || 0
                const isEditing = editingLabel === h.id
                return (
                  <div
                    key={h.id}
                    className={`screen-item${selHotspot === h.id ? ' is-active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => { if (!isEditing) onSelectHotspot(selHotspot === h.id ? null : h.id) }}
                  >
                    {isEditing ? (
                      <input
                        ref={labelInputRef}
                        className="screen-item__input"
                        defaultValue={h.label || ''}
                        placeholder={`Зона ${i + 1}`}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          onUpdateHotspot(screen.id, h.id, e.target.value)
                          setEditingLabel(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onUpdateHotspot(screen.id, h.id, (e.target as HTMLInputElement).value)
                            setEditingLabel(null)
                          } else if (e.key === 'Escape') {
                            setEditingLabel(null)
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="screen-item__name grow truncate"
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingLabel(h.id) }}
                        title="Двойной клик — переименовать"
                      >
                        {h.label || `Зона ${i + 1}`}
                      </span>
                    )}
                    <Badge>{count}</Badge>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="panel__section col">
          <Button block variant="primary" icon="download" loading={exportingPdf} onClick={onExportPdf}>
            {exportingPdf ? 'Готовим…' : 'Скачать PDF'}
          </Button>
          <Button block icon="download" loading={exporting} onClick={onExport}>
            {exporting ? 'Готовим…' : 'Презентация (HTML)'}
          </Button>
          <Button block icon="upload" onClick={() => importRef.current?.click()}>
            Импорт результатов
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden-input"
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <Button block variant="ghost" icon="refresh" onClick={loadSessions}>
            Обновить
          </Button>
        </div>
      </div>

      <Modal
        open={deleteModal === 'events'}
        title="Удалить клики?"
        onClose={() => setDeleteModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteModal(null)}>Отмена</Button>
            <Button variant="danger" solid loading={deleting} onClick={confirmDeleteSelected}>Удалить</Button>
          </>
        }
      >
        <p className="muted">Будет удалено {selEvents.size} кликов. Это действие необратимо.</p>
      </Modal>

      <Modal
        open={deleteModal === 'session'}
        title="Удалить сессию?"
        onClose={() => { setDeleteModal(null); setDeleteSessionId(null) }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDeleteModal(null); setDeleteSessionId(null) }}>Отмена</Button>
            <Button variant="danger" solid loading={deleting} onClick={confirmDeleteSession}>Удалить</Button>
          </>
        }
      >
        <p className="muted">Все клики этой сессии будут удалены безвозвратно.</p>
      </Modal>
    </>
  )
}
