import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

// Custom dropdown: no native <select>, so the menu is fully themed and consistent
// across OS/browser. The popover renders in a body portal (position: fixed) so it
// is never clipped by scrolling panels. See .ai/design.md.
export function Select({
  value,
  onChange,
  options,
  placeholder = '— выбрать —',
  disabled,
  ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const below = spaceBelow > 260 || spaceBelow >= r.top
    const maxHeight = Math.min(288, Math.max(120, (below ? spaceBelow : r.top) - 12))
    setStyle({
      position: 'fixed',
      left: r.left,
      width: r.width,
      maxHeight,
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    })
  }

  const openMenu = () => {
    if (disabled) return
    place()
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o.value)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select select-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`select__value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" size={16} className="select__chevron" />
      </button>

      {open &&
        style &&
        createPortal(
          <div ref={popRef} className="select-popover" role="listbox" style={style}>
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`select-option ${i === active ? 'is-active' : ''} ${
                  o.value === value ? 'is-selected' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
