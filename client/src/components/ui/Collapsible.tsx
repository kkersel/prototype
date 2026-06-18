import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`collapsible ${open ? 'is-open' : ''}`}>
      <button type="button" className="collapsible__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-right" size={14} className="collapsible__chev" />
        <span className="collapsible__title">{title}</span>
      </button>
      {open && <div className="collapsible__body col">{children}</div>}
    </div>
  )
}
