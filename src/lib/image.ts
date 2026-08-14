import type { PixelBuffer } from './hdr'

export interface LoadedPixels extends PixelBuffer {
  originalWidth: number
  originalHeight: number
}

export interface OutputSize {
  width: number
  height: number
}

export function calculateOutputSize(
  sourceWidth: number,
  sourceHeight: number,
): OutputSize {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('Image dimensions must be positive numbers.')
  }

  return {
    width: Math.round(sourceWidth),
    height: Math.round(sourceHeight),
  }
}

export async function fileToPixels(file: File): Promise<LoadedPixels> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Choose an image file.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This browser could not decode that image. Try exporting it as PNG or JPEG.')
  }

  try {
    const output = calculateOutputSize(bitmap.width, bitmap.height)

    const canvas = document.createElement('canvas')
    canvas.width = output.width
    canvas.height = output.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser cannot create an image canvas.')

    context.fillStyle = '#0b0b0b'
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(bitmap, 0, 0)
    const imageData = context.getImageData(0, 0, output.width, output.height)
    return {
      data: imageData.data,
      width: output.width,
      height: output.height,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
    }
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
