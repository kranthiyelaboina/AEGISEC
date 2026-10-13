import { Buffer } from "node:buffer"
import { inflateSync } from "node:zlib"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useKV } from "@tui/context/kv"
import { BACKDROP_COLS, BACKDROP_ROWS, BACKDROP_COLORS, BACKDROP_DATA } from "@tui/asset/backdrop-data"

const FRAME_MS = 120

interface Run {
  len: number
  color: string
}

// Inflate once and slice into one palette-index grid per frame.
const CELL = BACKDROP_COLS * BACKDROP_ROWS
const FRAMES: Uint8Array[] = (() => {
  const buf = inflateSync(Buffer.from(BACKDROP_DATA.replace(/\s+/g, ""), "base64"))
  const frames: Uint8Array[] = []
  for (let offset = 0; offset + CELL <= buf.length; offset += CELL) {
    frames.push(buf.subarray(offset, offset + CELL))
  }
  return frames
})()

// Palette as RGB triples for area averaging.
const PAL_RGB = new Uint8Array(BACKDROP_COLORS.length * 3)
BACKDROP_COLORS.forEach((hex, i) => {
  PAL_RGB[i * 3] = parseInt(hex.slice(1, 3), 16)
  PAL_RGB[i * 3 + 1] = parseInt(hex.slice(3, 5), 16)
  PAL_RGB[i * 3 + 2] = parseInt(hex.slice(5, 7), 16)
})

// Nearest-palette lookup cached on a 15-bit quantized RGB key so averaging
// stays cheap even when every destination cell covers many source pixels.
const NEAREST = new Int16Array(32 * 32 * 32).fill(-1)
function nearestColor(r: number, g: number, b: number): number {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  let best = NEAREST[key]!
  if (best >= 0) return best
  let bestDist = Infinity
  for (let i = 0; i < BACKDROP_COLORS.length; i++) {
    const dr = r - PAL_RGB[i * 3]!
    const dg = g - PAL_RGB[i * 3 + 1]!
    const db = b - PAL_RGB[i * 3 + 2]!
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  NEAREST[key] = best
  return best
}

// Cover-fit sampling of the source grid onto width x height terminal cells,
// returning one row of color runs per terminal row. Each destination cell
// averages every source pixel it covers (box filter), which keeps downscaled
// output smooth instead of blocky.
function sampleFrame(frameIndex: number, width: number, height: number): Run[][] {
  const frame = FRAMES[frameIndex % FRAMES.length]!
  const srcAspect = BACKDROP_COLS / BACKDROP_ROWS
  const dstAspect = width / height
  let srcCols = BACKDROP_COLS
  let srcRows = BACKDROP_ROWS
  if (dstAspect > srcAspect) {
    srcRows = Math.max(1, Math.round(BACKDROP_COLS / dstAspect))
  } else {
    srcCols = Math.max(1, Math.round(BACKDROP_ROWS * dstAspect))
  }
  const colOff = Math.floor((BACKDROP_COLS - srcCols) / 2)
  const rowOff = Math.floor((BACKDROP_ROWS - srcRows) / 2)

  const out: Run[][] = []
  for (let y = 0; y < height; y++) {
    // Source row range this terminal row covers.
    const y0 = Math.min(BACKDROP_ROWS, rowOff + Math.floor((y * srcRows) / height))
    const y1 = Math.max(y0 + 1, Math.min(BACKDROP_ROWS, rowOff + Math.floor(((y + 1) * srcRows) / height)))

    const runs: Run[] = []
    let len = 0
    let current = -1
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(BACKDROP_COLS, colOff + Math.floor((x * srcCols) / width))
      const x1 = Math.max(x0 + 1, Math.min(BACKDROP_COLS, colOff + Math.floor(((x + 1) * srcCols) / width)))

      // Average RGB over the covered source rectangle.
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        const base = sy * BACKDROP_COLS
        for (let sx = x0; sx < x1; sx++) {
          const idx = frame[base + sx]! * 3
          r += PAL_RGB[idx]!
          g += PAL_RGB[idx + 1]!
          b += PAL_RGB[idx + 2]!
          n++
        }
      }
      const cell = n > 0 ? nearestColor(Math.round(r / n), Math.round(g / n), Math.round(b / n)) : 0

      if (cell === current) {
        len++
      } else {
        if (len > 0) runs.push({ len, color: BACKDROP_COLORS[current]! })
        current = cell
        len = 1
      }
    }
    if (len > 0 && current >= 0) runs.push({ len, color: BACKDROP_COLORS[current]! })
    out.push(runs)
  }
  return out
}

export function GifBackdrop() {
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const [animations] = kv.signal<boolean>("animations_enabled", true)
  const [frame, setFrame] = createSignal(0)

  onMount(() => {
    if (!animations()) return
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length)
    }, FRAME_MS)
    timer.unref?.()
    onCleanup(() => clearInterval(timer))
  })

  const rows = createMemo(() => {
    void animations()
    const index = animations() ? frame() : 0
    const width = Math.max(1, dimensions().width)
    const height = Math.max(1, dimensions().height)
    return sampleFrame(index, width, height)
  })

  return (
    <Show when={dimensions().width > 0}>
      <box position="absolute" left={0} top={0} width={dimensions().width} height={dimensions().height} zIndex={-1}>
        <For each={rows()}>
          {(runs) => (
            <box flexDirection="row" flexShrink={0} height={1} width="100%">
              <For each={runs}>{(run) => <box width={run.len} height={1} backgroundColor={run.color} />}</For>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}
