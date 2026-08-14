import type { EncodeOptions } from '@jsquash/jpeg/meta'

export const SDR_WHITE_NITS = 203
export const MIN_STOPS = 1
export const MAX_STOPS = 3.9
export const DEFAULT_STOPS = 2.5

const SRGB_TO_XYZ = [
  [0.41239, 0.35758, 0.18048],
  [0.21264, 0.71517, 0.07219],
  [0.01933, 0.11919, 0.95053],
] as const

const XYZ_TO_2020 = [
  [1.71665, -0.35567, -0.25337],
  [-0.66668, 1.61648, 0.01577],
  [0.01764, -0.04277, 0.9421],
] as const

export interface PixelBuffer {
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

export interface ConvertedPixels extends PixelBuffer {
  peakNits: number
  boostedPixels: number
}

let profilePromise: Promise<Uint8Array> | undefined

function srgbToLinear(value: number) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4
}

function pqEncode(nits: number) {
  const m1 = 2610 / 16384
  const m2 = (2523 / 4096) * 128
  const c1 = 3424 / 4096
  const c2 = (2413 / 4096) * 32
  const c3 = (2392 / 4096) * 32
  const y = Math.min(Math.max(nits / 10_000, 0), 1)
  return ((c1 + c2 * y ** m1) / (1 + c3 * y ** m1)) ** m2
}

function multiply3x3(
  matrix: readonly (readonly number[])[],
  vector: readonly [number, number, number],
): [number, number, number] {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

function clampByte(value: number) {
  return Math.min(255, Math.max(0, Math.round(value * 255)))
}

export function peakNitsForStops(stops: number) {
  return Math.round(SDR_WHITE_NITS * 2 ** stops)
}

export function convertToHdr(input: PixelBuffer, stops: number): ConvertedPixels {
  if (!Number.isFinite(stops) || stops < MIN_STOPS || stops > MAX_STOPS) {
    throw new Error(`Strength must be between +${MIN_STOPS} and +${MAX_STOPS} stops.`)
  }

  if (input.data.length !== input.width * input.height * 4) {
    throw new Error('Pixel buffer dimensions do not match its data length.')
  }

  const output = new Uint8ClampedArray(input.data.length)
  const maximumGain = 2 ** stops
  let peakNits = 0
  let boostedPixels = 0

  for (let index = 0; index < input.data.length; index += 4) {
    const linearSrgb: [number, number, number] = [
      srgbToLinear(input.data[index] / 255),
      srgbToLinear(input.data[index + 1] / 255),
      srgbToLinear(input.data[index + 2] / 255),
    ]

    const xyz = multiply3x3(SRGB_TO_XYZ, linearSrgb)
    const rec2020 = multiply3x3(XYZ_TO_2020, xyz).map((channel) =>
      Math.max(0, channel),
    ) as [number, number, number]
    const luminance =
      0.2627 * rec2020[0] + 0.678 * rec2020[1] + 0.0593 * rec2020[2]
    let ramp = Math.min(1, Math.max(0, (luminance - 0.55) / (0.9 - 0.55)))
    ramp = ramp * ramp * (3 - 2 * ramp)
    const gain = 1 + (maximumGain - 1) * ramp ** 1.5

    if (gain > 1.01) boostedPixels += 1

    for (let channel = 0; channel < 3; channel += 1) {
      const nits = rec2020[channel] * SDR_WHITE_NITS * gain
      peakNits = Math.max(peakNits, nits)
      output[index + channel] = clampByte(pqEncode(nits))
    }
    output[index + 3] = 255
  }

  return {
    data: output,
    width: input.width,
    height: input.height,
    peakNits,
    boostedPixels,
  }
}

export function injectIccProfile(
  jpeg: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  profile: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const source = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg)
  if (source.length < 2 || source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error('Encoder did not return a valid JPEG file.')
  }

  const header = new TextEncoder().encode('ICC_PROFILE\0')
  const maxProfileChunk = 65_519
  const chunkCount = Math.ceil(profile.length / maxProfileChunk)
  if (chunkCount > 255) throw new Error('ICC profile is too large for JPEG APP2 markers.')

  const segments: Uint8Array[] = []
  let segmentBytes = 0

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * maxProfileChunk
    const chunk = profile.subarray(start, start + maxProfileChunk)
    const payloadLength = header.length + 2 + chunk.length
    const segment = new Uint8Array(payloadLength + 4)
    segment[0] = 0xff
    segment[1] = 0xe2
    const jpegLength = payloadLength + 2
    segment[2] = jpegLength >> 8
    segment[3] = jpegLength & 0xff
    segment.set(header, 4)
    segment[4 + header.length] = chunkIndex + 1
    segment[5 + header.length] = chunkCount
    segment.set(chunk, 6 + header.length)
    segments.push(segment)
    segmentBytes += segment.length
  }

  const result = new Uint8Array(source.length + segmentBytes)
  result.set(source.subarray(0, 2), 0)
  let offset = 2
  for (const segment of segments) {
    result.set(segment, offset)
    offset += segment.length
  }
  result.set(source.subarray(2), offset)
  return result
}

async function getIccProfile() {
  profilePromise ??= fetch(`${import.meta.env.BASE_URL}rec2020pq.icc`).then(async (response) => {
    if (!response.ok) throw new Error('The bundled Rec.2020 PQ profile could not be loaded.')
    return new Uint8Array(await response.arrayBuffer())
  })
  return profilePromise
}

export async function encodeHdrJpeg(pixels: ConvertedPixels) {
  const [{ default: encode }, profile] = await Promise.all([
    import('@jsquash/jpeg/encode'),
    getIccProfile(),
  ])
  const imageData = new ImageData(pixels.data, pixels.width, pixels.height)
  const options: Partial<EncodeOptions> = {
    quality: 96,
    progressive: true,
    optimize_coding: true,
    auto_subsample: false,
    chroma_subsample: 1,
    separate_chroma_quality: true,
    chroma_quality: 96,
  }
  const jpeg = await encode(imageData, options)
  const tagged = injectIccProfile(jpeg, profile)
  return new Blob([tagged as BlobPart], { type: 'image/jpeg' })
}

export function makeOutputName(inputName: string, stops: number) {
  const stem = inputName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '')
  const strength = String(stops).replace('.', '-')
  return `${stem || 'image'}-superwhite-${strength}stops.jpg`
}
