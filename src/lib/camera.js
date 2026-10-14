/** Abre la cámara; si falla con restricciones, reintenta con las mínimas y luego con cada cámara disponible. */
export async function openCamera(video) {
  try { return await navigator.mediaDevices.getUserMedia({ audio: false, video }) } catch (e) {
    if (e.name === 'NotAllowedError') throw e
    let last = e
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: video.facingMode || 'user' } }) } catch (e2) { last = e2 }
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId)
    for (const cam of cams) {
      try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: cam.deviceId } } }) } catch (e3) { last = e3 }
    }
    throw last
  }
}

export function cameraError(e) {
  if (e?.name === 'NotAllowedError') return 'Permiso de cámara denegado. Actívalo en la configuración del navegador.'
  if (e?.name === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación o pestaña. Ciérrala y pulsa Reintentar.'
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No se encontró una cámara disponible.'
  return e?.message || 'Error de cámara'
}
