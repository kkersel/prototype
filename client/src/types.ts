export type Transition = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'push-left'

export type MediaType = 'image' | 'video'

export interface Media {
  type: MediaType
  url: string
  name?: string
  mime?: string
}

export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Action {
  // Where a tap / swipe / timer leads.
  type: 'goto' | 'back' | 'none'
  toScreenId?: string | null
  transition?: Transition
}

export interface Hotspot {
  id: string
  // Normalized rect relative to the canvas (0..1). Resolution-independent so
  // taps from different-sized terminals aggregate into the same heatmap space.
  x: number
  y: number
  w: number
  h: number
  label?: string
  action: Action
}

export interface Screen {
  id: string
  name: string
  media: Media | null
  // Position on the canvas/board view (Figma-like). Optional: falls back to an
  // auto grid layout when unset.
  x?: number
  y?: number
  hotspots: Hotspot[]
  // Swipe gestures anywhere on the screen.
  swipes?: Partial<Record<Direction, Action>>
  // Auto-advance after a delay (ms).
  autoAdvance?: { afterMs: number; action: Action } | null
  // For video screens: where to go when playback ends.
  onVideoEnd?: Action | null
  videoAutoplay?: boolean
  videoLoop?: boolean
}

export interface Prototype {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  canvas: { width: number; height: number }
  startScreenId: string | null
  screens: Screen[]
}

export interface PrototypeSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  screenCount: number
  // Preview of the start screen (null until media is added).
  thumb?: string | null
  thumbType?: MediaType | null
}

export interface TapEvent {
  id: string
  prototypeId: string
  sessionId: string
  participant?: string
  device?: string
  screenId: string
  // Normalized 0..1 within the displayed media (letterboxed area).
  x: number
  y: number
  hit: boolean
  hotspotId?: string | null
  toScreenId?: string | null
  kind: 'tap' | 'swipe' | 'timer' | 'video-end'
  ts: number
}

export interface SessionInfo {
  sessionId: string
  participant: string
  device: string
  count: number
  firstTs: number
  lastTs: number
}
