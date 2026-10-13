import { motion, AnimatePresence } from 'framer-motion'

export function GlowButton({ variant = '', className = '', children, ...rest }) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      className={`glow-btn ${variant} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  )
}

export function Toast({ msg }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          className="toast"
          initial={{ opacity: 0, y: 30, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 30, x: '-50%' }}
        >
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Modal({ open, onClose, children, className = '' }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={`card sheet ${className}`}
            initial={{ y: 40, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.97, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Stepper({ value, onChange, min = 1, max = 99, step = 1 }) {
  return (
    <div className="stepper">
      <GlowButton variant="sm icon ghost" type="button" onClick={() => onChange(Math.max(min, value - step))}>−</GlowButton>
      <b>{value}</b>
      <GlowButton variant="sm icon ghost" type="button" onClick={() => onChange(Math.min(max, value + step))}>+</GlowButton>
    </div>
  )
}

export const fmtDate = (d) =>
  new Date(d).toLocaleDateString('es', { day: '2-digit', month: 'short' })
