import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const cache = new Map()

/** Resuelve «media:<id>» (imagen subida por el administrador) o una URL normal. */
export function useMedia(src) {
  const isRef = typeof src === 'string' && src.startsWith('media:')
  const [url, setUrl] = useState(() => (isRef ? cache.get(src) || '' : src || ''))
  useEffect(() => {
    if (!isRef) { setUrl(src || ''); return undefined }
    if (cache.has(src)) { setUrl(cache.get(src)); return undefined }
    let alive = true
    api.media(src.slice(6)).then((m) => {
      if (m?.data) { cache.set(src, m.data); if (alive) setUrl(m.data) }
    }).catch(() => {})
    return () => { alive = false }
  }, [src, isRef])
  return url
}

/** Imagen con respaldo (degradado + emoji) cuando aún no hay foto. */
export function Img({ src, alt = '', className = '', fallback = '🥊', style }) {
  const url = useMedia(src)
  if (!url) return <div className={`img-fallback ${className}`} style={style} role="img" aria-label={alt}><span>{fallback}</span></div>
  return <img className={className} style={style} src={url} alt={alt} loading="lazy" />
}
