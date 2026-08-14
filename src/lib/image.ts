import type { PixelBuffer } from './hdr'

const MAX_DIMENSION = 4096

export async function fileToPixels(file: File): Promise<PixelBuffer> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('Choose a PNG or JPEG file.')
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width !== bitmap.height) {
      throw new Error(`This image is ${bitmap.width} × ${bitmap.height}. Choose a square logo.`)
    }
    if (bitmap.width > MAX_DIMENSION) {
      throw new Error(`This image is too large. Keep each side at ${MAX_DIMENSION}px or less.`)
    }

    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser cannot create an image canvas.')
    context.drawImage(bitmap, 0, 0)
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { data: imageData.data, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

export function makeDemoPixels(size = 720): PixelBuffer {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser cannot create an image canvas.')

  context.fillStyle = '#0b0b0b'
  context.fillRect(0, 0, size, size)
  context.strokeStyle = '#292929'
  context.lineWidth = Math.max(2, size * 0.004)
  context.strokeRect(size * 0.065, size * 0.065, size * 0.87, size * 0.87)

  context.fillStyle = '#ffffff'
  context.font = `900 ${size * 0.315}px/1 Arial, Helvetica, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('SW', size / 2, size * 0.47)

  context.fillStyle = '#8c8c8c'
  context.font = `600 ${size * 0.038}px/1 ui-monospace, SFMono-Regular, monospace`
  context.letterSpacing = `${size * 0.014}px`
  context.fillText('REFERENCE 203', size / 2, size * 0.73)

  const imageData = context.getImageData(0, 0, size, size)
  return { data: imageData.data, width: size, height: size }
}

export function pixelsToSdrUrl(pixels: PixelBuffer) {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot create an image canvas.')
  context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
  return canvas.toDataURL('image/png')
}
