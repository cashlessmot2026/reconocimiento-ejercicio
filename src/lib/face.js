// Reconocimiento facial: detector SSD MobileNet v1 + 68 puntos + red de reconocimiento
// (ResNet-34, descriptor de 128 dimensiones, 99.38 % en LFW). Solo se envían a la base de
// datos los descriptores numéricos; la comparación se hace en Supabase (pgvector).

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/'
let loading = null
let fapi = null

export function loadFace() {
  if (loading) return loading
  loading = (async () => {
    fapi = await import('@vladmandic/face-api')
    try { await fapi.tf.setBackend('webgl') } catch { /* usa el backend por defecto */ }
    await fapi.tf.ready()
    await Promise.all([
      fapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      fapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      fapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    return fapi
  })()
  loading.catch(() => { loading = null })
  return loading
}

const lumCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null

/** Analiza un fotograma y devuelve el rostro con métricas de calidad. */
export async function analyzeFace(video) {
  const opts = new fapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 1 })
  const r = await fapi.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor()
  if (!r) return null
  const { box, score } = r.detection
  const pts = r.landmarks.positions
  const eyeL = avg(pts.slice(36, 42)), eyeR = avg(pts.slice(42, 48))
  const nose = pts[30]
  const eyeDist = Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y) || 1
  const mid = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 }
  const yaw = (nose.x - mid.x) / eyeDist                          // ≈0 de frente; >0 = gira a su izquierda
  const pitchRaw = (nose.y - mid.y) / eyeDist                     // menor = mira arriba (se compara con su línea base)
  const roll = (Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI
  const ear = (eyeAR(pts.slice(36, 42)) + eyeAR(pts.slice(42, 48))) / 2
  const sizeRatio = box.width / video.videoWidth
  const { light, sharp } = cropStats(video, box)
  const q = {
    score, yaw, pitchRaw, roll, ear, sizeRatio, light, sharp,
    okSize: sizeRatio >= 0.16,
    okLight: light >= 55 && light <= 215,
    okScore: score >= 0.8,
    okSharp: sharp >= 25,
    frontal: Math.abs(yaw) < 0.12 && Math.abs(roll) < 12,
  }
  q.good = q.okSize && q.okLight && q.okScore && q.okSharp
  return { box, score, landmarks: pts, descriptor: Array.from(r.descriptor), quality: q }
}

export function descDistance(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

const avg = (ps) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const eyeAR = (e) => (dist(e[1], e[5]) + dist(e[2], e[4])) / (2 * dist(e[0], e[3]) || 1)

/** Brillo medio y nitidez (varianza del laplaciano) del recorte del rostro. */
function cropStats(video, box) {
  if (!lumCanvas) return { light: 128, sharp: 100 }
  const w = 64, h = 64
  lumCanvas.width = w; lumCanvas.height = h
  const c = lumCanvas.getContext('2d', { willReadFrequently: true })
  c.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, w, h)
  const d = c.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    sum += g[i]
  }
  let m = 0, m2 = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x
      const lap = g[k - 1] + g[k + 1] + g[k - w] + g[k + w] - 4 * g[k]
      m += lap; m2 += lap * lap; n++
    }
  }
  m /= n
  return { light: sum / (w * h), sharp: m2 / n - m * m }
}
