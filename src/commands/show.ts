import { Database } from '@db/sqlite'
import { GENRE_SIMILARITY } from '../utils/genre-similarity.ts'
import { getGenre2Counts, getGenreCounts, getMoodCounts, getTagCounts } from '../utils/db.ts'

function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		try {
			const listener = Deno.listen({ port: 0 })
			const port = (listener.addr as Deno.NetAddr).port
			listener.close()
			resolve(port)
		} catch (e) {
			reject(e)
		}
	})
}

function buildHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DB Visualizer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f0f13; color: #e0e0e0; padding: 24px; }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 24px; color: #fff; }
  h2 { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: #aaa; letter-spacing: 0.05em; text-transform: uppercase; }
  section { margin-bottom: 48px; }
  #circumplex-wrap { width: 100%; }
  #circumplex { width: 100%; height: auto; display: block; }
  .charts-row { display: flex; gap: 32px; flex-wrap: wrap; }
  .chart-col { flex: 1; min-width: 220px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 0.78rem; }
  .bar-label { width: 140px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ccc; text-align: right; }
  .bar-track { flex: 1; background: #1e1e28; border-radius: 2px; height: 14px; }
  .bar-fill { height: 100%; border-radius: 2px; background: #5b8dee; }
  .bar-count { width: 40px; flex-shrink: 0; font-size: 0.72rem; color: #666; }
  .genre2-section .bar-fill { background: #4ec9a0; }
  .mood-col .bar-fill { background: #e07b54; }
  .tag-col .bar-fill { background: #c97bd4; }
  .genre-col .bar-fill { background: #5b8dee; }
  svg text { font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<h1>DB Visualizer</h1>

<section id="similarity-section">
  <h2>Genre Similarity — Russell Circumplex</h2>
  <div id="circumplex-wrap">
    <svg id="circumplex" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>
</section>

<section class="genre2-section">
  <h2>genre_2 Counts</h2>
  <div id="genre2-chart"></div>
</section>

<section>
  <h2>mood / tag / genre Distributions</h2>
  <div class="charts-row">
    <div class="chart-col mood-col">
      <h2>mood</h2>
      <div id="mood-chart"></div>
    </div>
    <div class="chart-col tag-col">
      <h2>tag</h2>
      <div id="tag-chart"></div>
    </div>
    <div class="chart-col genre-col">
      <h2>genre</h2>
      <div id="genre-chart"></div>
    </div>
  </div>
</section>

<script>
async function main() {
  const [simRes, countsRes] = await Promise.all([
    fetch('/api/genre-similarity'),
    fetch('/api/counts'),
  ])
  const similarity = await simRes.json()
  const counts = await countsRes.json()

  drawCircumplex(similarity)
  drawBarChart('genre2-chart', counts.genre2, 'value')
  drawBarChart('mood-chart', counts.mood, 'value')
  drawBarChart('tag-chart', counts.tag, 'value')
  drawBarChart('genre-chart', counts.genre, 'value')
}

function drawCircumplex(data) {
  const wrap = document.getElementById('circumplex-wrap')
  const W = wrap.clientWidth || 1200
  const H = Math.round(W * 0.65)
  const PAD = 70
  const cx = W / 2, cy = H / 2
  const rx = (W - PAD * 2) / 2, ry = (H - PAD * 2) / 2

  const svg = document.getElementById('circumplex')
  svg.setAttribute('viewBox', \`0 0 \${W} \${H}\`)
  svg.setAttribute('width', W)
  svg.setAttribute('height', H)

  function toX(v) { return cx + v * rx }
  function toY(a) { return cy - a * ry }

  function quadrantColor(v, a) {
    if (v >= 0 && a >= 0) return '#c8a84b'
    if (v < 0 && a >= 0) return '#e07b54'
    if (v >= 0 && a < 0) return '#5b8dee'
    return '#8888cc'
  }

  const ns = 'http://www.w3.org/2000/svg'
  function el(tag, attrs) {
    const e = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    return e
  }

  svg.appendChild(el('rect', { width: W, height: H, fill: '#0f0f13' }))

  const quadrants = [
    { x: cx, y: PAD, w: rx, h: ry, fill: '#c8a84b18' },
    { x: PAD, y: PAD, w: rx, h: ry, fill: '#e07b5418' },
    { x: cx, y: cy, w: rx, h: ry, fill: '#5b8dee18' },
    { x: PAD, y: cy, w: rx, h: ry, fill: '#8888cc18' },
  ]
  for (const q of quadrants) {
    svg.appendChild(el('rect', { x: q.x, y: q.y, width: q.w, height: q.h, fill: q.fill }))
  }

  svg.appendChild(el('line', { x1: PAD, y1: cy, x2: W - PAD, y2: cy, stroke: '#333', 'stroke-width': 1 }))
  svg.appendChild(el('line', { x1: cx, y1: PAD, x2: cx, y2: H - PAD, stroke: '#333', 'stroke-width': 1 }))

  for (const [label, x, y, anchor] of [
    ['Valence →', W - PAD + 6, cy - 6, 'start'],
    ['← Negative', PAD - 6, cy - 6, 'end'],
    ['Arousal ↑', cx + 6, PAD + 14, 'start'],
    ['Calm ↓', cx + 6, H - PAD - 6, 'start'],
  ]) {
    const t = el('text', { x, y, fill: '#555', 'font-size': '12', 'text-anchor': anchor })
    t.textContent = label
    svg.appendChild(t)
  }

  for (const [label, x, y] of [
    ['Happy / Energetic', cx + 10, PAD + 18],
    ['Angry / Intense', PAD + 10, PAD + 18],
    ['Relaxed / Content', cx + 10, H - PAD - 10],
    ['Sad / Melancholic', PAD + 10, H - PAD - 10],
  ]) {
    const t = el('text', { x, y, fill: '#333', 'font-size': '11', 'text-anchor': 'start' })
    t.textContent = label
    svg.appendChild(t)
  }

  // Compute pixel positions
  const entries = Object.entries(data)
  const points = entries.map(([name, [v, a]]) => ({
    name, v, a,
    px: toX(v),
    py: toY(a),
    color: quadrantColor(v, a),
  }))

  // Smart label placement: greedy collision avoidance
  const FONT_SIZE = 9
  const CHAR_W = FONT_SIZE * 0.55
  const LABEL_H = FONT_SIZE + 2
  const POINT_R = 3
  const MARGIN = 2

  // Candidate offsets: [dx, dy, anchor] — anchor relative to text start
  // dx/dy from dot center to text anchor point
  const candidates = [
    [POINT_R + 3, LABEL_H / 2, 'start'],    // right
    [-(POINT_R + 3), LABEL_H / 2, 'end'],   // left
    [0, -(POINT_R + 3), 'middle'],            // above
    [0, POINT_R + LABEL_H, 'middle'],         // below
    [POINT_R + 3, -(POINT_R + 2), 'start'],  // upper-right
    [-(POINT_R + 3), -(POINT_R + 2), 'end'], // upper-left
    [POINT_R + 3, POINT_R + LABEL_H, 'start'], // lower-right
    [-(POINT_R + 3), POINT_R + LABEL_H, 'end'], // lower-left
  ]

  // For collision detection, track placed bounding boxes
  const placed = [] // {x1, y1, x2, y2}

  function textBox(tx, ty, anchor, len) {
    const w = len * CHAR_W
    let x1
    if (anchor === 'start') x1 = tx
    else if (anchor === 'end') x1 = tx - w
    else x1 = tx - w / 2
    return { x1, y1: ty - LABEL_H, x2: x1 + w, y2: ty + MARGIN }
  }

  function overlaps(b) {
    for (const p of placed) {
      if (b.x1 < p.x2 && b.x2 > p.x1 && b.y1 < p.y2 && b.y2 > p.y1) return true
    }
    return false
  }

  function inBounds(b) {
    return b.x1 >= 2 && b.x2 <= W - 2 && b.y1 >= 2 && b.y2 <= H - 2
  }

  // Also count nearby points (density penalty) for each candidate
  function densityPenalty(tx, ty, len, anchor) {
    const b = textBox(tx, ty, anchor, len)
    // expand box slightly for penalty check
    const eb = { x1: b.x1 - 8, y1: b.y1 - 8, x2: b.x2 + 8, y2: b.y2 + 8 }
    return points.filter(p => p.px >= eb.x1 && p.px <= eb.x2 && p.py >= eb.y1 && p.py <= eb.y2).length
  }

  // Draw dots first
  for (const p of points) {
    svg.appendChild(el('circle', { cx: p.px, cy: p.py, r: POINT_R, fill: p.color, opacity: '0.9' }))
  }

  // Place labels greedily
  for (const p of points) {
    let bestBox = null, bestTx = 0, bestTy = 0, bestAnchor = 'start', bestScore = Infinity

    for (const [dx, dy, anchor] of candidates) {
      const tx = p.px + dx
      const ty = p.py + dy
      const box = textBox(tx, ty, anchor, p.name.length)
      if (!inBounds(box)) continue
      const score = (overlaps(box) ? 1000 : 0) + densityPenalty(tx, ty, p.name.length, anchor)
      if (score < bestScore) {
        bestScore = score
        bestBox = box
        bestTx = tx; bestTy = ty; bestAnchor = anchor
      }
    }

    // Fallback: first candidate ignoring bounds
    if (!bestBox) {
      const [dx, dy, anchor] = candidates[0]
      bestTx = p.px + dx; bestTy = p.py + dy; bestAnchor = anchor
      bestBox = textBox(bestTx, bestTy, bestAnchor, p.name.length)
    }

    placed.push(bestBox)
    const t = el('text', { x: bestTx, y: bestTy, fill: p.color, 'font-size': FONT_SIZE, 'text-anchor': bestAnchor, opacity: '0.85' })
    t.textContent = p.name
    svg.appendChild(t)
  }
}

function drawBarChart(containerId, rows, labelKey) {
  const container = document.getElementById(containerId)
  if (!rows || rows.length === 0) {
    container.textContent = 'No data'
    return
  }
  const max = Math.max(...rows.map(r => r.count))
  for (const row of rows) {
    const pct = (row.count / max) * 100
    const div = document.createElement('div')
    div.className = 'bar-row'
    div.innerHTML = \`
      <span class="bar-label" title="\${row[labelKey]}">\${row[labelKey]}</span>
      <span class="bar-track"><span class="bar-fill" style="width:\${pct}%"></span></span>
      <span class="bar-count">\${row.count}</span>
    \`
    container.appendChild(div)
  }
}

main().catch(console.error)
</script>
</body>
</html>`
}

export async function showDb(opts: { db: Database }): Promise<void> {
	const { db } = opts
	const port = await findFreePort()
	const url = `http://localhost:${port}`

	const genreSimilarityJson = JSON.stringify(GENRE_SIMILARITY)
	const countsJson = JSON.stringify({
		genre2: getGenre2Counts(db),
		mood: getMoodCounts(db),
		tag: getTagCounts(db),
		genre: getGenreCounts(db),
	})

	const server = Deno.serve({ port, onListen: () => {} }, (req) => {
		const path = new URL(req.url).pathname
		if (path === '/') {
			return new Response(buildHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
		}
		if (path === '/api/genre-similarity') {
			return new Response(genreSimilarityJson, { headers: { 'content-type': 'application/json' } })
		}
		if (path === '/api/counts') {
			return new Response(countsJson, { headers: { 'content-type': 'application/json' } })
		}
		return new Response('Not found', { status: 404 })
	})

	console.log(`Serving at ${url}`)
	new Deno.Command('open', { args: [url] }).spawn()

	await server.finished
}
