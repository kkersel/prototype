import type { CSSProperties } from 'react'

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  ariaLabel?: string
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ '--pct': `${pct}%` } as CSSProperties}
    />
  )
}
