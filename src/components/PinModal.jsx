import { useEffect, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { api } from '../lib/api'
import { GlowButton, Modal } from './ui'

export default function PinModal({ open, title, onClose, onSuccess }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const shake = useAnimationControls()

  useEffect(() => { if (open) { setPin(''); setErr('') } }, [open])

  useEffect(() => {
    if (pin.length !== 4) return
    setBusy(true)
    api.adminCheck(pin)
      .then((ok) => {
        if (ok) onSuccess(pin)
        else {
          setErr('PIN incorrecto')
          shake.start({ x: [0, -12, 12, -8, 8, 0], transition: { duration: 0.4 } })
          setPin('')
        }
      })
      .catch((e) => { setErr(e.message); setPin('') })
      .finally(() => setBusy(false))
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const press = (d) => !busy && setPin((p) => (p.length < 4 ? p + d : p))

  return (
    <Modal open={open} onClose={onClose} className="pin-sheet">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>🔐</div>
        <h2 style={{ margin: '6px 0 0' }}>{title}</h2>
        <p className="muted" style={{ margin: '6px 0 0' }}>Acceso restringido</p>
      </div>
      <motion.div className="pin-dots" animate={shake}>
        {[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </motion.div>
      <p style={{ textAlign: 'center', color: 'var(--hot)', minHeight: 20, margin: '0 0 10px' }}>{err}</p>
      <div className="keypad" style={{ maxWidth: 300, margin: '0 auto' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <GlowButton key={d} variant="ghost" onClick={() => press(d)}>{d}</GlowButton>
        ))}
        <GlowButton variant="ghost hot" onClick={onClose}>✕</GlowButton>
        <GlowButton variant="ghost" onClick={() => press('0')}>0</GlowButton>
        <GlowButton variant="ghost" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</GlowButton>
      </div>
    </Modal>
  )
}
