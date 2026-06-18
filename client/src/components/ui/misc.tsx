import type { HTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Card({
  interactive = false,
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={`card ${interactive ? 'card--interactive' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function Badge({
  variant,
  children,
}: {
  variant?: 'accent' | 'success'
  children: ReactNode
}) {
  return <span className={`badge ${variant ? `badge--${variant}` : ''}`}>{children}</span>
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="загрузка" />
}

export function EmptyState({
  icon = 'layers',
  title,
  text,
  action,
}: {
  icon?: IconName
  title: string
  text?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty-state__title">{title}</div>
      {text && <div className="empty-state__text">{text}</div>}
      {action}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>
}
export function ToolbarGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="toolbar__group">
      {label && <span className="toolbar__label">{label}</span>}
      {children}
    </div>
  )
}
