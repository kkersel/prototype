import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as local from '../../local'
import { drawHeatmap } from '../../heatmap'
import { buildResultsHtml, exportResultsDeck } from '../../export'
import type { Prototype, SessionInfo, TapEvent } from '../../types'
import { Badge, Button, Checkbox, EmptyState, Field, Segmented, Slider, toast, type SegmentOption } from '../../components/ui'

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
  onSelectScreen,
}: {
  doc: Prototype
  selScreen: string | null
  onSelectScreen: (id: string) => void
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selSessions, setSelSessions] = useState<Set<string>>(new Set())
  const [allSessions, setAllSessions] = useState(true)
  const [events, setEvents] = useState<TapEvent[]>([])
  const [mode, setMode] = useState<Mode>('heat')
  const [filter, setFilter] = useState<Filter>('all')
  const [radius, setRadius] = useState(30)
  const [exporting, setExporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

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
    local.listSessions(doc.id).then(setSessions).catch(() => {})
  }, [doc.id])
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // Live updates: when taps stream in (e.g. from a terminal) re-read sessions,
  // which cascades to the events reload + canvas redraw below — no manual refresh.
  useEffect(
    () =>
      local.onResultsChanged((pid) => {
        if (pid === doc.id) loadSessions()
      }),
    [doc.id, loadSessions]
  )

  useEffect(() => {
    if (!selScreen) return
    const sessionIds = allSessions ? undefined : [...selSessions]
    local.readEvents(doc.id, { screen: selScreen, sessions: sessionIds }).then(setEvents).catch(() => {})
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
      }
      ctx.globalAlpha = 1
    }
  }, [filtered, dims, mode, radius, sessions])

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
      const res = await local.appendEvents(doc.id, arr)
      toast(`Импортировано событий: ${res.added}`)
      loadSessions()
    } catch {
      toast('Не удалось импортировать файл результатов', 'error')
    }
  }

  const onExport = async () => {
    setExporting(true)
    try {
      const all = await local.readEvents(doc.id) // all screens, all sessions
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
      const all = await local.readEvents(doc.id)
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
              {screen.hotspots.map((h) => (
                <div
                  key={h.id}
                  className="heat__hotspot"
                  style={{ left: h.x * dims.w, top: h.y * dims.h, width: h.w * dims.w, height: h.h * dims.h }}
                >
                  <span className="heat__hotspot-tag">
                    {h.label || `${stats.byHotspot.get(h.id) || 0} кл.`}
                  </span>
                </div>
              ))}
              <canvas ref={canvasRef} />
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
            <Field label="Радиус">
              <Slider min={10} max={70} value={radius} onChange={setRadius} ariaLabel="Радиус" />
            </Field>
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
                <Checkbox
                  key={s.sessionId}
                  className="session-row"
                  checked={allSessions || selSessions.has(s.sessionId)}
                  disabled={allSessions}
                  onChange={() => toggleSession(s.sessionId)}
                  label={
                    <span className="session-row__main">
                      <span className="session-dot" style={{ background: SESSION_COLORS[i % SESSION_COLORS.length] }} />
                      <span className="grow truncate">{s.participant || s.device || 'сессия'}</span>
                      <span className="dim">{s.count}</span>
                    </span>
                  }
                />
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
        </div>

        <div className="panel__section col">
          <Button block variant="primary" icon="download" loading={exporting} onClick={onExport}>
            {exporting ? 'Готовим…' : 'Презентация (HTML)'}
          </Button>
          <Button block icon="download" loading={exportingPdf} onClick={onExportPdf}>
            {exportingPdf ? 'Готовим…' : 'Скачать PDF'}
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
    </>
  )
}
