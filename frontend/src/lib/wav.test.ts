import { describe, expect, it } from 'vitest'

import { encodeWav } from './wav'

const bytes = async (blob: Blob) => new DataView(await blob.arrayBuffer())
const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header the backend validation recognizes', async () => {
    const blob = encodeWav(new Float32Array(16_000), 16_000)
    const view = await bytes(blob)
    expect(blob.type).toBe('audio/wav')
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(32_000)
    expect(view.getUint32(4, true)).toBe(blob.size - 8)
    expect(blob.size).toBe(44 + 32_000)
  })

  it('converts and clamps samples', async () => {
    const view = await bytes(encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 8000))
    const sample = (i: number) => view.getInt16(44 + i * 2, true)
    expect([sample(0), sample(1), sample(2), sample(3), sample(4)]).toEqual([0, 32767, -32768, 32767, -32768])
    expect(sample(5)).toBe(16383)
  })

  it('handles empty input without producing a corrupt header', async () => {
    const view = await bytes(encodeWav(new Float32Array(), 16_000))
    expect(view.byteLength).toBe(44)
    expect(view.getUint32(40, true)).toBe(0)
  })
})
