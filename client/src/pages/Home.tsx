import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import * as local from '../local'
import { joinBroadcast, type HostInfo, type JoinHandle } from '../pair'
import { Player } from './Player'
import type { Prototype, PrototypeSummary, TapEvent } from '../types'
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
  Spinner,
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

// A scenario discovered on another device on the network.
interface RemoteScenario {
  hostId: string
  id: string
  name: string
  screenCount: number
}

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

  // Pairing (only when served from the laptop's own server, not Vercel).
  const [lanUrls, setLanUrls] = useState<string[]>([])
  const [discovered, setDiscovered] = useState<RemoteScenario[]>([])
  const [playing, setPlaying] = useState<Prototype | null>(null)
  const [connecting, setConnecting] = useState(false)
  const joinRef = useRef<JoinHandle | null>(null)

  const nav = useNavigate()
  const importRef = useRef<HTMLInputElement>(null)

  const term = TERMINALS.find((t) => t.value === terminal) ?? TERMINALS[0]

  const refresh = () => local.listPrototypes().then(setItems).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  // Discover scenarios shared by other devices on the same network. Gated on the
  // capability check: /pair/info is JSON only on the real server (HTML on Vercel).
  useEffect(() => {
    let cancelled = false
    fetch('/pair/info')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d?.urls)) return
        setLanUrls(d.urls)
        const h = joinBroadcast({
          onHosts: (hosts: HostInfo[]) => {
            const flat: RemoteScenario[] = []
            const seen = new Set<string>()
            for (const host of hosts)
              for (const p of host.prototypes) {
                if (seen.has(p.id)) continue
                seen.add(p.id)
                flat.push({ hostId: host.hostId, id: p.id, name: p.name, screenCount: p.screenCount })
              }
            setDiscovered(flat)
          },
          onStatus: (s, info) => {
            if (s === 'error') {
              setConnecting(false)
              toast(
                info?.reason === 'timeout'
                  ? 'Не удалось загрузить сценарий — проверь, что устройства в одной Wi-Fi.'
                  : 'Не удалось запустить сценарий.',
                'error'
              )
            }
          },
          onScenario: (doc, blobs) => {
            const hydrated = structuredClone(doc)
            for (const s of hydrated.screens) {
              const mid = s.media?.mediaId
              if (mid && blobs[mid] && s.media) s.media.url = URL.createObjectURL(blobs[mid])
            }
            setConnecting(false)
            setPlaying(hydrated)
          },
        })
        joinRef.current = h
      })
      .catch(() => {})
    return () => {
      cancelled = true
      joinRef.current?.close()
    }
  }, [])

  // Scenarios from the network that aren't already local on this device.
  const localIds = new Set(items.map((i) => i.id))
  const remote = discovered.filter((d) => !localIds.has(d.id))

  const create = async () => {
    const canvas = useCustom
      ? { width: Math.max(1, customW), height: Math.max(1, customH) }
      : { width: term.w, height: term.h }
    const doc = await local.createPrototype(name.trim() || 'Новый прототип', canvas)
    nav(`/editor/${doc.id}`)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    await local.deletePrototype(deleteTarget.id)
    setDeleteTarget(null)
    refresh()
  }

  const onImport = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as Prototype
      const created = await local.importPrototype(doc)
      nav(`/editor/${created.id}`)
    } catch {
      toast('Не удалось импортировать файл прототипа', 'error')
    }
  }

  const playRemote = (it: RemoteScenario) => {
    setConnecting(true)
    joinRef.current?.request(it.hostId, it.id)
  }
  const exitPlay = () => {
    joinRef.current?.backToList()
    setPlaying(null)
  }
  const onEvent = (ev: TapEvent) => joinRef.current?.sendEvents([ev])

  // Running a scenario streamed from another device — full-screen player.
  if (playing) return <Player prototype={playing} onEvent={onEvent} onExit={exitPlay} />
  if (connecting)
    return (
      <div className="player">
        <div className="player__gate">
          <div className="player__gate-card" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Spinner />
            <p style={{ color: 'var(--player-text-dim)' }}>Загружаем сценарий…</p>
          </div>
        </div>
      </div>
    )

  const hasLocal = items.length > 0

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

      {/* Connect-a-terminal banner: shown on the authoring device once it has
          something to test. The terminal opens this address and the scenarios
          appear below automatically. */}
      {hasLocal && lanUrls.length > 0 && (
        <div className="lan-banner">
          <span className="lan-banner__icon">
            <Icon name="p10" size={26} />
          </span>
          <div className="lan-banner__text">
            <span className="lan-banner__label">Открой на терминале в браузере (в той же Wi-Fi):</span>
            <div className="lan-banner__urls">
              {lanUrls.map((u, i) => (
                <code key={u} className={i === 0 ? 'lan-banner__url' : 'lan-banner__url-sub'}>
                  {u}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scenarios shared from another device — pick one to run on this terminal. */}
      {remote.length > 0 && (
        <section className="home__section">
          <h2 className="home__section-title">
            <Icon name="monitor" size={16} /> Доступные сценарии
          </h2>
          <div className="home__cards">
            {remote.map((it) => (
              <Card key={it.id} interactive className="proto-card" onClick={() => playRemote(it)}>
                <div className="proto-card__preview">
                  <div
                    className="proto-card__placeholder"
                    style={{ '--seed': hueFromId(it.id) } as CSSProperties}
                  >
                    <Icon name="play" size={26} />
                  </div>
                </div>
                <div className="proto-card__body">
                  <div className="row between">
                    <span className="proto-card__name truncate">{it.name}</span>
                    {it.screenCount > 0 && <Badge>{it.screenCount}</Badge>}
                  </div>
                  <span className="proto-card__meta">с ноутбука · по сети</span>
                  <div className="proto-card__actions" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" icon="play" variant="primary" block onClick={() => playRemote(it)}>
                      Запустить
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {hasLocal ? (
        <section className="home__section">
          {remote.length > 0 && <h2 className="home__section-title">Мои прототипы</h2>}
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
        </section>
      ) : remote.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers"
            title="Пока нет сценариев"
            text="Создай первый прототип — или открой этот адрес на ноутбуке, где собраны сценарии, чтобы запустить их здесь."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Новый прототип
              </Button>
            }
          />
          {lanUrls.length > 0 && (
            <div className="row center dim" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <Spinner /> Ищем сценарии в сети…
            </div>
          )}
        </Card>
      ) : null}

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
