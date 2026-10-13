import type { Event } from "@aegisec/sdk/v2"
import { useProject } from "./project"
import { useSDK } from "./sdk"

// Sync events are wrapped in a `sync` envelope with a versioned `name`
// (e.g. "session.updated.1"). Strip the version suffix and use the
// underlying event name as the bus event `type`, and the payload `data`
// as `properties`, so existing handlers can process them like normal
// bus events.
function unwrapSync(payload: any): Event | null {
  if (!payload || payload.type !== "sync") return null
  const name = typeof payload.name === "string" ? payload.name : ""
  const type = name.replace(/\.\d+$/, "") as Event["type"]
  if (!type || !payload.data) return null
  return { type, properties: payload.data } as Event
}

function matches(event: { directory?: string; workspace?: string }, directory: string, workspace?: string) {
  if (event.directory === "global") return true
  if (workspace) return event.workspace === workspace
  return event.directory === directory
}

export function useEvent() {
  const project = useProject()
  const sdk = useSDK()

  function subscribe(handler: (event: Event) => void) {
    return sdk.event.on("event", (event) => {
      // Translate sync events to the bus event shape that the rest of
      // the TUI expects (e.g. "session.updated"). Without this, every
      // session lifecycle update coming through SyncEvent was being
      // dropped on the floor — including renames, which made the
      // session list keep showing the old title.
      const syncPayload = event.payload.type === "sync" ? unwrapSync(event.payload) : null
      const busEvent = syncPayload ?? event.payload

      const directory = project.instance.directory()
      const workspace = project.workspace.current()
      if (!matches(event, directory, workspace)) return

      handler(busEvent as Event)
    })
  }

  function on<T extends Event["type"]>(type: T, handler: (event: Extract<Event, { type: T }>) => void) {
    return subscribe((event) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>)
    })
  }

  return {
    subscribe,
    on,
  }
}
