import { createEffect, createSignal, onCleanup, onMount, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useRenderer } from "@opentui/solid"
import { InstallationVersion } from "@/installation/version"
import { BRAND } from "./glyph"
import { logo } from "@/cli/logo"

// Metasploit-style startup banner: the wordmark "decrypts" line by line with
// scrolling cipher noise, then the meta lines type in. Any key skips it.
const FRAME_MS = 28
const LINE_STAGGER_MS = 70
const LINE_REVEAL_MS = 260
const HOLD_MS = 650
const FADE_MS = 90

const NOISE_CHARS = "▓▒░█@#%&*=+-<>?/\\|^~#$/\\<>+=~"

const LOGO_LINES = logo.left.map((line, i) => line + " ".repeat(3) + logo.right[i])

const META_LINES = [
  `${BRAND.wordmark} v${InstallationVersion}`,
  BRAND.tagline,
  `developed by ${BRAND.author}`,
]

function decryptLine(target: string, progress: number) {
  if (progress >= 1) return target
  const reveal = Math.floor(target.length * progress)
  let out = ""
  for (let i = 0; i < target.length; i++) {
    const ch = target[i]
    if (ch === " " || i < reveal) out += ch
    else out += NOISE_CHARS[Math.floor(Math.random() * NOISE_CHARS.length)]
  }
  return out
}

export function BootSplash() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [active, setActive] = createSignal(true)
  const [tick, setTick] = createSignal(0)
  const [done, setDone] = createSignal(false)
  let interval: NodeJS.Timeout | undefined
  let finish: NodeJS.Timeout | undefined
  const startedAt = Date.now()

  const elapsed = () => Date.now() - startedAt

  const totalReveal = () => (LOGO_LINES.length - 1) * LINE_STAGGER_MS + LINE_REVEAL_MS

  const finishUp = () => {
    if (done()) return
    setDone(true)
    if (interval) clearInterval(interval)
    finish = setTimeout(() => {
      setActive(false)
      renderer.requestRender()
    }, FADE_MS).unref?.()
  }

  onMount(() => {
    const env = (process.env["AEGISEC_BOOT"] || "").toLowerCase()
    if (env === "off" || env === "0" || env === "false") {
      setActive(false)
      return
    }
    interval = setInterval(() => {
      setTick((t) => t + 1)
      if (elapsed() > totalReveal() + HOLD_MS) finishUp()
    }, FRAME_MS).unref?.()
    // hard cap so a stuck timer can never block the TUI
    finish = setTimeout(finishUp, totalReveal() + HOLD_MS + 500).unref?.()
  })

  onCleanup(() => {
    if (interval) clearInterval(interval)
    if (finish) clearTimeout(finish)
  })

  // any keypress skips the banner
  createEffect(() => {
    if (!active()) return
    const handler = () => finishUp()
    process.stdin.once("keypress", handler)
    onCleanup(() => process.stdin.removeListener("keypress", handler))
  })

  return (
    <Show when={active()}>
      <box
        position="absolute"
        zIndex={9999}
        left={0}
        right={0}
        top={0}
        bottom={0}
        backgroundColor={theme.background}
        justifyContent="center"
        alignItems="center"
      >
        <box flexDirection="column" alignItems="flex-start" gap={0}>
          <For each={LOGO_LINES}>
            {(line, index) => {
              const lineStart = index() * LINE_STAGGER_MS
              const progress = () => {
                void tick()
                if (done()) return 1
                return Math.min(1, Math.max(0, (elapsed() - lineStart) / LINE_REVEAL_MS))
              }
              return (
                <text fg={theme.primary}>
                  {done() ? line : decryptLine(line, progress())}
                </text>
              )
            }}
          </For>
          <box height={1} />
          <For each={META_LINES}>
            {(line, index) => {
              const lineStart = totalReveal() + index() * 90
              const progress = () => {
                void tick()
                if (done()) return 1
                return Math.min(1, Math.max(0, (elapsed() - lineStart) / 120))
              }
              return (
                <text fg={index() === 0 ? theme.text : theme.textMuted}>
                  {done() ? line : decryptLine(line, progress())}
                </text>
              )
            }}
          </For>
        </box>
      </box>
    </Show>
  )
}
