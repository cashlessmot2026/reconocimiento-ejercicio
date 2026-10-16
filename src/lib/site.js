import { useEffect, useState } from 'react'
import { api } from './api'

// Archivos propios del gimnasio (carpeta public/media); respeta la ruta base del despliegue
const M = (p) => `${import.meta.env.BASE_URL}media/${p}`

/** Contenido por defecto de la página principal. El administrador lo sobrescribe desde «Sitio web». */
export const DEFAULT_SITE = {
  brand: { name: 'AR-COMBAT', tagline: 'Gimnasio de boxeo', logo: '' },
  hero: {
    slides: [
      {
        id: 's1', kicker: 'GIMNASIO DE BOXEO', title: 'Forja tu mejor versión en el ring',
        subtitle: 'Técnica, intensidad y tecnología que mide cada golpe. Entrena como un boxeador, con seguimiento real de tu progreso.',
        image: M('eventos/e01.jpg'), cta_label: 'Ver planes', cta_target: 'planes',
      },
      {
        id: 's2', kicker: 'CURSOS PRESENCIALES', title: 'Del primer jab al combate',
        subtitle: 'Cursos por niveles con entrenadores de boxeo: fundamentos, combinaciones, defensa y sparring técnico.',
        image: M('eventos/e10.jpg'), cta_label: 'Conocer los cursos', cta_target: 'cursos',
      },
      {
        id: 's3', kicker: 'CLASES ONLINE', title: 'Entrena boxeo desde donde estés',
        subtitle: 'Clases en vivo y rutinas guiadas. Tu cámara cuenta tus golpes y corrige tu guardia en tiempo real.',
        image: M('eventos/e02.jpg'), cta_label: 'Ver clases online', cta_target: 'online',
      },
    ],
  },
  features: {
    title: 'Entrenamiento que se mide',
    items: [
      { icon: '🥊', title: 'Golpes medidos', text: 'Jab, directo, ganchos y uppercuts clasificados, con velocidad y precisión.' },
      { icon: '🛡️', title: 'Guardia vigilada', text: 'La cámara detecta cuánto tiempo mantienes la guardia arriba.' },
      { icon: '📅', title: 'Reserva tu clase', text: 'Elige día y hora con cupo disponible desde tu celular.' },
      { icon: '📈', title: 'Progreso real', text: 'Evaluación física, objetivos y evolución semana a semana.' },
    ],
  },
  courses: {
    title: 'Cursos de boxeo',
    intro: 'Programas presenciales por niveles, con grupos reducidos y atención personalizada.',
    items: [
      { title: 'Boxeo iniciación', level: 'Principiante', text: 'Postura, guardia, desplazamientos y los golpes básicos. Ideal si nunca has boxeado.', schedule: 'Lun · Mié · Vie', image: M('eventos/e10.jpg') },
      { title: 'Técnica y combinaciones', level: 'Intermedio', text: 'Combinaciones, defensa, trabajo de pads y condición física específica de boxeo.', schedule: 'Mar · Jue', image: M('eventos/e02.jpg') },
      { title: 'Competencia y sparring', level: 'Avanzado', text: 'Preparación táctica, rounds de combate y sparring controlado.', schedule: 'Sáb', image: M('eventos/e04.jpg') },
    ],
  },
  online: {
    title: 'Clases online de boxeo',
    intro: 'Entrena en casa con clases guiadas. Tu cámara mide tus golpes y te dice cómo mejorar.',
    items: [
      { title: 'Cardio box en vivo', text: 'Sesiones de alta quema con rounds cronometrados.', price: '', image: M('eventos/e03.jpg') },
      { title: 'Técnica desde casa', text: 'Fundamentos y combinaciones paso a paso con corrección de postura.', price: '', image: M('eventos/e07.jpg') },
    ],
    cta_label: 'Quiero entrenar online',
  },
  events: {
    title: 'Eventos',
    intro: 'Veladas, torneos y entregas de medallas: así se vive «Nace un Guerrero» en AR Templo del Combate.',
    images: [
      { src: M('eventos/e01.jpg'), caption: 'Nace un Guerrero · toda la familia AR' },
      { src: M('eventos/e02.jpg'), caption: 'Sparring en el ring' },
      { src: M('eventos/e03.jpg'), caption: 'Velada de combates' },
      { src: M('eventos/e04.jpg'), caption: 'Rounds de competencia' },
      { src: M('eventos/e05.jpg'), caption: 'Los más jóvenes también pelean' },
      { src: M('eventos/e06.jpg'), caption: 'Equipo AR Templo del Combate' },
      { src: M('eventos/e07.jpg'), caption: 'Esquina: el coach en cada round' },
      { src: M('eventos/e08.jpg'), caption: 'Medallas para los campeones' },
      { src: M('eventos/e09.jpg'), caption: 'Orgullo de gimnasio' },
      { src: M('eventos/e10.jpg'), caption: 'Entrenamiento con manoplas' },
    ],
  },
  venue: {
    title: 'Nuestra sede',
    intro: 'Un espacio hecho para el boxeo: ring, sacos y entrenadores que te acompañan en cada round.',
    items: [
      { type: 'image', src: M('sede/sede-1.jpg'), caption: 'El coach en acción' },
      { type: 'video', src: M('sede/sede-v1.mp4'), poster: M('sede/sede-v1.jpg'), caption: 'Entrenamiento en la sede' },
      { type: 'video', src: M('sede/sede-v2.mp4'), poster: M('sede/sede-v2.jpg'), caption: 'Combate en el ring' },
    ],
  },
  plans_section: { title: 'Planes', intro: 'Elige tu plan, paga con QR y adjunta tu comprobante. Activamos tu acceso cuando validamos el pago.' },
  plans: [
    {
      id: 'xl', name: 'Plan XL', price: 110000, period: 'mes', tagline: 'Entrena boxeo todo el mes',
      features: ['Clases grupales de boxeo', 'Medición de golpes con cámara', 'Reserva de clases desde la app', 'Seguimiento de tu progreso'],
      highlight: false, badge: '',
    },
    {
      id: 'xl-cardio', name: 'Plan XL Cardio Box', price: 0, period: 'mes', tagline: 'Boxeo + cardio de alta quema',
      features: ['Todo lo del Plan XL', 'Clases de cardio box', 'Rutinas de resistencia y velocidad', 'Evaluación física y objetivos'],
      highlight: false, badge: '',
    },
    {
      id: 'elite-combat', name: 'Plan Elite Combat', price: 0, period: 'mes', tagline: 'Profesional, intenso y de mayor exigencia',
      features: ['Rounds de combate y sparring técnico', 'Rutinas de alta exigencia', 'Seguimiento personalizado del entrenador', 'Prioridad en reservas'],
      highlight: true, badge: 'Más exigente',
    },
  ],
  payment: {
    qr_image: '',
    instructions: 'Escanea el código QR con tu app bancaria, paga el valor exacto de tu plan y adjunta aquí la captura del comprobante.',
    account_info: '',
  },
  contact: { title: 'Visítanos', address: '', schedule: '', whatsapp: '', instagram: '', email: '' },
}

export const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0)

/** Mezcla el contenido guardado sobre el de por defecto: objetos por clave, listas completas. */
export function mergeSite(db) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SITE))
  if (!db || typeof db !== 'object') return out
  for (const k of Object.keys(db)) {
    const v = db[k]
    if (Array.isArray(v)) { if (v.length) out[k] = v } else if (v && typeof v === 'object') out[k] = { ...out[k], ...v }
  }
  // Fotos vacías en lo guardado → se usan las del gimnasio por defecto (no quedan ejemplos con emoji)
  const fill = (list, base) => Array.isArray(list) && list.forEach((it, i) => { if (it && !it.image && base?.[i]?.image) it.image = base[i].image })
  fill(out.hero?.slides, DEFAULT_SITE.hero.slides)
  fill(out.courses?.items, DEFAULT_SITE.courses.items)
  fill(out.online?.items, DEFAULT_SITE.online.items)
  return out
}

let cached = null
export function useSite() {
  const [site, setSite] = useState(() => mergeSite(cached))
  useEffect(() => {
    let alive = true
    api.loadSite().then((s) => { if (!alive || !s) return; cached = s; setSite(mergeSite(s)) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const refresh = async () => {
    const s = await api.loadSite().catch(() => null)
    if (s) { cached = s; setSite(mergeSite(s)) }
  }
  return [site, refresh]
}

// Enlace de WhatsApp a partir de un número escrito libremente. 10 dígitos = Colombia (+57).
export const waLink = (number, text = '') => {
  let d = String(number || '').replace(/\D/g, '').replace(/^00/, '')
  if (d.length === 10) d = '57' + d
  if (d.length < 8) return ''
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}
