import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Action, Direction, Hotspot, Prototype, Screen, Transition } from '../types'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Select,
} from '../components/ui'

const uid = () => Math.random().toString(36).slice(2, 10)
const TRANSITIONS: Transition[] = [
  'none',
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'push-left',
]

export function Editor() {
  const { id } = useParams()
  const nav = useNavigate()
  const [doc, setDoc] = useState<Prototype | null>(null)
  const [selScreen, setSelScreen] = useState<string | null>(null)
  const [selHotspot, setSelHotspot] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const lastSaved = useRef<string>('')

  useEffect(() => {
    if (!id) return
    api.getPrototype(id).then((d) => {
      setDoc(d)
      lastSaved.current = JSON.stringify(d)
      setSelScreen(d.startScreenId || d.screens[0]?.id || null)
    })
  }, [id])

  useEffect(() => {
    if (!doc) return
    const snapshot = JSON.stringify(doc)
    if (snapshot === lastSaved.current) return
    setSaveState('saving')
    const t = setTimeout(async () => {
      await api.savePrototype(doc)
      lastSaved.current = snapshot
      setSaveState('saved')
    }, 600)
    return () => clearTimeout(t)
  }, [doc])

  const update = useCallback((fn: (d: Prototype) => Prototype) => {
    setDoc((d) => (d ? fn(structuredClone(d)) : d))
  }, [])

  const screen = doc?.screens.find((s) => s.id === selScreen) || null

  const setScreen = useCallback(
    (sid: string, fn: (s: Screen) => void) => {
      update((d) => {
        const s = d.screens.find((x) => x.id === sid)
        if (s) fn(s)
        return d
      })
    },
    [update]
  )

  const addScreen = async (file: File) => {
    const up = await api.upload(file)
    update((d) => {
      const s: Screen = {
        id: uid(),
        name: `Экран ${d.screens.length + 1}`,
        media: { type: up.type, url: up.url, name: up.name, mime: up.mime },
        hotspots: [],
        videoAutoplay: up.type === 'video',
        videoLoop: false,
      }
      d.screens.push(s)
      if (!d.startScreenId) d.startScreenId = s.id
      return d
    })
  }

  const replaceMedia = async (sid: string, file: File) => {
    const up = await api.upload(file)
    setScreen(sid, (s) => {
      s.media = { type: up.type, url: up.url, name: up.name, mime: up.mime }
      if (up.type === 'video' && s.videoAutoplay === undefined) s.videoAutoplay = true
    })
  }

  const removeScreen = (sid: string) => {
    update((d) => {
      d.screens = d.screens.filter((s) => s.id !== sid)
      if (d.startScreenId === sid) d.startScreenId = d.screens[0]?.id || null
      for (const s of d.screens) {
        for (const h of s.hotspots) if (h.action.toScreenId === sid) h.action.toScreenId = null
      }
      return d
    })
    if (selScreen === sid) setSelScreen(null)
  }

  const moveScreen = (sid: string, dir: -1 | 1) => {
    update((d) => {
      const i = d.screens.findIndex((s) => s.id === sid)
      const j = i + dir
      if (i < 0 || j < 0 || j >= d.screens.length) return d
      ;[d.screens[i], d.screens[j]] = [d.screens[j], d.screens[i]]
      return d
    })
  }

  const exportJson = () => {
    if (!doc) return
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.name.replace(/[^a-zа-я0-9_-]+/gi, '_')}.json`
    a.click()
  }

  if (!doc) return <div className="empty-state" style={{ height: '100vh' }}><span className="spinner" /></div>

  return (
    <div className="editor">
      <div className="editor__topbar">
        <IconButton icon="arrow-left" label="Все прототипы" onClick={() => nav('/')} />
        <input
          className="editor__name"
          value={doc.name}
          onChange={(e) => update((d) => ((d.name = e.target.value), d))}
        />
        <Badge>
          {doc.canvas.width}×{doc.canvas.height}
        </Badge>
        <SaveStatus state={saveState} />
        <div className="grow" />
        <Button icon="download" onClick={exportJson}>
          Экспорт
        </Button>
        <Button icon="target" onClick={() => nav(`/heatmaps/${doc.id}`)}>
          Тепловые карты
        </Button>
        <Button variant="primary" icon="play" onClick={() => nav(`/play/${doc.id}`)}>
          Запустить
        </Button>
      </div>

      <ScreenPanel
        doc={doc}
        sel={selScreen}
        onSelect={(s) => {
          setSelScreen(s)
          setSelHotspot(null)
        }}
        onAdd={addScreen}
        onRemove={removeScreen}
        onMove={moveScreen}
        onSetStart={(sid) => update((d) => ((d.startScreenId = sid), d))}
      />

      <Stage
        doc={doc}
        screen={screen}
        selHotspot={selHotspot}
        onSelectHotspot={setSelHotspot}
        onChange={setScreen}
      />

      <RightPanel
        doc={doc}
        screen={screen}
        selHotspot={selHotspot}
        onScreen={setScreen}
        onReplaceMedia={replaceMedia}
        onSelectHotspot={setSelHotspot}
        onDeleteHotspot={(hid) =>
          screen &&
          setScreen(screen.id, (s) => {
            s.hotspots = s.hotspots.filter((h) => h.id !== hid)
          })
        }
      />
    </div>
  )
}

function SaveStatus({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null
  return (
    <span className="row dim" style={{ fontSize: 'var(--fs-label)' }}>
      {state === 'saving' ? (
        'Сохранение…'
      ) : (
        <>
          <Icon name="check" size={14} /> Сохранено
        </>
      )}
    </span>
  )
}

// ----------------------------------------------------------------------------
function ScreenPanel(props: {
  doc: Prototype
  sel: string | null
  onSelect: (id: string) => void
  onAdd: (file: File) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onSetStart: (id: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const square = props.doc.canvas.width === props.doc.canvas.height
  return (
    <div className="panel editor__panel-left">
      <div className="panel__section">
        <Button
          variant="primary"
          icon="plus"
          block
          onClick={() => fileRef.current?.click()}
        >
          Добавить экран
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) props.onAdd(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="screen-list">
        {props.doc.screens.length === 0 && (
          <p className="dim" style={{ padding: 'var(--space-2)', fontSize: 'var(--fs-ui)' }}>
            Нет экранов
          </p>
        )}
        {props.doc.screens.map((s) => (
          <div
            key={s.id}
            className={`screen-item ${s.id === props.sel ? 'is-active' : ''}`}
            onClick={() => props.onSelect(s.id)}
          >
            <div className={`screen-thumb ${square ? 'screen-thumb--square' : ''}`}>
              {s.media?.type === 'image' ? (
                <img src={s.media.url} alt="" />
              ) : (
                <Icon name={s.media?.type === 'video' ? 'video' : 'image'} size={16} />
              )}
            </div>
            <div className="grow col" style={{ gap: 2 }}>
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <span className="screen-item__name truncate">{s.name}</span>
                {props.doc.startScreenId === s.id && <Badge variant="accent">старт</Badge>}
              </div>
              <span className="screen-item__meta">{s.hotspots.length} зон</span>
            </div>
            <div className="col" style={{ gap: 0 }} onClick={(e) => e.stopPropagation()}>
              <IconButton size="sm" icon="chevron-up" label="Выше" onClick={() => props.onMove(s.id, -1)} />
              <IconButton size="sm" icon="chevron-down" label="Ниже" onClick={() => props.onMove(s.id, 1)} />
            </div>
          </div>
        ))}
      </div>

      {props.sel && (
        <div className="panel__section col">
          <Button block onClick={() => props.onSetStart(props.sel!)}>
            Сделать стартовым
          </Button>
          <Button block variant="danger" icon="trash" onClick={() => props.onRemove(props.sel!)}>
            Удалить экран
          </Button>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
function Stage(props: {
  doc: Prototype
  screen: Screen | null
  selHotspot: string | null
  onSelectHotspot: (id: string | null) => void
  onChange: (sid: string, fn: (s: Screen) => void) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<null | { x: number; y: number; w: number; h: number }>(null)
  const drag = useRef<null | {
    mode: 'draw' | 'move' | 'resize'
    hid?: string
    startX: number
    startY: number
    orig?: Hotspot
  }>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const aspect = props.doc.canvas.width / props.doc.canvas.height
  const dims = useMemo(() => {
    const availW = Math.max(50, box.w - 48)
    const availH = Math.max(50, box.h - 48)
    let w = availW
    let h = w / aspect
    if (h > availH) {
      h = availH
      w = h * aspect
    }
    return { w, h }
  }, [box, aspect])

  const toNorm = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    }
  }

  const onStageDown = (e: React.MouseEvent) => {
    if (!props.screen) return
    if (e.target !== stageRef.current && !(e.target as HTMLElement).classList.contains('media-bg')) {
      return
    }
    props.onSelectHotspot(null)
    const p = toNorm(e.clientX, e.clientY)
    drag.current = { mode: 'draw', startX: p.x, startY: p.y }
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current || !props.screen) return
      const p = toNorm(e.clientX, e.clientY)
      const d = drag.current
      if (d.mode === 'draw') {
        setDraft({
          x: Math.min(d.startX, p.x),
          y: Math.min(d.startY, p.y),
          w: Math.abs(p.x - d.startX),
          h: Math.abs(p.y - d.startY),
        })
      } else if (d.mode === 'move' && d.orig && d.hid) {
        const dx = p.x - d.startX
        const dy = p.y - d.startY
        props.onChange(props.screen.id, (s) => {
          const h = s.hotspots.find((x) => x.id === d.hid)
          if (h) {
            h.x = clamp(d.orig!.x + dx, 0, 1 - h.w)
            h.y = clamp(d.orig!.y + dy, 0, 1 - h.h)
          }
        })
      } else if (d.mode === 'resize' && d.orig && d.hid) {
        const dx = p.x - d.startX
        const dy = p.y - d.startY
        props.onChange(props.screen.id, (s) => {
          const h = s.hotspots.find((x) => x.id === d.hid)
          if (h) {
            h.w = clamp(d.orig!.w + dx, 0.02, 1 - h.x)
            h.h = clamp(d.orig!.h + dy, 0.02, 1 - h.y)
          }
        })
      }
    }
    const onUp = () => {
      const d = drag.current
      if (d?.mode === 'draw' && draft && props.screen) {
        if (draft.w > 0.02 && draft.h > 0.02) {
          const hid = uid()
          props.onChange(props.screen.id, (s) => {
            s.hotspots.push({
              id: hid,
              x: draft.x,
              y: draft.y,
              w: draft.w,
              h: draft.h,
              action: { type: 'goto', toScreenId: null, transition: 'none' },
            })
          })
          props.onSelectHotspot(hid)
        }
        setDraft(null)
      }
      drag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draft, props])

  const startMove = (e: React.MouseEvent, h: Hotspot) => {
    e.stopPropagation()
    props.onSelectHotspot(h.id)
    const p = toNorm(e.clientX, e.clientY)
    drag.current = { mode: 'move', hid: h.id, startX: p.x, startY: p.y, orig: { ...h } }
  }
  const startResize = (e: React.MouseEvent, h: Hotspot) => {
    e.stopPropagation()
    props.onSelectHotspot(h.id)
    const p = toNorm(e.clientX, e.clientY)
    drag.current = { mode: 'resize', hid: h.id, startX: p.x, startY: p.y, orig: { ...h } }
  }

  return (
    <div className="stage-wrap" ref={wrapRef}>
      {!props.screen ? (
        <EmptyState
          icon="image"
          title="Выбери или добавь экран"
          text="Экран — это картинка или видео под размер терминала. Добавь его на панели слева."
        />
      ) : (
        <div
          className="stage"
          ref={stageRef}
          style={{ width: dims.w, height: dims.h }}
          onMouseDown={onStageDown}
        >
          {props.screen.media?.type === 'image' ? (
            <img className="media-bg" src={props.screen.media.url} draggable={false} />
          ) : props.screen.media?.type === 'video' ? (
            <video className="media-bg" src={props.screen.media.url} muted controls />
          ) : null}

          {props.screen.hotspots.map((h) => (
            <div
              key={h.id}
              className={`hotspot ${h.id === props.selHotspot ? 'is-selected' : ''}`}
              style={{
                left: `${h.x * 100}%`,
                top: `${h.y * 100}%`,
                width: `${h.w * 100}%`,
                height: `${h.h * 100}%`,
              }}
              onMouseDown={(e) => startMove(e, h)}
            >
              <span className="hotspot__tag">{labelFor(h, props.doc)}</span>
              <span className="hotspot__handle" onMouseDown={(e) => startResize(e, h)} />
            </div>
          ))}

          {draft && (
            <div
              className="hotspot"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.w * 100}%`,
                height: `${draft.h * 100}%`,
              }}
            />
          )}

          <div className="stage__hint">
            <Icon name="target" size={14} /> Потяни по картинке, чтобы создать кликабельную зону
          </div>
        </div>
      )}
    </div>
  )
}

function labelFor(h: Hotspot, doc: Prototype): string {
  if (h.label) return h.label
  if (h.action.type === 'back') return '← назад'
  if (h.action.type === 'none') return 'нет действия'
  const t = doc.screens.find((s) => s.id === h.action.toScreenId)
  return t ? `→ ${t.name}` : '→ не задан'
}

// ----------------------------------------------------------------------------
function RightPanel(props: {
  doc: Prototype
  screen: Screen | null
  selHotspot: string | null
  onScreen: (sid: string, fn: (s: Screen) => void) => void
  onReplaceMedia: (sid: string, file: File) => void
  onSelectHotspot: (id: string | null) => void
  onDeleteHotspot: (hid: string) => void
}) {
  const replaceRef = useRef<HTMLInputElement>(null)
  const { screen } = props
  if (!screen) return <div className="panel editor__panel-right" />

  const hotspot = screen.hotspots.find((h) => h.id === props.selHotspot) || null
  const screenOptions = props.doc.screens

  if (hotspot) {
    return (
      <div className="panel editor__panel-right">
        <div className="panel__section col">
          <div className="row between">
            <span className="panel__title" style={{ margin: 0 }}>
              Кликабельная зона
            </span>
            <IconButton size="sm" icon="close" label="Снять выделение" onClick={() => props.onSelectHotspot(null)} />
          </div>
          <Field label="Подпись (для тепловых карт)">
            <Input
              value={hotspot.label || ''}
              placeholder="напр. «Оплатить»"
              onChange={(e) =>
                props.onScreen(screen.id, (s) => {
                  const h = s.hotspots.find((x) => x.id === hotspot.id)
                  if (h) h.label = e.target.value
                })
              }
            />
          </Field>
          <ActionEditor
            title="Действие по тапу"
            screens={screenOptions}
            action={hotspot.action}
            onChange={(a) =>
              props.onScreen(screen.id, (s) => {
                const h = s.hotspots.find((x) => x.id === hotspot.id)
                if (h) h.action = a
              })
            }
            allowBack
          />
          <Button block variant="danger" icon="trash" onClick={() => props.onDeleteHotspot(hotspot.id)}>
            Удалить зону
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="panel editor__panel-right">
      <div className="panel__section col">
        <span className="panel__title" style={{ margin: 0 }}>
          Экран
        </span>
        <Field label="Название">
          <Input
            value={screen.name}
            onChange={(e) => props.onScreen(screen.id, (s) => (s.name = e.target.value))}
          />
        </Field>
        <Button block icon="image" onClick={() => replaceRef.current?.click()}>
          Заменить медиа
        </Button>
        <input
          ref={replaceRef}
          type="file"
          accept="image/*,video/*"
          className="hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) props.onReplaceMedia(screen.id, f)
            e.target.value = ''
          }}
        />
      </div>

      {screen.media?.type === 'video' && (
        <div className="panel__section col">
          <span className="panel__title" style={{ margin: 0 }}>
            Видео
          </span>
          <Toggle
            label="Автоплей"
            checked={!!screen.videoAutoplay}
            onChange={(v) => props.onScreen(screen.id, (s) => (s.videoAutoplay = v))}
          />
          <Toggle
            label="Зациклить"
            checked={!!screen.videoLoop}
            onChange={(v) => props.onScreen(screen.id, (s) => (s.videoLoop = v))}
          />
          <ActionEditor
            title="Когда видео закончилось"
            screens={screenOptions}
            action={screen.onVideoEnd || { type: 'none' }}
            onChange={(a) => props.onScreen(screen.id, (s) => (s.onVideoEnd = a.type === 'none' ? null : a))}
          />
        </div>
      )}

      <div className="panel__section col">
        <span className="panel__title" style={{ margin: 0 }}>
          Авто-переход (таймер)
        </span>
        <Toggle
          label="Включить"
          checked={!!screen.autoAdvance}
          onChange={(v) =>
            props.onScreen(screen.id, (s) => {
              s.autoAdvance = v
                ? { afterMs: 3000, action: { type: 'goto', toScreenId: null, transition: 'fade' } }
                : null
            })
          }
        />
        {screen.autoAdvance && (
          <>
            <Field label="Через (сек)">
              <Input
                type="number"
                step="0.5"
                min="0"
                value={screen.autoAdvance.afterMs / 1000}
                onChange={(e) =>
                  props.onScreen(screen.id, (s) => {
                    if (s.autoAdvance) s.autoAdvance.afterMs = Math.max(0, Number(e.target.value) * 1000)
                  })
                }
              />
            </Field>
            <ActionEditor
              title="Перейти на"
              screens={screenOptions}
              action={screen.autoAdvance.action}
              onChange={(a) => props.onScreen(screen.id, (s) => { if (s.autoAdvance) s.autoAdvance.action = a })}
            />
          </>
        )}
      </div>

      <div className="panel__section col">
        <span className="panel__title" style={{ margin: 0 }}>
          Свайпы
        </span>
        {(['left', 'right', 'up', 'down'] as Direction[]).map((dir) => (
          <Field key={dir} label={`Свайп ${dirLabel(dir)}`}>
            <Select
              value={screen.swipes?.[dir]?.toScreenId || ''}
              onChange={(e) =>
                props.onScreen(screen.id, (s) => {
                  s.swipes = s.swipes || {}
                  if (!e.target.value) delete s.swipes[dir]
                  else
                    s.swipes[dir] = {
                      type: 'goto',
                      toScreenId: e.target.value,
                      transition: defaultSwipeTransition(dir),
                    }
                })
              }
            >
              <option value="">— нет —</option>
              {screenOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 'var(--fs-ui)' }}>{label}</span>
    </label>
  )
}

function ActionEditor(props: {
  title: string
  screens: Screen[]
  action: Action
  onChange: (a: Action) => void
  allowBack?: boolean
}) {
  const a = props.action
  return (
    <>
      <Field label={props.title}>
        <Select
          value={a.type}
          onChange={(e) => {
            const type = e.target.value as Action['type']
            props.onChange({ ...a, type, toScreenId: type === 'goto' ? a.toScreenId ?? null : null })
          }}
        >
          <option value="none">— ничего —</option>
          <option value="goto">Перейти на экран</option>
          {props.allowBack && <option value="back">Вернуться назад</option>}
        </Select>
      </Field>
      {a.type === 'goto' && (
        <>
          <Field label="Экран">
            <Select
              value={a.toScreenId || ''}
              onChange={(e) => props.onChange({ ...a, toScreenId: e.target.value || null })}
            >
              <option value="">— выбрать —</option>
              {props.screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Переход">
            <Select
              value={a.transition || 'none'}
              onChange={(e) => props.onChange({ ...a, transition: e.target.value as Transition })}
            >
              {TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
    </>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
function dirLabel(d: Direction) {
  return { left: 'влево', right: 'вправо', up: 'вверх', down: 'вниз' }[d]
}
function defaultSwipeTransition(d: Direction): Transition {
  return { left: 'slide-left', right: 'slide-right', up: 'slide-up', down: 'slide-down' }[d] as Transition
}
