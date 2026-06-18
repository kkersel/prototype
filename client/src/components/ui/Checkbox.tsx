import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className = '',
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={`checkbox ${disabled ? 'is-disabled' : ''} ${className}`}>
      <input
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox__box" aria-hidden="true">
        <Icon name="check" size={12} className="checkbox__check" />
      </span>
      {label != null && <span className="checkbox__label">{label}</span>}
    </label>
  )
}
