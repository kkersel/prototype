// Export click results as a self-contained 16:9 HTML deck — one slide per screen
// (40% screenshot with the heatmap baked in / 60% grey data panel) plus a summary
// slide. No deps: images are composited on a canvas and embedded as data-URLs, so
// the file opens anywhere and prints to PDF (one 16:9 page per slide).
import { drawHeatmap } from './heatmap'
import type { Prototype, Screen, SessionInfo, TapEvent } from './types'

const ACCENT = '#0d99ff'
const SUCCESS = '#12a150'
const MISS = '#e5484d'

type ScreenStats = {
  screen: Screen
  total: number
  hits: number
  miss: number
  sessions: number
  zones: { label: string; count: number }[]
  img: string | null
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)
const safeFile = (s: string) => s.replace(/[^a-zа-я0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'prototype'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = src
  })
}

function loadVideoFrame(src: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    let done = false
    const finish = (ok: boolean) => {
      if (!done) {
        done = true
        resolve(ok ? v : null)
      }
    }
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2)
      } catch {
        finish(true)
      }
    }
    v.onseeked = () => finish(true)
    v.onerror = () => finish(false)
    setTimeout(() => finish(v.readyState >= 2), 1500)
    v.src = src
  })
}

// Screenshot with the heatmap composited over it → a single JPEG data-URL.
async function renderScreenImage(
  screen: Screen,
  w: number,
  h: number,
  radius: number,
  events: TapEvent[]
): Promise<string | null> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  try {
    if (screen.media?.type === 'image') {
      ctx.drawImage(await loadImage(screen.media.url), 0, 0, w, h)
    } else if (screen.media?.type === 'video') {
      const v = await loadVideoFrame(screen.media.url)
      if (v) ctx.drawImage(v, 0, 0, w, h)
    }
  } catch {
    /* keep the black fallback */
  }
  if (events.length) {
    const heat = document.createElement('canvas')
    heat.width = w
    heat.height = h
    drawHeatmap(
      heat,
      events.map((e) => ({ x: e.x * w, y: e.y * h, value: 1 })),
      { radius, blur: radius * 0.8 }
    )
    ctx.drawImage(heat, 0, 0)
  }
  return canvas.toDataURL('image/jpeg', 0.85)
}

function statBlock(value: string | number, label: string, color?: string): string {
  return `<div class="stat"><div class="stat__num"${color ? ` style="color:${color}"` : ''}>${value}</div><div class="stat__lbl">${esc(label)}</div></div>`
}

function rateBar(rate: number): string {
  return `<div class="rate"><div class="rate__head"><span>Попадание в зоны</span><b>${rate}%</b></div><div class="rate__track"><div class="rate__fill" style="width:${rate}%"></div></div></div>`
}

function zonesBlock(zones: { label: string; count: number }[]): string {
  if (!zones.length) return `<div class="zones__empty">Кликабельных зон с попаданиями нет</div>`
  const max = Math.max(...zones.map((z) => z.count), 1)
  const shown = zones.slice(0, 7)
  const rest = zones.length - shown.length
  const rows = shown
    .map(
      (z) =>
        `<div class="zrow"><span class="zrow__lbl">${esc(z.label)}</span><div class="zrow__bar"><div class="zrow__fill" style="width:${pct(z.count, max)}%"></div></div><span class="zrow__n">${z.count}</span></div>`
    )
    .join('')
  return `<div class="zones"><div class="zones__title">Клики по зонам</div>${rows}${rest > 0 ? `<div class="zones__more">и ещё ${rest}</div>` : ''}</div>`
}

function screenSlide(st: ScreenStats, idx: number, total: number): string {
  const media = st.img
    ? `<img src="${st.img}" alt="">`
    : `<div class="media__empty">Нет медиа</div>`
  return `<section class="slide">
    <div class="slide__media">${media}</div>
    <div class="slide__panel">
      <div class="eyebrow">Экран ${idx + 1} / ${total}</div>
      <h1 class="title">${esc(st.screen.name)}</h1>
      <div class="stats">
        ${statBlock(st.total, 'всего кликов')}
        ${statBlock(st.hits, 'по зонам', SUCCESS)}
        ${statBlock(st.miss, 'мимо', MISS)}
      </div>
      ${st.total ? rateBar(pct(st.hits, st.total)) : ''}
      ${zonesBlock(st.zones)}
      <div class="panel__foot">${st.sessions} ${plural(st.sessions, 'сессия', 'сессии', 'сессий')} · ${st.screen.hotspots.length} ${plural(st.screen.hotspots.length, 'зона', 'зоны', 'зон')}</div>
    </div>
  </section>`
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

function summarySlide(doc: Prototype, stats: ScreenStats[], sessions: SessionInfo[], dateStr: string): string {
  const totalClicks = stats.reduce((a, s) => a + s.total, 0)
  const totalHits = stats.reduce((a, s) => a + s.hits, 0)
  const withData = stats.filter((s) => s.total > 0)
  const rows = stats
    .map((s) => {
      const r = pct(s.hits, s.total)
      return `<div class="srow"><span class="srow__name">${esc(s.screen.name)}</span><div class="srow__bar"><div class="srow__fill" style="width:${r}%"></div></div><span class="srow__rate">${s.total ? r + '%' : '—'}</span><span class="srow__n">${s.total}</span></div>`
    })
    .join('')
  const parts = [...new Set(sessions.map((s) => s.participant).filter(Boolean))]
  return `<section class="slide slide--summary">
    <div class="sum__head">
      <div class="eyebrow">Итоги тестирования</div>
      <h1 class="title">${esc(doc.name)}</h1>
      <div class="sum__date">${esc(dateStr)}</div>
    </div>
    <div class="sum__stats">
      ${statBlock(stats.length, 'экранов')}
      ${statBlock(totalClicks, 'всего кликов')}
      ${statBlock(pct(totalHits, totalClicks) + '%', 'в зоны', ACCENT)}
      ${statBlock(sessions.length, 'сессий')}
    </div>
    <div class="sum__body">
      <div class="sum__title">По экранам${withData.length < stats.length ? ` · с данными: ${withData.length}/${stats.length}` : ''}</div>
      <div class="srows">${rows}</div>
    </div>
    ${parts.length ? `<div class="panel__foot">Участники: ${esc(parts.join(', '))}</div>` : ''}
  </section>`
}

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1e24;-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.stage{position:fixed;inset:0;display:grid;place-items:center;overflow:hidden;background:#0b0d12}
.slide{width:1280px;height:720px;background:#fff;display:flex;gap:40px;padding:56px;border-radius:6px}
@media screen{.slide{position:absolute;transform:scale(var(--s,1));display:none}.slide.is-active{display:flex}}
.slide__media{flex:0 0 40%;display:flex;align-items:center;justify-content:center;min-width:0}
.slide__media img{max-width:100%;max-height:100%;border-radius:28px;box-shadow:0 24px 60px rgba(16,20,30,.28);object-fit:contain}
.media__empty{color:#9aa0aa;font-size:18px}
.slide__panel{flex:1;min-width:0;background:#eceef2;border-radius:40px;padding:52px;display:flex;flex-direction:column}
.eyebrow{font-size:15px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9aa0aa}
.title{font-size:46px;font-weight:800;line-height:1.05;margin-top:10px;letter-spacing:-.02em}
.stats{display:flex;gap:14px;margin-top:34px}
.stat{flex:1;background:#fff;border-radius:22px;padding:22px 24px}
.stat__num{font-size:46px;font-weight:800;line-height:1;letter-spacing:-.02em}
.stat__lbl{font-size:15px;color:#62666d;margin-top:8px}
.rate{margin-top:26px}
.rate__head{display:flex;justify-content:space-between;align-items:baseline;font-size:16px;color:#62666d}
.rate__head b{color:#1c1e24;font-size:20px}
.rate__track{height:12px;border-radius:999px;background:#dfe3ea;margin-top:10px;overflow:hidden}
.rate__fill{height:100%;border-radius:999px;background:${ACCENT}}
.zones{margin-top:30px;display:flex;flex-direction:column;gap:12px}
.zones__title,.sum__title{font-size:15px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#9aa0aa;margin-bottom:4px}
.zones__empty{margin-top:26px;color:#9aa0aa;font-size:17px}
.zrow{display:flex;align-items:center;gap:14px}
.zrow__lbl{width:160px;font-size:17px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zrow__bar{flex:1;height:14px;border-radius:999px;background:#dfe3ea;overflow:hidden}
.zrow__fill{height:100%;background:${ACCENT};border-radius:999px}
.zrow__n{width:46px;text-align:right;font-weight:700;font-size:18px}
.zones__more{font-size:14px;color:#9aa0aa}
.panel__foot{margin-top:auto;padding-top:24px;font-size:15px;color:#62666d}
/* summary */
.slide--summary{flex-direction:column;gap:0}
.slide--summary .slide__panel{display:none}
.sum__head{}
.sum__date{margin-top:8px;color:#9aa0aa;font-size:16px}
.sum__stats{display:flex;gap:16px;margin-top:30px}
.sum__stats .stat{background:#eceef2}
.sum__body{flex:1;margin-top:34px;min-height:0;display:flex;flex-direction:column}
.srows{display:flex;flex-direction:column;gap:10px;margin-top:6px;overflow:hidden}
.srow{display:flex;align-items:center;gap:16px}
.srow__name{width:240px;font-size:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srow__bar{flex:1;height:14px;border-radius:999px;background:#eceef2;overflow:hidden}
.srow__fill{height:100%;background:${ACCENT};border-radius:999px}
.srow__rate{width:54px;text-align:right;color:#62666d;font-size:16px}
.srow__n{width:54px;text-align:right;font-weight:700;font-size:18px}
.nav{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;gap:18px;background:rgba(20,24,33,.66);backdrop-filter:blur(8px);color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;z-index:10}
.nav button{all:unset;cursor:pointer;width:30px;height:30px;border-radius:999px;display:grid;place-items:center;font-size:18px}
.nav button:hover{background:rgba(255,255,255,.16)}
#pos{min-width:54px;text-align:center;opacity:.85}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  @page{size:13.333in 7.5in;margin:0}
  .stage{position:static;display:block;background:#fff}
  .slide{display:flex!important;position:relative;transform:none;page-break-after:always;border-radius:0}
  .slide:last-child{page-break-after:auto}
  .nav{display:none}
}
`

const SCRIPT = `
var slides=[].slice.call(document.querySelectorAll('.slide'));var i=0,total=slides.length;
function fit(){document.documentElement.style.setProperty('--s',Math.min(window.innerWidth/1280,window.innerHeight/720));}
function show(n){i=Math.max(0,Math.min(total-1,n));slides.forEach(function(s,k){s.classList.toggle('is-active',k===i)});document.getElementById('pos').textContent=(i+1)+' / '+total;}
window.addEventListener('resize',fit);
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();show(i+1);}else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();show(i-1);}});
document.querySelectorAll('[data-nav]').forEach(function(b){b.onclick=function(){show(i+(b.getAttribute('data-nav')==='next'?1:-1));};});
fit();show(0);
`

async function computeStats(doc: Prototype, events: TapEvent[]): Promise<ScreenStats[]> {
  const aspect = doc.canvas.width / doc.canvas.height
  const MAX = 1100
  const w = aspect >= 1 ? MAX : Math.round(MAX * aspect)
  const h = aspect >= 1 ? Math.round(MAX / aspect) : MAX
  const radius = Math.max(14, Math.round(Math.min(w, h) * 0.05))

  const byScreen = new Map<string, TapEvent[]>()
  for (const e of events) {
    const list = byScreen.get(e.screenId)
    if (list) list.push(e)
    else byScreen.set(e.screenId, [e])
  }

  const stats: ScreenStats[] = []
  for (const screen of doc.screens) {
    const evs = byScreen.get(screen.id) || []
    const hits = evs.filter((e) => e.hit).length
    const byZone = new Map<string, number>()
    for (const e of evs) if (e.hotspotId) byZone.set(e.hotspotId, (byZone.get(e.hotspotId) || 0) + 1)
    const zones = screen.hotspots
      .map((hp) => ({ label: hp.label || 'Без названия', count: byZone.get(hp.id) || 0 }))
      .filter((z) => z.count > 0)
      .sort((a, b) => b.count - a.count)
    const img = await renderScreenImage(screen, w, h, radius, evs)
    stats.push({
      screen,
      total: evs.length,
      hits,
      miss: evs.length - hits,
      sessions: new Set(evs.map((e) => e.sessionId)).size,
      zones,
      img,
    })
  }
  return stats
}

// Build the full self-contained deck HTML. `autoPrint` opens the browser print
// dialog on load (used for the «Save as PDF» flow).
export async function buildResultsHtml(
  doc: Prototype,
  events: TapEvent[],
  sessions: SessionInfo[],
  opts: { autoPrint?: boolean } = {}
): Promise<string> {
  const stats = await computeStats(doc, events)
  const dateStr = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const slides = stats.map((st, i) => screenSlide(st, i, stats.length)).join('\n')
  const summary = summarySlide(doc, stats, sessions, dateStr)
  const autoPrint = opts.autoPrint
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print()},350)});window.onafterprint=function(){window.close()};</script>`
    : ''

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.name)} — результаты</title><style>${STYLE}</style></head>
<body><div class="stage">${slides}${summary}</div>
<div class="nav"><button data-nav="prev" aria-label="Назад">‹</button><span id="pos"></span><button data-nav="next" aria-label="Вперёд">›</button></div>
<script>${SCRIPT}</script>${autoPrint}</body></html>`
}

export async function exportResultsDeck(doc: Prototype, events: TapEvent[], sessions: SessionInfo[]): Promise<void> {
  const html = await buildResultsHtml(doc, events, sessions)
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${safeFile(doc.name)}-результаты.html`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
