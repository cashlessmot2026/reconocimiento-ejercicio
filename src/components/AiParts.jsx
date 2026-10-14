import { useState } from 'react'
import { motion } from 'framer-motion'
import { GlowButton, Modal } from './ui'

/** Ventana que ejecuta una consulta de IA y muestra la respuesta como texto. */
export function AiTextModal({ open, onClose, title, hint, run, copyable, children }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr(''); setText('')
    try { setText(await run()) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>✨ {title}</h2>
          {hint && <div className="muted" style={{ fontSize: 13 }}>{hint}</div>}
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>
      {children}
      <div style={{ margin: '14px 0' }}>
        <GlowButton variant="solid" disabled={busy} onClick={go}>{busy ? 'Pensando…' : text ? '↻ Volver a generar' : 'Generar'}</GlowButton>
      </div>
      {busy && <div style={{ textAlign: 'center', padding: 12 }}><div className="loader" /></div>}
      {err && <p style={{ color: 'var(--hot)' }}>{err}</p>}
      {text && (
        <motion.div className="ai-text" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {text}
          {copyable && (
            <div style={{ marginTop: 10 }}>
              <GlowButton variant="sm ghost" onClick={() => navigator.clipboard?.writeText(text)}>📋 Copiar</GlowButton>
            </div>
          )}
        </motion.div>
      )}
      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>Generado con IA. Es orientativo y no sustituye a un profesional de salud.</p>
    </Modal>
  )
}

/** Pregunta libre al asistente (cliente). */
export function AskModal({ open, onClose, ask }) {
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async () => {
    if (q.trim().length < 3) return
    setBusy(true); setErr(''); setA('')
    try { setA(await ask(q.trim())) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>💬 Pregúntale a tu entrenador</h2>
          <div className="muted" style={{ fontSize: 13 }}>Dudas de técnica, ejercicios que sustituyen a otros, cómo progresar…</div>
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>
      <div className="field">
        <textarea className="text-input" rows={3} maxLength={300} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ej.: ¿Qué ejercicio puedo hacer si no puedo hacer dominadas?" />
      </div>
      <GlowButton variant="solid" disabled={busy || q.trim().length < 3} onClick={send}>{busy ? 'Pensando…' : 'Preguntar'}</GlowButton>
      {err && <p style={{ color: 'var(--hot)' }}>{err}</p>}
      {a && <motion.div className="ai-text" style={{ marginTop: 14 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{a}</motion.div>}
      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>Generado con IA; consulta a tu coach ante cualquier duda de salud.</p>
    </Modal>
  )
}
