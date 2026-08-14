import { describe, expect, it } from 'vitest'
import {
  convertToHdr,
  injectIccProfile,
  makeOutputName,
  peakNitsForStops,
  type PixelBuffer,
} from './hdr'

function pixels(values: number[]): PixelBuffer {
  return { data: new Uint8ClampedArray(values), width: values.length / 4, height: 1 }
}

describe('SuperWhite HDR conversion', () => {
  it('targets 203 nits plus the requested exposure', () => {
    expect(peakNitsForStops(2)).toBe(812)
    expect(peakNitsForStops(3)).toBe(1624)
  })

  it('raises white while keeping black at the PQ floor', () => {
    const result = convertToHdr(pixels([0, 0, 0, 255, 255, 255, 255, 255]), 2)
    expect(Array.from(result.data.slice(0, 3))).toEqual([0, 0, 0])
    expect(result.data[4]).toBeGreaterThan(180)
    expect(result.peakNits).toBeGreaterThan(800)
    expect(result.boostedPixels).toBe(1)
  })

  it('rejects invalid strengths and malformed pixel data', () => {
    expect(() => convertToHdr(pixels([255, 255, 255, 255]), 4)).toThrow(/between/)
    expect(() =>
      convertToHdr({ data: new Uint8ClampedArray(3), width: 1, height: 1 }, 2),
    ).toThrow(/dimensions/)
  })

})

describe('JPEG profile packaging', () => {
  it('inserts an ICC APP2 segment after the JPEG start marker', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const profile = new Uint8Array([1, 2, 3, 4])
    const result = injectIccProfile(jpeg, profile)
    const identifier = new TextDecoder().decode(result.slice(6, 18))

    expect(Array.from(result.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe2])
    expect(identifier).toBe('ICC_PROFILE\0')
    expect(Array.from(result.slice(-2))).toEqual([0xff, 0xd9])
  })

  it('rejects non-JPEG input', () => {
    expect(() => injectIccProfile(new Uint8Array([1, 2]), new Uint8Array([3]))).toThrow(
      /valid JPEG/,
    )
  })
})

describe('output naming', () => {
  it('creates a safe descriptive file name', () => {
    expect(makeOutputName('My logo.final.png', 2.5)).toBe(
      'My-logo-final-superwhite-2-5stops.jpg',
    )
  })
})
