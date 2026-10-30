/**
 * Captures a MediaStream (the other participant's incoming audio) as 16 kHz mono 16-bit PCM frames for the backend.
 *
 * An AudioWorklet taps the stream at the context's own rate; the main thread averages it down to 16 kHz and cuts it
 * into fixed-length frames. Nothing is kept beyond the frame being filled, and stop() releases every node.
 */

const TAP_SOURCE = `
class VoxShieldTap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.filled = 0 }
  process(inputs) {
    const channels = inputs[0]
    if (channels && channels.length) {
      const length = channels[0].length
      for (let i = 0; i < length; i++) {
        let sum = 0
        for (let c = 0; c < channels.length; c++) sum += channels[c][i]
        this.buffer[this.filled++] = sum / channels.length
        if (this.filled === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.filled = 0 }
      }
    }
    return true
  }
}
registerProcessor('voxshield-tap', VoxShieldTap)
`

/** Streaming box-filter downsampler. Each output sample is the mean of the input samples it covers. */
export class Downsampler {
  private readonly inputRate: number
  private readonly outputRate: number
  // Integer bookkeeping (in units of 1/inputRate/outputRate seconds), so 44.1 kHz input never drifts.
  private position = 0
  private sum = 0
  private count = 0

  constructor(inputRate: number, outputRate = 16_000) {
    if (inputRate < outputRate) throw new Error('Input rate must be at least the output rate')
    this.inputRate = Math.round(inputRate)
    this.outputRate = outputRate
  }

  push(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(((input.length + 1) * this.outputRate) / this.inputRate) + 1)
    let written = 0
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]
      this.count++
      this.position += this.outputRate
      if (this.position >= this.inputRate) {
        out[written++] = this.sum / this.count
        this.position -= this.inputRate
        this.sum = 0
        this.count = 0
      }
    }
    return out.subarray(0, written)
  }
}

/** Collects 16 kHz float samples into Int16 frames of a fixed size. */
export class FrameBuilder {
  private frame: Int16Array<ArrayBuffer>
  private filled = 0
  private readonly size: number
  private readonly onFrame: (frame: ArrayBuffer) => void

  constructor(size: number, onFrame: (frame: ArrayBuffer) => void) {
    this.size = size
    this.onFrame = onFrame
    this.frame = new Int16Array(size)
  }

  push(samples: Float32Array) {
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]))
      this.frame[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff
      if (this.filled === this.size) {
        this.onFrame(this.frame.buffer)
        this.frame = new Int16Array(this.size)
        this.filled = 0
      }
    }
  }

  clear() {
    this.frame = new Int16Array(this.size)
    this.filled = 0
  }
}

const tapLoaded = new WeakSet<BaseAudioContext>()

export interface PcmCapture {
  stop(): void
}

/** Starts capturing `stream`. Frames are `frameSeconds` long at `sampleRate`. Needs an AudioContext that is running. */
export async function capturePcm(context: AudioContext, stream: MediaStream, sampleRate: number, frameSeconds: number, onFrame: (frame: ArrayBuffer) => void): Promise<PcmCapture> {
  if (!tapLoaded.has(context)) {
    const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: 'text/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
      tapLoaded.add(context) // registering the same processor twice in one context throws
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const source = context.createMediaStreamSource(stream)
  const tap = new AudioWorkletNode(context, 'voxshield-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2 })
  // A silent sink keeps the graph pulled, so the tap runs, without playing the audio a second time.
  const sink = context.createGain()
  sink.gain.value = 0
  source.connect(tap).connect(sink).connect(context.destination)

  const downsampler = new Downsampler(context.sampleRate, sampleRate)
  const frames = new FrameBuilder(Math.round(sampleRate * frameSeconds), onFrame)
  tap.port.onmessage = (event: MessageEvent<Float32Array>) => frames.push(downsampler.push(event.data))

  return {
    stop() {
      tap.port.onmessage = null
      source.disconnect()
      tap.disconnect()
      sink.disconnect()
      frames.clear()
    },
  }
}
