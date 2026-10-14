import { useState } from 'react'
import {
  fullscreenOnScreen, hasExtendedScreen, isIOS, isStandalone, listScreens, multiScreenCapable,
  useFullscreen, useTvMode,
} from '../lib/display'
import { GlowButton, Modal } from './ui'

/** Botón de pantalla completa (oculto donde el navegador no la permite, p. ej. Safari en iPhone). */
export function FullscreenButton({ notify, variant = 'icon ghost' }) {
  const fs = useFullscreen()
  if (!fs.supported) return null
  return (
    <GlowButton
      variant={variant}
      title={fs.on ? 'Salir de pantalla completa' : 'Pantalla completa'}
      onClick={async () => { if (!(await fs.toggle())) notify?.('El navegador no permitió la pantalla completa') }}
    >
      {fs.on ? '⤓' : '⛶'}
    </GlowButton>
  )
}

/** Botones para la barra superior de inicio y del panel. */
export function TopbarDisplay({ notify }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <FullscreenButton notify={notify} variant="sm icon ghost" />
      <GlowButton variant="sm icon ghost" title="Pantalla y TV" onClick={() => setOpen(true)}>📺</GlowButton>
      <TvSheet open={open} onClose={() => setOpen(false)} notify={notify} />
    </>
  )
}

const HOW = [
  ['Chrome o Edge (PC o Android)', 'Menú ⋮ → «Guardar y compartir» → «Transmitir…» → elige tu TV (Chromecast / Google TV) y «Transmitir pestaña».'],
  ['Windows', 'Tecla Windows + K → elige el TV o proyector inalámbrico. Con cable HDMI: Windows + P → «Extender» y usa el botón de abajo para enviar la app a esa pantalla.'],
  ['iPhone / iPad', 'Centro de control → «Duplicar pantalla» → elige tu Apple TV o TV compatible con AirPlay.'],
  ['Android (Samsung y otros)', 'Panel rápido → «Smart View» o «Transmitir pantalla» → elige tu TV.'],
  ['Navegador del propio TV', 'Abre la dirección de la app. La mayoría de TVs no tiene cámara: sirve para ver el panel del coach y las estadísticas, no para entrenar.'],
]

export function TvSheet({ open, onClose, notify }) {
  const fs = useFullscreen()
  const [tv, setTv] = useTvMode()
  const [screens, setScreens] = useState(null)
  const [busy, setBusy] = useState(false)
  const multi = multiScreenCapable() && hasExtendedScreen()

  const loadScreens = async () => {
    setBusy(true)
    try { setScreens(await listScreens()) } catch { notify?.('No se concedió el permiso para ver las pantallas') } finally { setBusy(false) }
  }
  const toScreen = async (sc) => {
    try { await fullscreenOnScreen(sc); onClose() } catch { notify?.('No se pudo abrir en esa pantalla') }
  }

  return (
    <Modal open={open} onClose={onClose} className="tv-sheet">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>📺 Pantalla y TV</h2>
          <div className="muted" style={{ fontSize: 13 }}>Pantalla completa, interfaz grande y cómo verlo en un televisor.</div>
        </div>
        <GlowButton variant="sm icon hot ghost" onClick={onClose}>✕</GlowButton>
      </div>

      <div className="form-sec" style={{ marginTop: 14 }}>
        <div className="form-sec-title">⛶ Pantalla completa</div>
        {fs.supported ? (
          <GlowButton variant="solid" onClick={async () => { if (!(await fs.toggle())) notify?.('El navegador no permitió la pantalla completa') }}>
            {fs.on ? 'Salir de pantalla completa' : 'Ampliar a pantalla completa'}
          </GlowButton>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {isIOS() && !isStandalone()
              ? 'Safari en iPhone no permite la pantalla completa. Instala la app: Compartir → «Añadir a pantalla de inicio», y se abrirá sin barras del navegador.'
              : 'Este navegador no permite la pantalla completa. Prueba con Chrome o instala la app.'}
          </p>
        )}
        {multi && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Detecté otra pantalla conectada (TV o monitor). Envía la app a ella en pantalla completa:</div>
            {!screens && <GlowButton variant="ghost" disabled={busy} onClick={loadScreens}>{busy ? 'Buscando…' : 'Elegir pantalla'}</GlowButton>}
            {screens && (
              <div style={{ display: 'grid', gap: 8 }}>
                {screens.map((sc) => (
                  <GlowButton key={sc.i} variant="ghost" onClick={() => toScreen(sc)}>
                    🖥 {sc.label} · {sc.w}×{sc.h}{sc.primary ? ' · principal' : ''}
                  </GlowButton>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="form-sec">
        <div className="form-sec-title">🔎 Tamaño de la interfaz</div>
        <div className="seg">
          {[['', 'Automático'], ['on', 'Modo TV (grande)'], ['off', 'Normal']].map(([v, l]) => (
            <button key={l} type="button" className={tv === v ? 'on' : ''} onClick={() => setTv(v)}>{l}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          Automático agranda textos y botones en pantallas grandes (TV, monitores 4K). «Modo TV» los agranda siempre, para verlos desde el sillón.
        </p>
      </div>

      <div className="form-sec">
        <div className="form-sec-title">📡 Ver la app en un televisor</div>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
          Lo más cómodo: haz el ejercicio con la cámara de tu celular o PC y <b>transmite la pantalla</b> al TV. El análisis sigue corriendo en tu dispositivo.
          Un navegador web no puede iniciar la transmisión por sí mismo; se activa desde tu dispositivo:
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {HOW.map(([t, d]) => (
            <details key={t} className="how">
              <summary>{t}</summary>
              <p>{d}</p>
            </details>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          La pantalla se mantiene encendida mientras haces el ejercicio{'wakeLock' in navigator ? '.' : ' (si tu navegador lo permite).'}
        </p>
      </div>
    </Modal>
  )
}
