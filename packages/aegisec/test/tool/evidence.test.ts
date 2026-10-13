import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppFileSystem } from "@aegisec/shared/filesystem"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Operation } from "../../src/core/operation"
import { Cyber } from "../../src/core/cyber"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Format } from "../../src/format"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool"
import { EvidenceTool } from "../../src/tool/evidence"
import { tmpdir } from "../fixture/fixture"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    AppFileSystem.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const baseCtx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "security",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  extra: {},
  ask: () => Effect.succeed(undefined as any),
} as any

async function exec(params: Record<string, unknown>) {
  return await runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* EvidenceTool
      const tool = yield* info.init()
      return yield* tool.execute(params as any, baseCtx)
    }) as any,
  )
}

describe("tool/evidence", () => {
  test("search and get return previews with finding links", async () => {
    await using fixture = await tmpdir({ git: true })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const op = await Operation.create({ workspace: fixture.path, label: "Evidence", kind: "appsec" })
        const added: any = await exec({
          action: "add_text",
          label: "authz replay",
          text: "GET /admin as alice -> 403\nGET /admin as bob -> 200",
        })
        const sha = String(added.metadata.sha256)
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "finding",
            entity_key: "app:authz",
            fact_name: "record",
            value_json: { title: "Authz finding", replay_present: true },
            writer_kind: "operator",
            status: "verified",
            confidence: 1000,
            evidence_refs: [sha],
          }),
        )
        await AppRuntime.runPromise(
          Cyber.upsertFact({
            operation_slug: op.slug,
            entity_kind: "observation",
            entity_key: "obs_seed_phrase",
            fact_name: "record",
            value_json: {
              title: "BIP39 wallet seed phrase exposed",
              note: "The linked artifact proves a seed phrase exposure in the feedback API.",
              status: "open",
              severity: "critical",
              evidence: [sha],
            },
            writer_kind: "tool",
            status: "observed",
            confidence: 900,
          }),
        )

        const search: any = await exec({ action: "search", query: "authz" })
        const phraseSearch: any = await exec({ action: "search", query: "authz replay" })
        const observationSearch: any = await exec({ action: "search", query: "seed phrase" })
        const get: any = await exec({ action: "get", sha256: sha })

        expect(search.metadata.count).toBe(1)
        expect(phraseSearch.metadata.count).toBe(1)
        expect(observationSearch.metadata.count).toBe(1)
        expect(search.output).toContain("app:authz")
        expect(observationSearch.output).toContain("observation_text")
        expect(observationSearch.output).toContain("obs_seed_phrase")
        expect(get.metadata.linked_finding_keys).toContain("app:authz")
        expect(get.output).toContain("GET /admin as alice")
        expect(get.metadata.side_effects).toEqual(["read_only"])
      },
    })
  })
})
