import { Icon, type IconName } from './Icon'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'md' | 'lg'
}) {
  return (
    <div className={`segmented segmented--${size}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`segmented__item ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={size === 'lg' ? 18 : 15} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
