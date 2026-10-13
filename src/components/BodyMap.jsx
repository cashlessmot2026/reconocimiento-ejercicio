import { motion } from 'framer-motion'

// Silueta estilizada; cada zona corresponde a ej_muscle_groups.region
const ZONES = {
  shoulders: ['M58 62 q-14 2 -18 18 l14 6 q4 -14 14 -16z', 'M122 62 q14 2 18 18 l-14 6 q-4 -14 -14 -16z'],
  chest: ['M64 64 h24 v26 q-14 4 -26 -4 q-2 -14 2 -22z', 'M116 64 h-24 v26 q14 4 26 -4 q2 -14 -2 -22z'],
  back: ['M58 86 q-6 18 0 36 l8 -2 q-4 -16 0 -32z', 'M122 86 q6 18 0 36 l-8 -2 q4 -16 0 -32z'],
  arms: ['M40 84 l14 6 l-4 34 l-14 -4z', 'M140 84 l-14 6 l4 34 l14 -4z'],
  forearms: ['M36 124 l14 4 l-6 34 l-12 -2z', 'M144 124 l-14 4 l6 34 l12 -2z'],
  core: ['M70 94 h40 v44 q-20 8 -40 0z'],
  glutes: ['M66 140 q24 10 48 0 l2 14 q-26 10 -52 0z'],
  thighs: ['M64 156 q12 6 24 4 l-4 62 h-16z', 'M116 156 q-12 6 -24 4 l4 62 h16z'],
  calves: ['M68 228 h14 l-2 52 h-10z', 'M112 228 h-14 l2 52 h10z'],
}

export default function BodyMap({ groups, loads, size = 220 }) {
  // loads: { groupId: 0..1 }
  const byRegion = {}
  Object.entries(loads || {}).forEach(([gid, v]) => {
    const g = groups[gid]
    if (!g) return
    const cur = byRegion[g.region]
    if (!cur || v > cur.v) byRegion[g.region] = { v, color: g.color }
  })
  return (
    <svg viewBox="0 0 180 300" width={size} height={(size * 300) / 180} style={{ maxWidth: '100%', height: 'auto' }}>
      <defs>
        <filter id="bm-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx="90" cy="34" r="18" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
      <path d="M58 60 q32 -12 64 0 l20 24 l-4 44 l-10 40 l-10 -2 l2 -30 l-4 6 l2 20 l-4 64 l-4 56 h-14 l-6 -60 h-0 l-6 60 h-14 l-4 -56 l-4 -64 l2 -20 l-4 -6 l2 30 l-10 2 l-10 -40 l-4 -44z"
        fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" />
      {Object.entries(ZONES).map(([region, paths]) => {
        const z = byRegion[region]
        const v = z ? Math.max(0.12, Math.min(1, z.v)) : 0
        return paths.map((d, i) => (
          <motion.path
            key={region + i}
            d={d}
            fill={z ? z.color : 'rgba(255,255,255,0.05)'}
            stroke={z ? z.color : 'rgba(255,255,255,0.12)'}
            strokeWidth="1"
            filter={z && v > 0.4 ? 'url(#bm-glow)' : undefined}
            initial={false}
            animate={{ fillOpacity: z ? 0.18 + v * 0.75 : 1 }}
            transition={{ duration: 0.6 }}
          />
        ))
      })}
    </svg>
  )
}
