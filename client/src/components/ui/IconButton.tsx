import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string // accessible name (required)
  size?: 'sm' | 'md'
  variant?: 'default' | 'danger'
  active?: boolean
}

export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'default',
  active = false,
  className = '',
  ...props
}: IconButtonProps) {
  const cls = [
    'icon-btn',
    size === 'sm' && 'icon-btn--sm',
    variant === 'danger' && 'icon-btn--danger',
    active && 'icon-btn--active',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} aria-label={label} title={label} {...props}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  )
}
