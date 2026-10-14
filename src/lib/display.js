// Pantalla: pantalla completa, varias pantallas (TV por HDMI), modo TV y pantalla siempre encendida.
import { useCallback, useEffect, useState } from 'react'

// ---------- Preferencias (no deben romper nada si el almacenamiento está bloqueado) ----------
export const prefs = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } },
}

// ---------- Pantalla completa ----------
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null
export const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
export const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true
export const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))

export async function enterFullscreen(el = document.documentElement, options) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  if (!fn) throw new Error('unsupported')
  await fn.call(el, options)
}
export async function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  if (fn) await fn.call(document)
}

export function useFullscreen() {
  const [on, setOn] = useState(!!fsElement())
  useEffect(() => {
    const h = () => setOn(!!fsElement())
    document.addEventListener('fullscreenchange', h)
    document.addEventListener('webkitfullscreenchange', h)
    return () => {
      document.removeEventListener('fullscreenchange', h)
      document.removeEventListener('webkitfullscreenchange', h)
    }
  }, [])
  const toggle = useCallback(async (options) => {
    try {
      if (fsElement()) await exitFullscreen()
      else await enterFullscreen(document.documentElement, options)
      return true
    } catch { return false }
  }, [])
  return { on, toggle, supported: fullscreenSupported() }
}

// ---------- Varias pantallas (Window Management API: Chrome/Edge de escritorio) ----------
export const multiScreenCapable = () => 'getScreenDetails' in window
export const hasExtendedScreen = () => !!window.screen?.isExtended

export async function listScreens() {
  if (!multiScreenCapable()) return []
  const d = await window.getScreenDetails() // pide permiso al usuario
  return d.screens.map((s, i) => ({
    i, raw: s, label: s.label || `Pantalla ${i + 1}`, w: s.width, h: s.height,
    primary: !!s.isPrimary, internal: !!s.isInternal,
  }))
}
export const fullscreenOnScreen = (screen) => enterFullscreen(document.documentElement, { screen: screen.raw })

// ---------- Modo TV (interfaz grande) ----------
// ''  = automático (se agranda sola en pantallas de 1700 px o más) · 'on' = siempre grande · 'off' = tamaño normal
export function applyTvMode(v) {
  const el = document.documentElement
  if (v === 'on' || v === 'off') el.dataset.tv = v
  else delete el.dataset.tv
}
export function useTvMode() {
  const [mode, setMode] = useState(() => prefs.get('kinetic.tv', ''))
  const set = useCallback((v) => { prefs.set('kinetic.tv', v); applyTvMode(v); setMode(v) }, [])
  return [mode, set]
}

// ---------- Pantalla siempre encendida durante el ejercicio ----------
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined
    let lock = null, dead = false
    const get = async () => { try { lock = await navigator.wakeLock.request('screen') } catch { /* no disponible */ } }
    const vis = () => { if (document.visibilityState === 'visible' && !dead) get() }
    get()
    document.addEventListener('visibilitychange', vis)
    return () => {
      dead = true
      document.removeEventListener('visibilitychange', vis)
      lock?.release?.().catch(() => {})
    }
  }, [active])
}

// ---------- Cámara preferida (frontal / trasera) ----------
export const camPref = {
  get() { return prefs.get('kinetic.cam', 'user') === 'environment' ? 'environment' : 'user' },
  set(v) { prefs.set('kinetic.cam', v === 'environment' ? 'environment' : 'user') },
}
