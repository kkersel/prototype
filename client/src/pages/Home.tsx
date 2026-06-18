import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Prototype, PrototypeSummary } from '../types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  Select,
} from '../components/ui'

const PRESETS = [
  { label: 'Портрет · 1080×1920', w: 1080, h: 1920 },
  { label: 'Портрет · 720×1280', w: 720, h: 1280 },
  { label: 'Квадрат · 1080×1080', w: 1080, h: 1080 },
  { label: 'Квадрат · 720×720', w: 720, h: 720 },
  { label: 'Альбом · 1280×720', w: 1280, h: 720 },
]

export function Home() {
  const [items, setItems] = useState<PrototypeSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [preset, setPreset] = useState(0)
  const [useCustom, setUseCustom] = useState(false)
  const [customW, setCustomW] = useState(1080)
  const [customH, setCustomH] = useState(1920)
  const [deleteTarget, setDeleteTarget] = useState<PrototypeSummary | null>(null)
  const nav = useNavigate()
  const importRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.listPrototypes().then(setItems).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const create = async () => {
    const canvas = useCustom
      ? { width: Math.max(1, customW), height: Math.max(1, customH) }
      : { width: PRESETS[preset].w, height: PRESETS[preset].h }
    const doc = await api.createPrototype(name.trim() || 'Новый прототип', canvas)
    nav(`/editor/${doc.id}`)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await api.deletePrototype(deleteTarget.id)
    setDeleteTarget(null)
    refresh()
  }

  const onImport = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as Prototype
      const created = await api.importPrototype(doc)
      nav(`/editor/${created.id}`)
    } catch {
      alert('Не удалось импортировать файл прототипа')
    }
  }

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

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers"
            title="Пока нет прототипов"
            text="Создай первый прототип — задай размер экрана терминала и добавь экраны."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Новый прототип
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="home__cards">
          {items.map((it) => (
            <Card
              key={it.id}
              interactive
              className="proto-card"
              onClick={() => nav(`/editor/${it.id}`)}
            >
              <div className="proto-card__preview">
                <Icon name="monitor" size={28} />
              </div>
              <div className="proto-card__body">
                <div className="row between">
                  <span className="proto-card__name truncate">{it.name}</span>
                  {it.screenCount > 0 && <Badge>{it.screenCount}</Badge>}
                </div>
                <span className="proto-card__meta">
                  изменён {new Date(it.updatedAt).toLocaleDateString('ru-RU')}
                </span>
                <div className="proto-card__actions" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" icon="play" variant="primary" onClick={() => nav(`/play/${it.id}`)}>
                    Запустить
                  </Button>
                  <IconButton size="sm" icon="target" label="Тепловые карты" onClick={() => nav(`/heatmaps/${it.id}`)} />
                  <div className="grow" />
                  <IconButton size="sm" icon="trash" label="Удалить" variant="danger" onClick={() => setDeleteTarget(it)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
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
          label="Размер экрана"
          hint="Задаёт пропорции холста. На терминале экран подгоняется автоматически."
        >
          {!useCustom ? (
            <Select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </Select>
          ) : (
            <div className="row">
              <Input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} />
              <span className="dim">×</span>
              <Input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} />
            </div>
          )}
        </Field>
        <label className="row" style={{ gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
          <span className="muted">Свой размер</span>
        </label>
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
