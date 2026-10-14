import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import ExerciseTrainer from './ExerciseTrainer'
import GhostFigure from './GhostFigure'
import { GlowButton, Modal } from './ui'

/** Biblioteca de ejercicios del coach: ver, entrenar uno nuevo, grabar su demostración o quitarlo. */
export default function ExerciseLibrary({ open, onClose, boot, pin, notify, onChanged }) {
  const [trainer, setTrainer] = useState(null) // null | { existing?: exercise }
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const { exercises, groups } = boot

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return exercises.filter((e) => !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
  }, [exercises, filter])

  const remove = async (e) => {
    setBusy(e.id)
    try { await api.adminSetExerciseActive(pin, e.id, false); notify(`«${e.name}» quitado de la biblioteca`); onChanged() } catch (er) { notify(er.message) } finally { setBusy(null) }
  }
  const clearDemo = async (e) => {
    setBusy(e.id)
    try { await api.adminClearDemo(pin, e.id); notify('Demostración borrada'); onChanged() } catch (er) { notify(er.message) } finally { setBusy(null) }
  }

  if (trainer) {
    return (
      <Modal open onClose={() => setTrainer(null)} className="trainer-sheet">
        <ExerciseTrainer
          boot={boot} pin={pin} notify={notify} existing={trainer.existing}
          onClose={() => setTrainer(null)}
          onSaved={() => { setTrainer(null); onChanged() }}
        />
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} className="trainer-sheet">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>🎓 Biblioteca de ejercicios</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Enséñale un ejercicio al sistema grabándolo tú: aprende la articulación, los ángulos, el ritmo y la forma correcta, y la usa para contar y puntuar a tus clientes.
          </div>
        </div>
        <GlowButton variant="sm icon hot ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>✕</GlowButton>
      </div>

      <div style={{ display: 'flex', gap: 10, margin: '14px 0', flexWrap: 'wrap' }}>
        <GlowButton variant="solid ok" onClick={() => setTrainer({})}>＋ Entrenar ejercicio nuevo</GlowButton>
        <input className="text-input" style={{ maxWidth: 260 }} placeholder="Buscar ejercicio…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>
          {exercises.filter((e) => e.ghost).length} de {exercises.length} con demostración
        </span>
      </div>

      <div className="lib-grid">
        {list.map((e) => {
          const g = groups[e.primary_group]
          const boxing = e.kind === 'boxing'
          return (
            <div key={e.id} className="card lib-card" style={{ '--gc': g?.color }}>
              <div className="lib-ghost">
                {e.ghost ? <GhostFigure ghost={e.ghost} size={92} still /> : <span style={{ fontSize: 34 }}>{e.icon}</span>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{e.icon} {e.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{e.category} · {e.joint_label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
                  {e.custom && <span className="chip" style={{ fontSize: 11 }}>Personalizado</span>}
                  {e.ghost
                    ? <span className="chip ok" style={{ fontSize: 11 }}>✓ Demostración{e.learned?.quality != null ? ` · ${e.learned.quality}%` : ''}</span>
                    : <span className="chip" style={{ fontSize: 11 }}>Sin demostración</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!boxing && <GlowButton variant="sm" onClick={() => setTrainer({ existing: e })}>🎬 {e.ghost ? 'Regrabar' : 'Grabar demo'}</GlowButton>}
                  {e.ghost && <GlowButton variant="sm ghost" disabled={busy === e.id} onClick={() => clearDemo(e)}>Borrar demo</GlowButton>}
                  {e.custom && <GlowButton variant="sm hot ghost" disabled={busy === e.id} onClick={() => remove(e)}>Quitar</GlowButton>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
