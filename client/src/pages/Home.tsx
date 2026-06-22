import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import * as store from '../store'
import type { Prototype, PrototypeSummary } from '../types'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  Segmented,
  type SegmentOption,
  toast,
} from '../components/ui'

// Приоритетные модели терминалов с фиксированным разрешением экрана.
const TERMINALS = [
  { value: 'P10', label: 'P10', w: 720, h: 1600, icon: 'p10' },
  { value: 'P12', label: 'P12', w: 720, h: 720, icon: 'p12' },
] as const

type TerminalId = (typeof TERMINALS)[number]['value']

const TERMINAL_OPTIONS: SegmentOption<TerminalId>[] = TERMINALS.map((t) => ({
  value: t.value,
  label: t.label,
  icon: t.icon,
}))

// Stable hue (0..360) from an id, so media-less cards get a distinct accent.
const hueFromId = (id: string) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export function Home() {
  const [items, setItems] = useState<PrototypeSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [terminal, setTerminal] = useState<TerminalId>('P10')
  const [useCustom, setUseCustom] = useState(false)
  const [customW, setCustomW] = useState(720)
  const [customH, setCustomH] = useState(1600)
  const [deleteTarget, setDeleteTarget] = useState<PrototypeSummary | null>(null)

  const nav = useNavigate()
  const importRef = useRef<HTMLInputElement>(null)

  const term = TERMINALS.find((t) => t.value === terminal) ?? TERMINALS[0]

  // The server is the shared source of truth — everyone (authors + terminals)
  // sees the same pool just by opening the URL.
  const refresh = () => store.listPrototypes().then(setItems).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const create = async () => {
    const canvas = useCustom
      ? { width: Math.max(1, customW), height: Math.max(1, customH) }
      : { width: term.w, height: term.h }
    const doc = await store.createPrototype(name.trim() || 'Новый прототип', canvas)
    nav(`/editor/${doc.id}`)
  }

  const duplicate = async (it: PrototypeSummary) => {
    try {
      const doc = await store.getPrototype(it.id)
      if (!doc) return toast('Прототип не найден', 'error')
      await store.importPrototype(doc)
      refresh()
      toast(`«${it.name} (копия)» создан`)
    } catch {
      toast('Не удалось дублировать прототип', 'error')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await store.deletePrototype(deleteTarget.id)
    setDeleteTarget(null)
    refresh()
  }

  const onImport = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as Prototype
      const created = await store.importPrototype(doc)
      nav(`/editor/${created.id}`)
    } catch {
      toast('Не удалось импортировать файл прототипа', 'error')
    }
  }

  const hasItems = items.length > 0

  return (
    <div className="home">
      <header className="home__header">
        <div>
          <h1 className="home__title">Прототипы</h1>
          <p className="home__subtitle">
            Сборка прототипов для терминала · воспроизведение · тепловые карты кликов
          </p>
        </div>
        <div className="row">
          <Button icon="upload" onClick={() => importRef.current?.click()}>
            Импорт
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Новый прототип
          </Button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            className="hidden-input"
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
        </div>
      </header>

      {hasItems ? (
        <section className="home__section">
          <div className="home__cards">
            {items.map((it) => (
              <Card
                key={it.id}
                interactive
                className="proto-card"
                onClick={() => nav(`/editor/${it.id}`)}
              >
                <div className="proto-card__preview">
                  {it.thumb ? (
                    it.thumbType === 'video' ? (
                      <video src={it.thumb} muted playsInline preload="metadata" />
                    ) : (
                      <img src={it.thumb} alt="" loading="lazy" />
                    )
                  ) : (
                    <div
                      className="proto-card__placeholder"
                      style={{ '--seed': hueFromId(it.id) } as CSSProperties}
                    >
                      <Icon name="monitor" size={26} />
                    </div>
                  )}
                </div>
                <div className="proto-card__body">
                  <div className="row between">
                    <span className="proto-card__name truncate">{it.name}</span>
                    {it.screenCount > 0 && <Badge>{it.screenCount}</Badge>}
                  </div>
                  <span className="proto-card__meta">
                    создан {new Date(it.createdAt).toLocaleDateString('ru-RU')}
                    {it.updatedAt !== it.createdAt &&
                      ` · изм. ${new Date(it.updatedAt).toLocaleDateString('ru-RU')}`}
                  </span>
                  <div className="proto-card__actions" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" icon="play" variant="primary" onClick={() => nav(`/play/${it.id}`)}>
                      Запустить
                    </Button>
                    <IconButton size="sm" icon="target" label="Тепловые карты" onClick={() => nav(`/heatmaps/${it.id}`)} />
                    <IconButton size="sm" icon="copy" label="Дублировать" onClick={() => duplicate(it)} />
                    <div className="grow" />
                    <IconButton size="sm" icon="trash" label="Удалить" variant="danger" onClick={() => setDeleteTarget(it)} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <Card>
          <EmptyState
            icon="layers"
            title="Пока нет сценариев"
            text="Создай первый прототип — он появится здесь и станет доступен всем, кто откроет этот адрес."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Новый прототип
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={creating}
        title="Новый прототип"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={create}>
              Создать
            </Button>
          </>
        }
      >
        <Field label="Название">
          <Input
            autoFocus
            placeholder="Например: Оплата картой"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </Field>
        <Field
          label={useCustom ? 'Свой размер' : 'Терминал'}
          hint={
            useCustom
              ? 'Произвольный размер холста в пикселях.'
              : `Разрешение экрана ${term.w}×${term.h}. На терминале экран подгоняется автоматически.`
          }
        >
          {!useCustom ? (
            <Segmented options={TERMINAL_OPTIONS} value={terminal} onChange={setTerminal} size="lg" />
          ) : (
            <div className="row">
              <Input type="number" min={1} value={customW} onChange={(e) => setCustomW(Number(e.target.value))} />
              <span className="dim">×</span>
              <Input type="number" min={1} value={customH} onChange={(e) => setCustomH(Number(e.target.value))} />
            </div>
          )}
        </Field>
        <Checkbox checked={useCustom} onChange={setUseCustom} label="Свой размер" />
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="Удалить прототип?"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button variant="danger" solid onClick={confirmDelete}>
              Удалить
            </Button>
          </>
        }
      >
        <p className="muted">
          «{deleteTarget?.name}» и все его тепловые карты будут удалены безвозвратно.
        </p>
      </Modal>
    </div>
  )
}
