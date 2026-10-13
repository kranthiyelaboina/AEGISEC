import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config"
import { GlobalBus } from "@/bus/global"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"

// NOTE: Bun (>=1.4) drops Worker message delivery when the worker entry graph
// contains top-level await, so all startup work is chained into `booted` and
// awaited inside each rpc handler instead of at module scope.
const booted = (async () => {
  await Global.ready
  await Log.init({
    print: process.argv.includes("--print-logs"),
    dev: Installation.isLocal(),
    level: (() => {
      if (Installation.isLocal()) return "DEBUG"
      return "INFO"
    })(),
  })
  Heap.start()
})()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    await booted
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async snapshot() {
    await booted
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    await booted
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await booted
    await Instance.provide({
      directory: input.directory,
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await booted
    await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.invalidate(true)))
  },
  async shutdown() {
    await booted
    Log.Default.info("worker shutting down")

    await Instance.disposeAll()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.AEGISEC_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.AEGISEC_SERVER_USERNAME ?? "aegisec"
  return `Basic ${btoa(`${username}:${password}`)}`
}
