import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

// Tiny global toast — replaces native alert() so notifications stay themed.
// Mount <Toaster/> once (see main.tsx); call toast(message) from anywhere.
interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'error'
}

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<(items: ToastItem[]) => void>()
const emit = () => listeners.forEach((l) => l(items))

export function toast(message: string, tone: 'info' | 'error' = 'info') {
  const id = ++seq
  items = [...items, { id, message, tone }]
  emit()
  setTimeout(() => {
    items = items.filter((i) => i.id !== id)
    emit()
  }, 3000)
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  if (list.length === 0) return null
  return createPortal(
    <div className="toast-stack">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast--error' : ''}`}>
          <Icon name={t.tone === 'error' ? 'close' : 'check'} size={16} />
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  )
}
