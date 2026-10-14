import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
export const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
}

export const isMobile = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))

export const defaultModel = () => (isMobile() ? 'lite' : 'full')

let fileset = null
const cache = {}

/** WASM de MediaPipe Vision compartido (pose y rostro). */
export async function getVisionFileset() {
  fileset ??= await FilesetResolver.forVisionTasks(WASM)
  return fileset
}

/** Carga (una vez por variante) el detector de pose de 33 puntos. Sin máscara de
 *  segmentación: leerla de la GPU en cada fotograma era el principal cuello de botella. */
export function loadPoseLandmarker(variant = defaultModel()) {
  if (cache[variant]) return cache[variant]
  cache[variant] = (async () => {
    await getVisionFileset()
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODELS[variant], delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.6,
      outputSegmentationMasks: false,
    })
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'))
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, opts('CPU'))
    }
  })()
  cache[variant].catch(() => { delete cache[variant] })
  return cache[variant]
}

// Conexiones del esqueleto (índices MediaPipe)
export const BONES = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [15, 19], [16, 20],
]
export const LEFT = new Set([11, 13, 15, 19, 23, 25, 27, 31])
