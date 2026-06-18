import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Direction, Prototype, Screen } from '../../types'
import { Icon } from '../../components/ui'

const NODE_W = 200
const EDIT_H = 31 // height of the node's «Зоны» footer (button + top border)
const HEAD_H = 36 // approx height of the node's title row (for side picking only)
const COLS = 4
const GAP_X = NODE_W + 96

interface CanvasProps {
  doc: Prototype
  selScreen: string | null
  onSelect: (id: string) => void
  onMoveNode: (id: string, x: number, y: number) => void
  // Wire a click zone to a target (drag from the zone's connector, drop on a screen).
  onConnectHotspot: (fromScreenId: string, hotspotId: string, toScreenId: string) => void
  // Re-point an existing arrow (by edge id) at a new target screen.
  onRewireEdge: (edgeId: string, newTarget: string) => void
  // Clicking an arrow selects its underlying zone/screen for the right inspector.
  onSelectEdge: (edgeId: string) => void
  onEditScreen: (id: string) => void
}

type NodeData = {
  screen: Screen
  isStart: boolean
  nodeW: number
  nodeH: number
  sides: Record<string, Position> // hotspotId -> side its connector/arrow uses
  onEdit: (id: string) => void
}

const nodeTypes = { screen: ScreenNode }

function nodeHeight(canvas: { width: number; height: number }) {
  const aspect = canvas.width / canvas.height
  return Math.max(120, Math.min(420, Math.round(NODE_W / aspect)))
}

// ---- floating edge: anchors attach on the side facing the other end ----
type Rect = { x: number; y: number; w: number; h: number }
// `sourceSide` is decided once (see hotspotSides) and shared with the zone's
// handle so the dot and the line sit on the same edge.
type EdgeData = {
  zone?: { x: number; y: number; w: number; h: number }
  mediaH: number
  sourceSide?: Position
}

function nodeRect(n: InternalNode): Rect {
  const p = n.internals.positionAbsolute
  return { x: p.x, y: p.y, w: n.measured.width ?? NODE_W, h: n.measured.height ?? 0 }
}

// The source rect is the click zone (if the edge carries one) rather than the
// whole screen, so the arrow leaves from the zone.
function sourceRect(n: InternalNode, data?: EdgeData): Rect {
  const node = nodeRect(n)
  if (!data?.zone || !node.h) return node
  const headH = Math.max(0, node.h - data.mediaH - EDIT_H)
  const z = data.zone
  return {
    x: node.x + z.x * NODE_W,
    y: node.y + headH + z.y * data.mediaH,
    w: z.w * NODE_W,
    h: z.h * data.mediaH,
  }
}

// Which side of `r` faces `toward` (accounts for the rect's aspect ratio).
function facingSide(r: Rect, toward: { x: number; y: number }): Position {
  const dx = toward.x - (r.x + r.w / 2)
  const dy = toward.y - (r.y + r.h / 2)
  const scaleX = r.w / 2 / (Math.abs(dx) || 1e-6)
  const scaleY = r.h / 2 / (Math.abs(dy) || 1e-6)
  if (scaleX <= scaleY) return dx >= 0 ? Position.Right : Position.Left
  return dy >= 0 ? Position.Bottom : Position.Top
}

// Centre point of a given side — where the handle dot sits and the line attaches.
function sideAnchor(r: Rect, side: Position) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  if (side === Position.Left) return { x: r.x, y: cy }
  if (side === Position.Right) return { x: r.x + r.w, y: cy }
  if (side === Position.Top) return { x: cx, y: r.y }
  return { x: cx, y: r.y + r.h }
}

function FloatingEdge({ id, source, target, data, markerEnd, style, label, labelStyle, labelBgStyle }: EdgeProps) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t) return null

  const d = data as EdgeData | undefined
  const sr = sourceRect(s, d)
  const tr = nodeRect(t)
  const sc = { x: sr.x + sr.w / 2, y: sr.y + sr.h / 2 }
  const tc = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 }
  const sSide = d?.sourceSide ?? facingSide(sr, tc)
  const tSide = facingSide(tr, sc)
  const sa = sideAnchor(sr, sSide)
  const ta = sideAnchor(tr, tSide)

  const [path, labelX, labelY] = getBezierPath({
    sourceX: sa.x,
    sourceY: sa.y,
    sourcePosition: sSide,
    targetX: ta.x,
    targetY: ta.y,
    targetPosition: tSide,
  })

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              padding: '0 3px',
              borderRadius: 3,
              ...(labelBgStyle as object),
              ...(labelStyle as object),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { floating: FloatingEdge }

function gridPos(i: number, nodeH: number) {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  return { x: col * GAP_X, y: row * (nodeH + 110) }
}

// The screen id under a pointer event — lets connections land anywhere on a node
// instead of only on a tiny target dot.
function nodeIdAtPoint(event: MouseEvent | TouchEvent): string | null {
  const pt = 'changedTouches' in event && event.changedTouches.length ? event.changedTouches[0] : (event as MouseEvent)
  const el = document.elementFromPoint(pt.clientX, pt.clientY) as HTMLElement | null
  return el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
}

// ---- custom node: a screen frame with a connector per click zone ----
function ScreenNode({ data, selected }: NodeProps) {
  const { screen, isStart, nodeW, nodeH, sides, onEdit } = data as NodeData
  return (
    <div className={`flow-node ${selected ? 'is-selected' : ''}`} style={{ width: nodeW }}>
      {/* whole node is droppable (resolved in onConnectEnd) + a screen-level source
          for swipe/timer/video edges */}
      <Handle id="in" type="target" position={Position.Top} className="flow-handle flow-handle--in" />
      <Handle
        id="screen"
        type="source"
        position={Position.Top}
        isConnectable={false}
        className="flow-handle flow-handle--screen"
      />
      <div className="flow-node__head">
        <span className="truncate">{screen.name}</span>
        {isStart && <span className="badge badge--accent">старт</span>}
      </div>
      <div className="flow-node__media" style={{ height: nodeH }}>
        {screen.media?.type === 'image' ? (
          <img src={screen.media.url} alt="" draggable={false} />
        ) : screen.media?.type === 'video' ? (
          <video src={screen.media.url} muted />
        ) : (
          <div className="flow-node__empty">
            <Icon name="image" size={22} />
          </div>
        )}

        {/* one connection handle per click zone — the arrow leaves from the zone */}
        {screen.hotspots.map((h) => (
          <div
            key={h.id}
            className="flow-node__zone"
            style={{
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              width: `${h.w * 100}%`,
              height: `${h.h * 100}%`,
            }}
          >
            <Handle
              id={h.id}
              type="source"
              position={sides[h.id] ?? Position.Right}
              className="flow-handle flow-handle--hotspot"
            />
          </div>
        ))}
      </div>
      <button
        className="flow-node__edit nodrag nopan"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(screen.id)
        }}
      >
        <Icon name="edit" size={14} /> Зоны
      </button>
    </div>
  )
}

// ---- inner (inside provider, can use useReactFlow) ----
function CanvasInner(props: CanvasProps) {
  const { doc, selScreen } = props
  const nodeH = nodeHeight(doc.canvas)
  const rf = useReactFlow()
  const [connecting, setConnecting] = useState(false)
  const connectSource = useRef<{ nodeId: string | null; handleId: string | null }>({ nodeId: null, handleId: null })
  const reconnected = useRef(false)

  const onEdit = useCallback((id: string) => props.onEditScreen(id), [props])

  // Decide, once, which side each zone's connector/arrow uses (the side facing its
  // target). Shared by the node handle and the edge so the dot sits on the line.
  const hotspotSides = useMemo(() => {
    const posOf = (s: Screen, i: number) => ({ x: s.x ?? gridPos(i, nodeH).x, y: s.y ?? gridPos(i, nodeH).y })
    const totalH = HEAD_H + nodeH + EDIT_H
    const map: Record<string, Position> = {}
    doc.screens.forEach((s, i) => {
      const P = posOf(s, i)
      for (const h of s.hotspots) {
        const to = h.action?.type === 'goto' ? h.action.toScreenId : null
        if (!to) continue
        const j = doc.screens.findIndex((x) => x.id === to)
        if (j < 0) continue
        const tP = posOf(doc.screens[j], j)
        const zoneRect = { x: P.x + h.x * NODE_W, y: P.y + HEAD_H + h.y * nodeH, w: h.w * NODE_W, h: h.h * nodeH }
        const tc = { x: tP.x + NODE_W / 2, y: tP.y + totalH / 2 }
        map[`${s.id}:${h.id}`] = facingSide(zoneRect, tc)
      }
    })
    return map
  }, [doc.screens, nodeH])

  const build = useCallback(
    (): Node[] =>
      doc.screens.map((s, i) => {
        const fallback = gridPos(i, nodeH)
        const sides: Record<string, Position> = {}
        for (const h of s.hotspots) {
          const side = hotspotSides[`${s.id}:${h.id}`]
          if (side) sides[h.id] = side
        }
        return {
          id: s.id,
          type: 'screen',
          position: { x: s.x ?? fallback.x, y: s.y ?? fallback.y },
          selected: s.id === selScreen,
          data: { screen: s, isStart: s.id === doc.startScreenId, nodeW: NODE_W, nodeH, sides, onEdit },
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, nodeH, selScreen, onEdit, hotspotSides]
  )

  const [nodes, , onNodesChange] = useNodesState<Node>(build())

  // re-sync nodes when screen content/positions/selection change
  const signature = useMemo(
    () =>
      doc.screens
        .map((s) => `${s.id}|${s.name}|${s.media?.url ?? ''}|${s.hotspots.length}|${s.x},${s.y}`)
        .join(';') + `#${doc.startScreenId}#${selScreen}`,
    [doc.screens, doc.startScreenId, selScreen]
  )
  const setNodes = rf.setNodes
  useEffect(() => {
    setNodes(build())
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  // center on the selected screen (e.g. picked from the left panel)
  useEffect(() => {
    if (!selScreen) return
    const i = doc.screens.findIndex((s) => s.id === selScreen)
    if (i < 0) return
    const s = doc.screens[i]
    const fb = gridPos(i, nodeH)
    rf.setCenter((s.x ?? fb.x) + NODE_W / 2, (s.y ?? fb.y) + nodeH / 2, {
      zoom: Math.max(rf.getZoom?.() ?? 0.8, 0.7),
      duration: 320,
    })
  }, [selScreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // One arrow per click zone (leaving its own connector), plus dashed screen-level
  // arrows for swipe / timer / video.
  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const s of doc.screens) {
      for (const h of s.hotspots) {
        if (h.action?.type === 'goto' && h.action.toScreenId) {
          out.push({
            id: `h:${s.id}:${h.id}`,
            type: 'floating',
            source: s.id,
            sourceHandle: h.id,
            target: h.action.toScreenId,
            targetHandle: 'in',
            data: { zone: { x: h.x, y: h.y, w: h.w, h: h.h }, mediaH: nodeH, sourceSide: hotspotSides[`${s.id}:${h.id}`] },
            style: { stroke: '#0d99ff', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#0d99ff' },
          })
        }
      }
      const lvl: [string, string, string][] = []
      if (s.swipes)
        for (const dir of Object.keys(s.swipes) as Direction[]) {
          const to = s.swipes[dir]?.toScreenId
          if (to) lvl.push([`sw:${s.id}:${dir}`, to, `свайп ${dir}`])
        }
      if (s.autoAdvance?.action?.toScreenId) lvl.push([`t:${s.id}`, s.autoAdvance.action.toScreenId, 'таймер'])
      if (s.onVideoEnd?.toScreenId) lvl.push([`v:${s.id}`, s.onVideoEnd.toScreenId, 'видео'])
      for (const [id, to, label] of lvl) {
        out.push({
          id,
          type: 'floating',
          source: s.id,
          sourceHandle: 'screen',
          target: to,
          targetHandle: 'in',
          label,
          data: { mediaH: nodeH },
          style: { stroke: '#9aa0aa', strokeWidth: 1.5, strokeDasharray: '5 4' },
          labelStyle: { fontSize: 10, color: '#62666d' },
          labelBgStyle: { background: '#ffffff' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa0aa' },
        })
      }
    }
    return out
  }, [doc.screens, nodeH, hotspotSides])

  // --- wiring a zone: drag its connector, drop anywhere on the target screen ---
  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null }) => {
    connectSource.current = { nodeId: params.nodeId, handleId: params.handleId }
    setConnecting(true)
  }, [])
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      setConnecting(false)
      const { nodeId, handleId } = connectSource.current
      connectSource.current = { nodeId: null, handleId: null }
      // only zone connectors create links; the screen-level handle is wired via the panel
      if (!nodeId || !handleId || handleId === 'screen') return
      const to = nodeIdAtPoint(event)
      if (to && to !== nodeId) props.onConnectHotspot(nodeId, handleId, to)
    },
    [props]
  )

  // --- reconnecting: drag an arrow's end onto another screen ---
  const onReconnectStart = useCallback(() => {
    reconnected.current = false
    setConnecting(true)
  }, [])
  const onReconnect = useCallback(
    (oldEdge: Edge, conn: { target: string | null }) => {
      reconnected.current = true
      if (conn.target) props.onRewireEdge(oldEdge.id, conn.target)
    },
    [props]
  )
  const onReconnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, edge: Edge) => {
      setConnecting(false)
      if (reconnected.current) return // already handled by onReconnect (dropped on a handle)
      const to = nodeIdAtPoint(event)
      if (to) props.onRewireEdge(edge.id, to)
    },
    [props]
  )

  return (
    <ReactFlow
      className={connecting ? 'is-connecting' : undefined}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onReconnectStart={onReconnectStart}
      onReconnect={onReconnect}
      onReconnectEnd={onReconnectEnd}
      onEdgeClick={(_, edge) => props.onSelectEdge(edge.id)}
      onNodeClick={(_, n) => props.onSelect(n.id)}
      onNodeDragStop={(_, n) => props.onMoveNode(n.id, Math.round(n.position.x), Math.round(n.position.y))}
      elevateNodesOnSelect={false}
      connectionLineStyle={{ stroke: '#0d99ff', strokeWidth: 2 }}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'floating' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#d3d7e0" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor="#cdd2db" maskColor="rgba(20,24,33,0.06)" />
    </ReactFlow>
  )
}

export function CanvasView(props: CanvasProps) {
  return (
    <div className="editor__canvas">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}
