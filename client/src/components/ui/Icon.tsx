// Single icon set: stroke-based, 1.5px, inherits currentColor. Add new glyphs
// here — never inline SVG in pages, never use emoji as icons (see .ai/design.md).
import type { SVGProps } from 'react'

export type IconName =
  | 'plus'
  | 'play'
  | 'image'
  | 'video'
  | 'layers'
  | 'target'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'arrow-left'
  | 'trash'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'close'
  | 'check'
  | 'eye'
  | 'monitor'
  | 'restart'
  | 'expand'
  | 'user-plus'
  | 'swap'
  | 'wifi'
  | 'wifi-off'

const PATHS: Record<IconName, JSX.Element> = {
  plus: <path d="M10 4v12M4 10h12" />,
  play: <path d="M6 4l10 6-10 6V4z" fill="currentColor" stroke="none" />,
  image: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2.5" />
      <circle cx="7.5" cy="7.5" r="1.5" />
      <path d="M4 14l4-4 3 3 2-2 3 3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="10" height="10" rx="2" />
      <path d="M13 9l4-2.5v7L13 11" />
    </>
  ),
  layers: <path d="M10 3l7 4-7 4-7-4 7-4zM3 11l7 4 7-4M3 13.5l7 4 7-4" />,
  target: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-left': <path d="M12.5 5l-5 5 5 5" />,
  'chevron-right': <path d="M7.5 5l5 5-5 5" />,
  'chevron-up': <path d="M5 12.5l5-5 5 5" />,
  'chevron-down': <path d="M5 7.5l5 5 5-5" />,
  'arrow-left': <path d="M9 5l-5 5 5 5M4 10h12" />,
  trash: <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L15 6M8.5 9v4M11.5 9v4" />,
  download: <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15h12" />,
  upload: <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 15h12" />,
  refresh: <path d="M15.5 6.5A6 6 0 1 0 16 10M15.5 4v3h-3" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  eye: (
    <>
      <path d="M2.5 10S5 4.5 10 4.5 17.5 10 17.5 10 15 15.5 10 15.5 2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="2" />
      <path d="M7 16.5h6M10 13.5v3" />
    </>
  ),
  restart: <path d="M4.5 10a5.5 5.5 0 1 0 1.7-4M6 3.5V6.5h3" />,
  expand: <path d="M7.5 4H4v3.5M12.5 16H16v-3.5M16 7.5V4h-3.5M4 12.5V16h3.5" />,
  'user-plus': (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M3 16c0-2.5 2.2-4 5-4 1 0 1.9.2 2.7.6M14 11.5v4M12 13.5h4" />
    </>
  ),
  swap: <path d="M5 7h9l-2.5-2.5M15 13H6l2.5 2.5" />,
  wifi: <path d="M3 8a11 11 0 0 1 14 0M5.5 11a7 7 0 0 1 9 0M8 14a3 3 0 0 1 4 0M10 16.5h.01" />,
  'wifi-off': <path d="M3 8a11 11 0 0 1 5-2.6M13 6a11 11 0 0 1 4 2M8 14a3 3 0 0 1 4 0M10 16.5h.01M3 3l14 14" />,
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}
