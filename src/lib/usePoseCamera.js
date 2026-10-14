import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultModel, isMobile, loadPoseLandmarker } from './pose'
import { createLandmarkFilter } from './filters'
import { cameraError, openCamera } from './camera'
import { camPref } from './display'

const guessFacing = (label = '') =>
  /back|rear|trasera|posterior|environment|world/i.test(label) ? 'environment'
    : /front|frontal|user|selfie|facetime|delantera/i.test(label) ? 'user' : ''

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
  const [stage, setStage] = useState('camera')       // camera | model: qué se está esperando
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [facing, setFacing] = useState(() => camPref.get())
  const [cameras, setCameras] = useState([]) // [{ id, label, facing }]
  const [activeId, setActiveId] = useState('')
  const [model, setModel] = useState(defaultModel())
  const [fps, setFps] = useState(0)
  const [delegate, setDelegate] = useState('')
  const [latency, setLatency] = useState(0)

  const refreshDevices = useCallback(async () => {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId)
      setCameras(list.map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}`, facing: guessFacing(d.label) })))
    } catch { /* sin lista de cámaras */ }
  }, [])

  /**
   * Abre una cámara por orientación (frontal/trasera) o por id.
   * Con `exact` no hay reintentos: si esa cámara no existe falla, para poder buscar otra.
   * Devuelve lo que el dispositivo declara (facingMode / deviceId).
   */
  const startCamera = useCallback(async (mode, deviceId, exact = false) => {
    streamRef.current?.getTracks().forEach((t) => t.stop()) // muchos celulares no abren dos cámaras a la vez
    const portrait = window.innerHeight > window.innerWidth
    const size = {
      // En celular se pide menos resolución y 30 fps: el modelo trabaja con una imagen pequeña
      // y 60 fps solo añade carga que el teléfono no alcanza a procesar.
      width: { ideal: isMobile() ? (portrait ? 360 : 640) : (portrait ? 540 : 960) },
      height: { ideal: isMobile() ? (portrait ? 640 : 360) : (portrait ? 960 : 540) },
      frameRate: isMobile() ? { ideal: 30, max: 30 } : { ideal: 60, min: 24 },
    }
    const wanted = deviceId
      ? { ...size, deviceId: { exact: deviceId } }
      : { ...size, facingMode: exact ? { exact: mode } : mode }
    const stream = exact || deviceId
      ? await navigator.mediaDevices.getUserMedia({ audio: false, video: wanted })
      : await openCamera(wanted)
    streamRef.current = stream
    const v = videoRef.current
    v.srcObject = stream
    await v.play()
    const st = stream.getVideoTracks()[0]?.getSettings?.() || {}
    setActiveId(st.deviceId || '')
    refreshDevices()
    return {
      reported: st.facingMode === 'user' || st.facingMode === 'environment' ? st.facingMode : '',
      deviceId: st.deviceId || '',
    }
  }, [refreshDevices])

  // Inicialización (con tiempo límite: antes, si la cámara o el modelo no respondían, se quedaba cargando para siempre)
  useEffect(() => {
    let alive = true
    const limit = (p, ms, msg) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(msg)), ms)
      p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
    })
    ;(async () => {
      try {
        setStatus('loading'); setError(''); setStage('camera')
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se requiere HTTPS).')
        const camP = limit(startCamera(facing), 20000,
          'La cámara no responde. Cierra otras apps o pestañas que la usen (WhatsApp, Zoom, cámara virtual) y pulsa Reintentar.')
          .then((c) => { if (alive) setStage('model'); return c })
        const lmP = limit(loadPoseLandmarker(model), 75000,
          'No se pudo cargar el modelo de visión. Revisa tu conexión a internet y pulsa Reintentar.')
        const [lm, cam] = await Promise.all([lmP, camP])
        if (!alive) return
        if (cam.reported && cam.reported !== facing) setFacing(cam.reported)
        lmRef.current = lm
        setDelegate(lm.delegateUsed || '')
        setStatus('ready')
      } catch (e) {
        if (!alive) return
        setError(cameraError(e))
        setStatus('error')
      }
    })()
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bucle de visión
  useEffect(() => {
    const v = videoRef.current
    let stop = false, handle = 0, lastT = -1, frames = 0, fpsT = performance.now(), latSum = 0
    const useVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
    const schedule = () => {
      if (stop) return
      handle = useVFC ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
    }
    let lastProcess = performance.now()
    const tick = () => {
      schedule()
      process()
    }
    // Respaldo: si el navegador deja de notificar fotogramas (ventana oculta, ahorro de energía)
    const watchdog = setInterval(() => { if (performance.now() - lastProcess > 200) process() }, 100)
    const process = () => {
      lastProcess = performance.now()
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
      clearInterval(watchdog)
      if (useVFC) v.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
    }
  }, [])

  // Lienzo nítido y adaptado al contenedor
  useEffect(() => {
    const el = vpRef.current
    const ro = new ResizeObserver(() => {
      const dpr = isMobile() ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      const c = canvasRef.current
      c.width = Math.round(el.clientWidth * dpr)
      c.height = Math.round(el.clientHeight * dpr)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Cambia entre cámara frontal y trasera. Devuelve { ok, message? } para avisar al usuario. */
  const flip = useCallback(async () => {
    const target = facing === 'user' ? 'environment' : 'user'
    const name = target === 'environment' ? 'trasera' : 'frontal'
    const current = streamRef.current?.getVideoTracks()[0]?.getSettings?.().deviceId
    try {
      // 1) La cámara con la orientación pedida (celulares)
      const r = await startCamera(target, undefined, true)
      const f = r.reported || target
      setFacing(f); camPref.set(f)
      return { ok: true, message: `Cámara ${f === 'environment' ? 'trasera' : 'frontal'}` }
    } catch {
      // No existe: volver a la anterior y buscar otra cámara distinta
      try { await startCamera(facing) } catch { /* se informa abajo */ }
      const other = cameras.find((c) => c.id !== current && (!c.facing || c.facing === target)) || cameras.find((c) => c.id !== current)
      if (other) {
        try {
          const r = await startCamera(target, other.id)
          const f = r.reported || other.facing || target
          setFacing(f); camPref.set(f)
          return { ok: true, message: `Cámara: ${other.label}` }
        } catch { try { await startCamera(facing) } catch { /* sin cámara */ } }
      }
      // 2) Una sola cámara (PC): solo se invierte el espejo
      setFacing(target); camPref.set(target)
      return { ok: true, message: target === 'user' ? 'Vista espejo activada' : 'Vista espejo desactivada (este equipo tiene una sola cámara)' }
    }
  }, [facing, startCamera, cameras])

  const selectCamera = useCallback(async (id) => {
    const cam = cameras.find((c) => c.id === id)
    if (!cam) return { ok: false, message: 'Cámara no disponible' }
    try {
      const r = await startCamera(cam.facing || facing, id)
      const f = r.reported || cam.facing || facing
      setFacing(f); camPref.set(f)
      return { ok: true, message: `Cámara: ${cam.label}` }
    } catch {
      try { await startCamera(facing) } catch { /* sin cámara */ }
      return { ok: false, message: 'No se pudo abrir esa cámara' }
    }
  }, [cameras, facing, startCamera])

  const switchModel = useCallback(async () => {
    const next = model === 'lite' ? 'full' : 'lite'
    const det = await loadPoseLandmarker(next)
    lmRef.current = det
    setDelegate(det.delegateUsed || '')
    filt.current.img.reset(); filt.current.world.reset()
    setModel(next)
  }, [model])

  const stop = useCallback(() => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])

  return { videoRef, canvasRef, vpRef, status, stage, retry, error, facing, flip, selectCamera, cameras, activeId, model, switchModel, fps, latency, delegate, stop }
}
