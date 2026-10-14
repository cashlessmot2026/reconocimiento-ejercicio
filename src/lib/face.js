// Reconocimiento facial en dos velocidades:
//  1. Seguimiento rápido (cada fotograma, GPU): MediaPipe FaceLandmarker — 478 puntos, pose de la cabeza
//     y parpadeo (blendshapes). Sirve para guiar al usuario y decidir CUÁNDO capturar.
//  2. Descriptor (solo en fotogramas útiles): face-api — detector TinyFace + 68 puntos + ResNet-34
//     (descriptor de 128 dimensiones, 99.38 % en LFW). Solo se envían a Supabase los vectores;
//     la comparación se hace en el servidor (pgvector).
import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { getVisionFileset } from './pose'

const FACEAPI_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/'
const MP_FACE = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let loading = null
let fapi = null
let tracker = null

export function loadFace() {
  if (loading) return loading
  loading = (async () => {
    const [api, fileset] = await Promise.all([import('@vladmandic/face-api'), getVisionFileset()])
    fapi = api
    try { await fapi.tf.setBackend('webgl') } catch { /* backend por defecto */ }
    await fapi.tf.ready()
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MP_FACE, delegate },
      runningMode: 'VIDEO', numFaces: 1,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,
    })
    const mk = async () => {
      try { return await FaceLandmarker.createFromOptions(fileset, opts('GPU')) } catch { return FaceLandmarker.createFromOptions(fileset, opts('CPU')) }
    }
    ;[tracker] = await Promise.all([
      mk(),
      fapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODELS),
      fapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODELS),
      fapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODELS),
    ])
    // Calentamiento: la primera inferencia compila los shaders
    const warm = document.createElement('canvas'); warm.width = warm.height = 160
    await fapi.detectSingleFace(warm, new fapi.TinyFaceDetectorOptions({ inputSize: 160 })).withFaceLandmarks().withFaceDescriptor().catch(() => null)
    return true
  })()
  loading.catch(() => { loading = null })
  return loading
}

const statCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
let lastStats = { light: 128, sharp: 100 }, statFrame = 0

/**
 * Seguimiento rápido de un fotograma. Coordenadas normalizadas del video SIN espejo.
 * yaw > 0  = la persona gira hacia SU izquierda · pitchRaw menor = mira hacia arriba.
 */
export function trackFace(video, ts) {
  const r = tracker.detectForVideo(video, ts)
  const lm = r.faceLandmarks?.[0]
  if (!lm) return null
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y }
  const nose = lm[1], fore = lm[10], chin = lm[152], cA = lm[234], cB = lm[454]
  const faceW = Math.abs(cB.x - cA.x) || 1e-3
  const faceH = Math.abs(chin.y - fore.y) || 1e-3
  const yaw = (nose.x - (cA.x + cB.x) / 2) / faceW
  const pitchRaw = (nose.y - (fore.y + chin.y) / 2) / faceH
  const eyeL = lm[33], eyeR = lm[263]
  let roll = (Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x) * 180) / Math.PI
  if (roll > 90) roll -= 180
  if (roll < -90) roll += 180
  const bs = Object.fromEntries((r.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]))
  const blink = Math.max(bs.eyeBlinkLeft || 0, bs.eyeBlinkRight || 0)
  const box = { x: x0 * video.videoWidth, y: y0 * video.videoHeight, width: (x1 - x0) * video.videoWidth, height: (y1 - y0) * video.videoHeight }
  if (++statFrame % 6 === 0) lastStats = cropStats(video, box)
  const sizeRatio = x1 - x0
  const q = {
    yaw, pitchRaw, roll, blink, sizeRatio, ...lastStats,
    okSize: sizeRatio >= 0.11,
    okFar: sizeRatio <= 0.75,
    okLight: lastStats.light >= 40 && lastStats.light <= 230,
    okSharp: lastStats.sharp >= 6,
  }
  q.frontal = Math.abs(yaw) < 0.07 && Math.abs(roll) < 12
  q.good = q.okSize && q.okFar && q.okLight && q.okSharp && Math.abs(roll) < 22
  return { lm, box, quality: q }
}

/** Descriptor de 128 dimensiones del rostro actual (solo cuando hace falta). */
export async function describeFace(video) {
  const r = await fapi
    .detectSingleFace(video, new fapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
  if (!r || r.detection.score < 0.6) return null
  return { descriptor: Array.from(r.descriptor), score: r.detection.score }
}

export function descDistance(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

/** Brillo medio y nitidez (varianza del laplaciano) del recorte del rostro. */
function cropStats(video, box) {
  if (!statCanvas || box.width < 8) return lastStats
  const w = 64, h = 64
  statCanvas.width = w; statCanvas.height = h
  const c = statCanvas.getContext('2d', { willReadFrequently: true })
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

/** Abre la cámara; si falla con restricciones, reintenta con las mínimas. */
export async function openCamera(video) {
  try { return await navigator.mediaDevices.getUserMedia({ audio: false, video }) } catch (e) {
    if (e.name === 'NotAllowedError') throw e
    let last = e
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: video.facingMode || 'user' } }) } catch (e2) { last = e2 }
    // Si la cámara por defecto está ocupada, probar cada una de las demás cámaras disponibles
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId)
    for (const cam of cams) {
      try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: cam.deviceId } } }) } catch (e3) { last = e3 }
    }
    throw last
  }
}

export function cameraError(e) {
  if (e?.name === 'NotAllowedError') return 'Permiso de cámara denegado. Actívalo en la configuración del navegador.'
  if (e?.name === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación o pestaña. Ciérrala y pulsa Reintentar.'
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No se encontró una cámara disponible.'
  return e?.message || 'Error de cámara'
}
