import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { joinHost, type JoinHandle, type JoinStatus } from '../pair'
import type { Prototype, TapEvent } from '../types'
import { Button, Field, Input, Spinner } from '../components/ui'
import { Player } from './Player'

// Terminal side: enter the code shown on the laptop, receive the scenario over
// WebRTC, then run the player and stream events back to the laptop.
export function Join() {
  const nav = useNavigate()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<JoinStatus | 'idle'>('idle')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [doc, setDoc] = useState<Prototype | null>(null)
  const handleRef = useRef<JoinHandle | null>(null)

  useEffect(() => () => handleRef.current?.close(), [])

  const connect = () => {
    const c = code.trim().toUpperCase()
    if (c.length < 4) return
    setStatus('connecting')
    handleRef.current?.close()
    handleRef.current = joinHost(c, {
      onStatus: (s, info) => {
        setStatus(s)
        if (info) setProgress({ received: info.received || 0, total: info.total || 0 })
      },
      onScenario: (incoming, blobs) => {
        const hydrated = structuredClone(incoming)
        for (const s of hydrated.screens) {
          const mid = s.media?.mediaId
          if (mid && blobs[mid] && s.media) s.media.url = URL.createObjectURL(blobs[mid])
        }
        setDoc(hydrated)
      },
    })
  }

  const onEvent = useCallback((ev: TapEvent) => handleRef.current?.sendEvents([ev]), [])

  if (doc) return <Player prototype={doc} onEvent={onEvent} />

  return (
    <div className="player">
      <div className="player__gate">
        <div className="player__gate-card">
          <div>
            <h2 style={{ fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-bold)' }}>Подключение к ноутбуку</h2>
            <p style={{ color: 'var(--player-text-dim)', fontSize: 'var(--fs-ui)', marginTop: 4 }}>
              Введи код, показанный на ноутбуке в редакторе.
            </p>
          </div>
          <Field>
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="K7P2QF"
              maxLength={8}
              style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: 'var(--fs-h1)', fontWeight: 'var(--fw-bold)' }}
            />
          </Field>
          {status !== 'idle' && (
            <div className="row center" style={{ gap: 'var(--space-2)', color: 'var(--player-text-dim)', fontSize: 'var(--fs-ui)' }}>
              {status === 'connecting' && (<><Spinner /> Подключаемся…</>)}
              {status === 'receiving' && (
                <><Spinner /> Получаем сценарий… {progress && progress.total > 0 ? `${progress.received}/${progress.total}` : ''}</>
              )}
              {status === 'error' && <span style={{ color: '#e5484d' }}>Не удалось подключиться. Проверь код.</span>}
              {status === 'lost' && <span style={{ color: '#e5484d' }}>Связь потеряна. Попробуй ещё раз.</span>}
            </div>
          )}
          <Button
            variant="primary"
            block
            onClick={connect}
            disabled={code.trim().length < 4 || status === 'connecting' || status === 'receiving'}
            style={{ height: 'var(--control-h-lg)' }}
          >
            Подключиться
          </Button>
          <button className="btn btn--ghost" style={{ color: 'var(--player-text-dim)' }} onClick={() => nav('/')}>
            На главную
          </button>
        </div>
      </div>
    </div>
  )
}
