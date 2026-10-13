import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultModel, loadPoseLandmarker } from './pose'
import { createLandmarkFilter } from './filters'

/**
 * Cámara + detector de pose con el bucle más rápido disponible:
 *  - requestVideoFrameCallback: se procesa cada fotograma nuevo de la cámara en cuanto llega
 *    (sin esperar al siguiente refresco de pantalla ni repetir fotogramas).
 *  - Cámara a 60 fps y resolución moderada (menos datos que subir a la GPU).
 *  - Filtro One-Euro: suaviza sin el retraso de una media móvil.
 *
 * onFrame({ lm, world, now, ctx, W, H, video }) se llama una vez por fotograma.
 */
export function usePoseCamera({ onFrame, smoothing = { minCutoff: 1.2, beta: 8 } }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const vpRef = useRef(null)
  const streamRef = useRef(null)
  const lmRef = useRef(null)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const filt = useRef({
    img: createLandmarkFilter(smoothing),
    world: createLandmarkFilter({ minCutoff: smoothing.minCutoff, beta: smoothing.beta * 0.6 }),
  })

  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [facing, setFacing] = useState('user')
  const [model, setModel] = useState(defaultModel())
  const [fps, setFps] = useState(0)
  const [latency, setLatency] = useState(0)

  const startCamera = useCallback(async (mode) => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    const portrait = window.innerHeight > window.innerWidth
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: mode,
        width: { ideal: portrait ? 540 : 960 },
        height: { ideal: portrait ? 960 : 540 },
        frameRate: { ideal: 60, min: 24 },
      },
    })
    streamRef.current = stream
    const v = videoRef.current
    v.srcObject = stream
    await v.play()
  }, [])

  // Inicialización
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se requiere HTTPS).')
        const [lm] = await Promise.all([loadPoseLandmarker(model), startCamera(facing)])
        if (!alive) return
        lmRef.current = lm
        setStatus('ready')
      } catch (e) {
        if (!alive) return
        setError(e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en la configuración del navegador.' : e.message)
        setStatus('error')
      }
    })()
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Bucle de visión
  useEffect(() => {
    const v = videoRef.current
    let stop = false, handle = 0, lastT = -1, frames = 0, fpsT = performance.now(), latSum = 0
    const useVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
    const schedule = () => {
      if (stop) return
      handle = useVFC ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
    }
    const tick = () => {
      schedule()
      const c = canvasRef.current, det = lmRef.current
      if (!c || !det || v.readyState < 2 || v.currentTime === lastT) return
      lastT = v.currentTime
      const now = performance.now()
      let res
      try { res = det.detectForVideo(v, now) } catch { return }
      const raw = res.landmarks?.[0] || null
      const rawW = res.worldLandmarks?.[0] || null
      const lm = filt.current.img.apply(raw, now)
      const world = filt.current.world.apply(rawW, now)
      latSum += performance.now() - now
      onFrameRef.current?.({ lm, world, now, ctx: c.getContext('2d'), W: c.width, H: c.height, video: v })
      frames++
      if (now - fpsT >= 1000) {
        setFps(frames); setLatency(Math.round(latSum / frames))
        frames = 0; latSum = 0; fpsT = now
      }
    }
    schedule()
    return () => {
      stop = true
      if (useVFC) v.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
    }
  }, [])

  // Lienzo nítido y adaptado al contenedor
  useEffect(() => {
    const el = vpRef.current
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const c = canvasRef.current
      c.width = Math.round(el.clientWidth * dpr)
      c.height = Math.round(el.clientHeight * dpr)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const flip = useCallback(async () => {
    const next = facing === 'user' ? 'environment' : 'user'
    await startCamera(next)
    setFacing(next)
  }, [facing, startCamera])

  const switchModel = useCallback(async () => {
    const next = model === 'lite' ? 'full' : 'lite'
    const det = await loadPoseLandmarker(next)
    lmRef.current = det
    filt.current.img.reset(); filt.current.world.reset()
    setModel(next)
  }, [model])

  const stop = useCallback(() => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  return { videoRef, canvasRef, vpRef, status, error, facing, flip, model, switchModel, fps, latency, stop }
}
