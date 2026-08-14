import { describe, expect, it } from 'vitest'
import { calculateOutputSize } from './image'

describe('dimension-preserving image preparation', () => {
  it('leaves a 1920 × 1080 image at 1920 × 1080', () => {
    expect(calculateOutputSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  it('leaves very large input dimensions unchanged', () => {
    expect(calculateOutputSize(8000, 4000)).toEqual({ width: 8000, height: 4000 })
  })

  it('leaves square dimensions unchanged', () => {
    expect(calculateOutputSize(400, 400)).toEqual({ width: 400, height: 400 })
  })
})
