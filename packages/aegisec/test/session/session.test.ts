import { describe, expect, test } from "bun:test"
import path from "path"
import { Session as SessionNs } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Operation } from "../../src/core/operation"
import * as OperationResolver from "../../src/core/operation/resolver"
import { Cyber } from "../../src/core/cyber"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
void Log.init({ print: false })

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function get(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(id)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
}

function updateMessage<T extends MessageV2.Info>(msg: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
}

function updatePart<T extends MessageV2.Part>(part: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updatePart(part)))
}

describe("session.created event", () => {
  test("should emit session.created event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: SessionNs.Info | undefined

        const unsub = Bus.subscribe(SessionNs.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as SessionNs.Info
        })

        const info = await create({})
        await new Promise((resolve) => setTimeout(resolve, 100))
        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(info.id)
        expect(receivedInfo?.projectID).toBe(info.projectID)
        expect(receivedInfo?.directory).toBe(info.directory)
        expect(receivedInfo?.title).toBe(info.title)

        await remove(info.id)
      },
    })
  })

  test("session.created event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubCreated = Bus.subscribe(SessionNs.Event.Created, () => {
          events.push("created")
        })

        const unsubUpdated = Bus.subscribe(SessionNs.Event.Updated, () => {
          events.push("updated")
        })

        const info = await create({})
        await new Promise((resolve) => setTimeout(resolve, 100))
        unsubCreated()
        unsubUpdated()

        expect(events).toContain("created")
        expect(events).toContain("updated")
        expect(events.indexOf("created")).toBeLessThan(events.indexOf("updated"))

        await remove(info.id)
      },
    })
  })
})

describe("step-finish token propagation via Bus event", () => {
  test(
    "non-zero tokens propagate through PartUpdated event",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const info = await create({})

          const messageID = MessageID.ascending()
          await updateMessage({
            id: messageID,
            sessionID: info.id,
            role: "user",
            time: { created: Date.now() },
            agent: "user",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as unknown as MessageV2.Info)

          let received: MessageV2.Part | undefined
          const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            received = event.properties.part
          })

          const tokens = {
            total: 1500,
            input: 500,
            output: 800,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          }

          const partInput = {
            id: PartID.ascending(),
            messageID,
            sessionID: info.id,
            type: "step-finish" as const,
            reason: "stop",
            cost: 0.005,
            tokens,
          }

          await updatePart(partInput)
          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(received).toBeDefined()
          expect(received!.type).toBe("step-finish")
          const finish = received as MessageV2.StepFinishPart
          expect(finish.tokens.input).toBe(500)
          expect(finish.tokens.output).toBe(800)
          expect(finish.tokens.reasoning).toBe(200)
          expect(finish.tokens.total).toBe(1500)
          expect(finish.tokens.cache.read).toBe(100)
          expect(finish.tokens.cache.write).toBe(50)
          expect(finish.cost).toBe(0.005)
          expect(received).not.toBe(partInput)

          unsub()
          await remove(info.id)
        },
      })
    },
    { timeout: 30000 },
  )
})

describe("Session", () => {
  test("remove works without an instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => create({ title: "remove-without-instance" }),
    })

    await expect(async () => {
      await remove(info.id)
    }).not.toThrow()

    let missing = false
    await get(info.id).catch(() => {
      missing = true
    })

    expect(missing).toBe(true)
  })

  test("creating a session attaches it to the active operation and cyber kernel", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const op = await Operation.create({ workspace: tmp.path, label: "Bridge", kind: "pentest" })
        const info = await create({ title: "attached-session" })

        const sessionFile = path.join(tmp.path, ".aegisec", "operation", op.slug, "sessions", `${info.id}.json`)
        expect(await Bun.file(sessionFile).exists()).toBe(true)

        const facts = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: op.slug, limit: 100 }))
        const relations = await AppRuntime.runPromise(
          Cyber.listLedger({ operation_slug: op.slug, limit: 100 }),
        )

        expect(facts.some((item) => item.entity_kind === "session" && item.entity_key === info.id)).toBe(true)
        expect(
          facts.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === op.slug &&
              item.fact_name === "autonomy_policy" &&
              JSON.stringify(item.value_json).includes("\"mode\":\"custom\""),
          ),
        ).toBe(true)
        expect(relations.some((item) => item.summary?.includes(String(info.id)))).toBe(true)

        await remove(info.id)
      },
    })
  })

  test("session operation binding survives workspace active operation changes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const opA = await Operation.create({ workspace: tmp.path, label: "Terminal A", kind: "pentest" })
        const sessionA = await create({ title: "terminal-a", operationSlug: opA.slug })
        const opB = await Operation.create({ workspace: tmp.path, label: "Terminal B", kind: "ctf" })
        const sessionB = await create({ title: "terminal-b", operationSlug: opB.slug })

        expect((await get(sessionA.id)).operationSlug).toBe(opA.slug)
        expect((await get(sessionB.id)).operationSlug).toBe(opB.slug)
        expect(await Operation.activeSlug(tmp.path)).toBe(opB.slug)

        const resolvedA = await OperationResolver.resolveOperation({ workspace: tmp.path, sessionID: sessionA.id })
        const resolvedB = await OperationResolver.resolveOperation({ workspace: tmp.path, sessionID: sessionB.id })
        expect(resolvedA).toMatchObject({ slug: opA.slug, source: "session" })
        expect(resolvedB).toMatchObject({ slug: opB.slug, source: "session" })

        const sessionFileA = path.join(tmp.path, ".aegisec", "operation", opA.slug, "sessions", `${sessionA.id}.json`)
        const sessionFileB = path.join(tmp.path, ".aegisec", "operation", opB.slug, "sessions", `${sessionB.id}.json`)
        expect(await Bun.file(sessionFileA).exists()).toBe(true)
        expect(await Bun.file(sessionFileB).exists()).toBe(true)

        await remove(sessionA.id)
        await remove(sessionB.id)
      },
    })
  })

  test("creating a session rejects unknown operation slugs", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const error = await create({ title: "bad-operation", operationSlug: "missing-operation" }).catch((err) => err)

        expect(error?.name).toBe("NotFoundError")
        expect(error?.data?.message).toBe("Operation not found: missing-operation")
      },
    })
  })

  test("attaching a session rejects unknown operation slugs without persisting them", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "unbound" })

        const error = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.attachOperation({ sessionID: info.id, operationSlug: "missing-operation" }),
          ),
        ).catch((err) => err)

        expect(error?.name).toBe("NotFoundError")
        expect(error?.data?.message).toBe("Operation not found: missing-operation")

        expect((await get(info.id)).operationSlug).toBeUndefined()
        expect(await Operation.findSessionOperation(tmp.path, info.id)).toBeUndefined()

        await remove(info.id)
      },
    })
  })

  test("session-bound autonomy writes stay in the session operation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const opA = await Operation.create({ workspace: tmp.path, label: "Bound", kind: "pentest" })
        const sessionA = await create({ title: "bound", operationSlug: opA.slug })
        const opB = await Operation.create({ workspace: tmp.path, label: "Workspace Default", kind: "appsec" })

        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.setPermission({
              sessionID: sessionA.id,
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            }),
          ),
        )

        const factsA = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: opA.slug, limit: 100 }))
        const factsB = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: opB.slug, limit: 100 }))
        expect(
          factsA.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === opA.slug &&
              item.fact_name === "autonomy_policy" &&
              JSON.stringify(item.value_json).includes("\"mode\":\"auto\""),
          ),
        ).toBe(true)
        expect(
          factsB.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === opB.slug &&
              item.fact_name === "autonomy_policy" &&
              JSON.stringify(item.value_json).includes("\"mode\":\"auto\""),
          ),
        ).toBe(false)

        await remove(sessionA.id)
      },
    })
  })

  test("setting session permission syncs autonomy policy into the active operation kernel", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const op = await Operation.create({ workspace: tmp.path, label: "Autonomy Sync", kind: "pentest" })
        const info = await create({ title: "autonomy-sync" })

        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.setPermission({
              sessionID: info.id,
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            }),
          ),
        )

        const facts = await AppRuntime.runPromise(Cyber.listFacts({ operation_slug: op.slug, limit: 100 }))
        expect(
          facts.some(
            (item) =>
              item.entity_kind === "operation" &&
              item.entity_key === op.slug &&
              item.fact_name === "autonomy_policy" &&
              JSON.stringify(item.value_json).includes("\"mode\":\"auto\""),
          ),
        ).toBe(true)

        await remove(info.id)
      },
    })
  })
})
