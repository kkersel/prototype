import { useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

// Bottom sheet for touch context (the player's operator menu). Drag-to-dismiss,
// safe-area aware (CSS), tap targets ≥48px. See .ai/design.md.
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const startY = useRef<number | null>(null)
  const [dy, setDy] = useState(0)

  if (!open) return null

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return
    setDy(Math.max(0, e.clientY - startY.current))
  }
  const onPointerUp = () => {
    if (dy > 90) onClose()
    startY.current = null
    setDy(0)
  }

  return (
    <div className="sheet-overlay" onPointerDown={onClose}>
      <div
        className="sheet"
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div
          className="sheet__handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {title && <div className="sheet__title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function SheetItem({
  icon,
  danger = false,
  onClick,
  children,
}: {
  icon: IconName
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button className={`sheet__item ${danger ? 'sheet__item--danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={20} />
      {children}
    </button>
  )
}
