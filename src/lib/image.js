/** Lee un archivo y lo devuelve como data URL. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('No se pudo leer el archivo'))
    r.readAsDataURL(file)
  })
}

/** Reduce una imagen a JPEG ligero para guardarla en la base de datos. */
export async function compressImage(file, { maxSide = 1400, quality = 0.78 } = {}) {
  const url = await fileToDataUrl(file)
  const img = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('El archivo no es una imagen válida'))
    i.src = url
  })
  const k = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', quality) }
}
