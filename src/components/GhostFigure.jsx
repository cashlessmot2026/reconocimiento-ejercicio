import { useEffect, useMemo, useRef } from 'react'
import { BONES } from '../lib/pose'

/**
 * Esqueleto animado de la demostración del coach: muestra cómo debe hacerse el ejercicio.
 * `ghost` = { idx, n, seconds, frames: [[x0,y0,x1,y1,...]], mirror } con coordenadas relativas al tronco.
 */
export default function GhostFigure({ ghost, size = 140, color = '#22d3ee', highlight = null, speed = 1, still = false, className = '', label }) {
  const ref = useRef(null)

  const meta = useMemo(() => {
    if (!ghost?.frames?.length) return null
    const pos = Object.fromEntries(ghost.idx.map((id, i) => [id, i]))
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const f of ghost.frames) {
      for (let i = 0; i < f.length; i += 2) {
        if (f[i] < x0) x0 = f[i]; if (f[i] > x1) x1 = f[i]
        if (f[i + 1] < y0) y0 = f[i + 1]; if (f[i + 1] > y1) y1 = f[i + 1]
      }
    }
    const side = Math.max(x1 - x0, y1 - y0) + 1.1
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    const bones = BONES.filter(([a, b]) => a in pos && b in pos).map(([a, b]) => ({
      a: pos[a], b: pos[b], hl: !!highlight && highlight.includes(a) && highlight.includes(b),
    }))
    const joints = ghost.idx.map((id, i) => ({ id, i })).filter((j) => j.id >= 11)
    return { vb: `${cx - side / 2} ${cy - side / 2} ${side} ${side}`, bones, joints, side }
  }, [ghost, highlight])

  useEffect(() => {
    if (!meta) return
    const root = ref.current
    const lines = root.querySelectorAll('line.bone')
    const dots = root.querySelectorAll('circle.joint')
    const head = root.querySelector('circle.head')
    const n = ghost.frames.length
    const dur = ((ghost.seconds || 2) * 1000) / speed
    const hold = 450
    let raf = 0
    const t0 = performance.now()

    const paint = (u) => {
      const k = Math.min(1, Math.max(0, u)) * (n - 1)
      const i0 = Math.floor(k), i1 = Math.min(n - 1, i0 + 1), f = k - i0
      const A = ghost.frames[i0], B = ghost.frames[i1]
      const X = (i) => A[i * 2] + (B[i * 2] - A[i * 2]) * f
      const Y = (i) => A[i * 2 + 1] + (B[i * 2 + 1] - A[i * 2 + 1]) * f
      meta.bones.forEach((bn, j) => {
        const l = lines[j]
        l.setAttribute('x1', X(bn.a)); l.setAttribute('y1', Y(bn.a))
        l.setAttribute('x2', X(bn.b)); l.setAttribute('y2', Y(bn.b))
      })
      meta.joints.forEach((jt, j) => { dots[j].setAttribute('cx', X(jt.i)); dots[j].setAttribute('cy', Y(jt.i)) })
      head.setAttribute('cx', X(0)); head.setAttribute('cy', Y(0))
    }

    if (still) { paint(0.5); return }
    const loop = (now) => {
      paint(((now - t0) % (dur + hold)) / dur)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [meta, ghost, speed, still])

  if (!meta) return null
  return (
    <div className={`ghost ${className}`} style={{ width: size, height: size }}>
      <svg ref={ref} viewBox={meta.vb} width="100%" height="100%" style={{ transform: ghost.mirror ? 'scaleX(-1)' : undefined }} aria-label={label || 'Demostración'}>
        {meta.bones.map((bn, j) => (
          <line key={j} className="bone" stroke={bn.hl ? '#fbbf24' : color} strokeWidth={bn.hl ? 0.11 : 0.075} strokeLinecap="round" />
        ))}
        {meta.joints.map((jt) => <circle key={jt.id} className="joint" r={0.065} fill="#fff" />)}
        <circle className="head" r={0.26} fill="none" stroke={color} strokeWidth={0.075} />
      </svg>
    </div>
  )
}
